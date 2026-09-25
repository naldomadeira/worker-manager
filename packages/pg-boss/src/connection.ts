import { PgBossEngineError } from '@worker-manager/api/engine';
import pg from 'pg';
import type { PgBossConnection, PgBossLike, PgBossModule } from './types';

type Row = Record<string, any>;

export interface Reader {
  query<R extends Row = Row>(text: string, values?: unknown[]): Promise<R[]>;
  close(): Promise<void>;
}

export interface Executor {
  executeSql(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
}

const QUERY_CANCELED = '57014';

function timeoutError(): PgBossEngineError {
  return new PgBossEngineError(500, 'ERRORS.PGBOSS_QUERY_TIMEOUT');
}

function rethrowTimeout(error: unknown): never {
  if ((error as { code?: string })?.code === QUERY_CANCELED) {
    throw timeoutError();
  }
  throw error;
}

function isPool(connection: PgBossConnection): connection is pg.Pool {
  return typeof connection === 'object' && typeof (connection as pg.Pool).connect === 'function';
}

function poolConfig(connection: string | pg.PoolConfig): pg.PoolConfig {
  return typeof connection === 'string' ? { connectionString: connection } : { ...connection };
}

/** A pool of our own, so the timeout can be a connection setting and costs no extra round trip. */
function ownReader(connection: string | pg.PoolConfig, timeoutMs: number): Reader {
  const config = poolConfig(connection);
  const pool = new pg.Pool({
    max: 3,
    application_name: 'worker-manager',
    ...config,
    options: [config.options, `-c statement_timeout=${timeoutMs}`].filter(Boolean).join(' '),
  });
  pool.on('error', () => undefined);

  return {
    async query(text, values) {
      return (await pool.query(text, values).catch(rethrowTimeout)).rows;
    },
    close: () => pool.end(),
  };
}

/** The app's pool: the timeout is scoped to a transaction so none of its sessions keep it. */
function borrowedReader(pool: pg.Pool, timeoutMs: number): Reader {
  return {
    async query(text, values) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN READ ONLY');
        await client.query(`SET LOCAL statement_timeout = ${Math.floor(timeoutMs)}`);
        const { rows } = await client.query(text, values);
        await client.query('COMMIT');
        return rows;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        return rethrowTimeout(error);
      } finally {
        client.release();
      }
    },
    close: async () => undefined,
  };
}

/**
 * Reads through the app's pg-boss instance. PostgreSQL arms `statement_timeout` when a statement
 * starts, so it cannot be set from inside the one statement `executeSql` runs: the limit here
 * only stops waiting, it does not stop the query.
 */
function instanceReader(instance: PgBossLike, timeoutMs: number): Reader {
  return {
    async query(text, values) {
      let timer: NodeJS.Timeout | undefined;
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(timeoutError()), timeoutMs);
      });
      try {
        const result = await Promise.race([instance.getDb().executeSql(text, values), expired]);
        return result.rows as any[];
      } catch (error) {
        return rethrowTimeout(error);
      } finally {
        clearTimeout(timer);
      }
    },
    close: async () => undefined,
  };
}

export function createReader(
  { instance, connection }: { instance?: PgBossLike; connection?: PgBossConnection },
  timeoutMs: number
): Reader {
  if (connection) {
    return isPool(connection)
      ? borrowedReader(connection, timeoutMs)
      : ownReader(connection, timeoutMs);
  }
  if (instance) {
    return instanceReader(instance, timeoutMs);
  }
  throw new Error('createPgBossBoard needs `pgBoss.instance` or `pgBoss.connection`.');
}

/** Where writes go when there is no app instance: a separate, untimed pool, opened on first use. */
export function createWriteExecutor(connection: PgBossConnection): {
  executor: Executor;
  close(): Promise<void>;
} {
  if (isPool(connection)) {
    return {
      executor: { executeSql: (text, values) => connection.query(text, values) },
      close: async () => undefined,
    };
  }

  let pool: pg.Pool | null = null;
  const open = () => {
    if (!pool) {
      pool = new pg.Pool({ max: 2, application_name: 'worker-manager', ...poolConfig(connection) });
      pool.on('error', () => undefined);
    }
    return pool;
  };

  return {
    executor: { executeSql: (text, values) => open().query(text, values) },
    close: async () => {
      await pool?.end();
      pool = null;
    },
  };
}

let cachedModule: Promise<PgBossModule | null> | null = null;

/** The pg-boss next to this package, or null when it is not installed. Only ever loaded once. */
export function loadPgBoss(): Promise<PgBossModule | null> {
  cachedModule ??= import('pg-boss').then(
    (module) => module as unknown as PgBossModule,
    () => null
  );
  return cachedModule;
}

/** The schema version the loaded pg-boss would install, read off its own construction plan. */
export function moduleSchemaVersion(module: PgBossModule): number | null {
  try {
    const plan = module.getConstructionPlans('wm_probe');
    const match = /INSERT INTO wm_probe\.version\s*\(version\)\s*VALUES\s*\('?(\d+)'?\)/.exec(plan);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/**
 * A writer that is never started: with a `db` adapter pg-boss runs its commands without
 * `start()`, so nothing migrates, supervises or schedules, and no timer keeps the process up.
 * One per command, because an unstarted instance never refreshes the queue cache it builds.
 */
export function unstartedWriter(
  module: PgBossModule,
  executor: Executor,
  schema: string
): PgBossLike {
  const boss = new module.PgBoss({
    db: executor,
    schema,
    migrate: false,
    supervise: false,
    schedule: false,
    createSchema: false,
  });
  boss.on?.('error', () => undefined);
  return boss;
}
