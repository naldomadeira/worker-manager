import type {
  CounterStore,
  HistoryAdministration,
  LatencyStorage,
  MetricsStore,
  Retention,
} from '../store';
import { PostgresHistoryAdmin } from './admin';
import { resolvePool, type PgPool, type PostgresConnection } from './connection';
import type { PgContext } from './context';
import {
  assertMigrated,
  DEFAULT_SCHEMA,
  DEFAULT_TABLE_PREFIX,
  metricsTables,
  runMigrations,
  type MetricsTables,
} from './schema';
import { PostgresCounterStore, PostgresLatencyStore } from './stores';

export interface PostgresMetricsStoreOptions {
  /** A `pg.Pool`, a node-postgres pool config, or a connection string. */
  connection: PostgresConnection;
  /**
   * Schema holding the tables. Defaults to a `schema` key on a pool config (so the object
   * given to BullMQ's PostgreSQL backend can be reused), then to `public`. Created on
   * migration when missing.
   */
  schema?: string;
  /** Prepended to every table name. Defaults to `worker_manager_metrics_`. */
  tablePrefix?: string;
  /**
   * Create or upgrade the tables before the first query. Off by default, in which case the
   * first query checks the schema version instead and fails with instructions when the tables
   * are missing: in deployments where the application role has no DDL rights, run
   * `migratePostgresMetrics()` from a deploy step.
   */
  migrate?: boolean;
  /**
   * Errors from idle pooled connections of a pool this store created (a server restart, a
   * dropped connection). Without a listener node-postgres would crash the process on them.
   */
  onError?: (error: Error) => void;
}

/**
 * History in PostgreSQL, for boards whose queues live on BullMQ's PostgreSQL backend and have
 * no Redis at all. Same tiers, retention, rollup and idempotency as the Redis store; see the
 * package README for the schema and sizing.
 */
export class PostgresMetricsStore implements MetricsStore {
  readonly pool: PgPool;
  readonly tables: MetricsTables;
  readonly jobClient = null;
  private readonly owned: boolean;
  private readonly shouldMigrate: boolean;
  private readiness: Promise<void> | null = null;
  private closed = false;
  private readonly ctx: PgContext;

  constructor(opts: PostgresMetricsStoreOptions) {
    const { pool, owned, schema } = resolvePool(opts.connection, opts.onError);
    this.pool = pool;
    this.owned = owned;
    try {
      this.tables = metricsTables(
        opts.schema ?? schema ?? DEFAULT_SCHEMA,
        opts.tablePrefix ?? DEFAULT_TABLE_PREFIX
      );
    } catch (error) {
      if (owned) {
        void pool.end().catch(() => undefined);
      }
      throw error;
    }
    this.shouldMigrate = opts.migrate === true;
    this.ctx = { pool: this.pool, tables: this.tables, ready: () => this.ready() };
  }

  /** Creates or upgrades the tables now. Idempotent and safe to race. */
  async migrate(): Promise<void> {
    await runMigrations(this.pool, this.tables);
    this.readiness = Promise.resolve();
  }

  /**
   * Memoized, but not on failure: a database that was unreachable at startup is retried on
   * the next query instead of poisoning the store for the life of the process.
   */
  ready(): Promise<void> {
    if (!this.readiness) {
      const attempt = this.shouldMigrate
        ? runMigrations(this.pool, this.tables).then(() => undefined)
        : assertMigrated(this.pool, this.tables);
      this.readiness = attempt.catch((error) => {
        this.readiness = null;
        throw error;
      });
    }
    return this.readiness;
  }

  counterStore(retention: Retention): CounterStore {
    return new PostgresCounterStore(this.ctx, retention);
  }

  latencyStore(retention: Retention): LatencyStorage {
    return new PostgresLatencyStore(this.ctx, retention);
  }

  administration(): HistoryAdministration {
    return new PostgresHistoryAdmin(this.ctx);
  }

  /** Ends the pool if this store created it. A pool handed in is left to its owner. */
  async close(): Promise<void> {
    if (this.owned && !this.closed) {
      this.closed = true;
      await this.pool.end();
    }
    this.closed = true;
  }
}

export interface MigratePostgresMetricsOptions {
  connection: PostgresConnection;
  schema?: string;
  tablePrefix?: string;
}

/**
 * Deploy-step form of `migrate: true`: creates or upgrades the metrics tables and returns.
 * A pool handed in is left open; one built from a config or string is ended afterwards.
 */
export async function migratePostgresMetrics(opts: MigratePostgresMetricsOptions): Promise<void> {
  const store = new PostgresMetricsStore(opts);
  try {
    await store.migrate();
  } finally {
    await store.close();
  }
}
