import { quoteIdentifier, type PgPool } from './connection';

export const DEFAULT_SCHEMA = 'public';
/** The SQL twin of the Redis namespace `worker-manager:metrics`. */
export const DEFAULT_TABLE_PREFIX = 'worker_manager_metrics_';
/** Keeps the longest derived name, an index, inside PostgreSQL's 63-character limit. */
const MAX_PREFIX_LENGTH = 32;

export const SCHEMA_VERSION = 1;

export interface MetricsTables {
  schema: string;
  prefix: string;
  /** Schema-qualified, quoted names, ready to splice into SQL or cast to `regclass`. */
  meta: string;
  counters: string;
  histograms: string;
  samplerState: string;
}

export function metricsTables(schema: string, prefix: string): MetricsTables {
  quoteIdentifier(schema);
  if (prefix.length > MAX_PREFIX_LENGTH) {
    throw new Error(`tablePrefix must be at most ${MAX_PREFIX_LENGTH} characters.`);
  }
  const table = (name: string) => `${quoteIdentifier(schema)}.${quoteIdentifier(prefix + name)}`;
  return {
    schema,
    prefix,
    meta: table('meta'),
    counters: table('counters'),
    histograms: table('histograms'),
    samplerState: table('sampler_state'),
  };
}

/**
 * Ordered, append-only. A released migration is never edited: a change ships as the next
 * version, and `migrate()` applies whatever a database is missing.
 */
const MIGRATIONS: { version: number; sql: (t: MetricsTables) => string }[] = [
  {
    version: 1,
    sql: (t) => {
      const index = (name: string) => quoteIdentifier(`${t.prefix}${name}`);
      return `
        -- completed / failed sums at minute, hour and day resolution, and the queue-age gauge
        -- (a max) at hour and day resolution. bucket is an absolute minute, hour or day index
        -- since the epoch. queue = '__global__' is the cross-queue rollup.
        CREATE TABLE IF NOT EXISTS ${t.counters} (
          queue  text   NOT NULL,
          metric text   NOT NULL,
          tier   text   NOT NULL CHECK (tier IN ('minute', 'hour', 'day')),
          bucket bigint NOT NULL,
          value  bigint NOT NULL,
          PRIMARY KEY (queue, metric, tier, bucket)
        );
        CREATE INDEX IF NOT EXISTS ${index('counters_retention_idx')}
          ON ${t.counters} (tier, bucket);

        -- runtime / waittime latency histograms: one count per fixed bucket bound, merged
        -- element-wise.
        CREATE TABLE IF NOT EXISTS ${t.histograms} (
          queue  text     NOT NULL,
          metric text     NOT NULL,
          tier   text     NOT NULL CHECK (tier IN ('hour', 'day')),
          bucket bigint   NOT NULL,
          counts bigint[] NOT NULL,
          PRIMARY KEY (queue, metric, tier, bucket)
        );
        CREATE INDEX IF NOT EXISTS ${index('histograms_retention_idx')}
          ON ${t.histograms} (tier, bucket);

        -- The sampler's per-queue lease and finish-time watermark. Rows past expires_at are
        -- treated as absent and pruned with the history.
        CREATE TABLE IF NOT EXISTS ${t.samplerState} (
          queue      text        NOT NULL,
          kind       text        NOT NULL CHECK (kind IN ('lease', 'watermark')),
          value      text        NOT NULL,
          expires_at timestamptz NOT NULL,
          PRIMARY KEY (queue, kind)
        );
      `;
    },
  },
];

/**
 * Creates or upgrades the metrics tables. Idempotent, and safe to run from several processes
 * at once: the whole upgrade is one transaction behind an advisory lock scoped to this
 * schema and prefix, so a second migrator waits and then finds nothing left to do.
 *
 * The schema is created only when it does not exist yet, since `CREATE SCHEMA IF NOT EXISTS`
 * still demands the database-level CREATE privilege that an application role often lacks.
 */
export async function runMigrations(pool: PgPool, tables: MetricsTables): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `worker-manager-metrics:${tables.schema}.${tables.prefix}`,
      ]);
      const { rows: found } = await client.query('SELECT to_regnamespace($1) AS oid', [
        tables.schema,
      ]);
      if (!found[0]?.oid) {
        await client.query(`CREATE SCHEMA ${quoteIdentifier(tables.schema)}`);
      }
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${tables.meta} (name text PRIMARY KEY, value text NOT NULL)`
      );
      const current = await readVersion(client, tables);
      if (current > SCHEMA_VERSION) {
        throw newerSchemaError(current);
      }
      for (const migration of MIGRATIONS) {
        if (migration.version > current) {
          await client.query(migration.sql(tables));
        }
      }
      await client.query(
        `INSERT INTO ${tables.meta} (name, value) VALUES ('schema_version', $1)
         ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value`,
        [String(SCHEMA_VERSION)]
      );
      await client.query('COMMIT');
      return SCHEMA_VERSION;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  } finally {
    client.release();
  }
}

/** Throws unless the tables exist at the version this build writes. */
export async function assertMigrated(pool: PgPool, tables: MetricsTables): Promise<void> {
  const { rows } = await pool.query('SELECT to_regclass($1) AS oid', [tables.meta]);
  const current = rows[0]?.oid ? await readVersion(pool, tables) : 0;
  if (current > SCHEMA_VERSION) {
    throw newerSchemaError(current);
  }
  if (current < SCHEMA_VERSION) {
    throw new Error(
      `The metrics tables in schema "${tables.schema}" (prefix "${tables.prefix}") are ` +
        `missing or at version ${current}, and this build needs version ${SCHEMA_VERSION}. ` +
        'Pass `migrate: true` to the store, or run `migratePostgresMetrics()` as a deploy step.'
    );
  }
}

async function readVersion(
  client: { query: PgPool['query'] },
  tables: MetricsTables
): Promise<number> {
  const { rows } = await client.query(
    `SELECT value FROM ${tables.meta} WHERE name = 'schema_version'`
  );
  return rows[0] ? Number(rows[0].value) || 0 : 0;
}

function newerSchemaError(current: number): Error {
  return new Error(
    `The metrics tables are at schema version ${current}, newer than the ${SCHEMA_VERSION} ` +
      'this build of @worker-manager/metrics understands. Upgrade the package.'
  );
}
