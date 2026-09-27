// Adapted from @pg-boss/dashboard (MIT, (c) 2026 Tim Jones): the column lists, the identifier
// check, the warning listing and the `queue_stats` bucketing follow
// `packages/dashboard/app/lib/queries.server.ts`, and the column probe follows its
// `information_schema` checks. Pagination is keyset rather than the dashboard's OFFSET, counts
// are capped, and a job is found by id on the `(name, id)` key with its queues named.

const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function quoteSchema(schema: string): string {
  if (!IDENTIFIER.test(schema)) {
    throw new Error(`Invalid pg-boss schema name: ${schema}`);
  }
  return `"${schema}"`;
}

export const INTERNAL_QUEUE_PREFIX = '__pgboss__';

/** What the schema probe found. Every column-dependent statement is built from one of these. */
export interface SchemaColumns {
  has(table: string, column: string): boolean;
  hasTable(table: string): boolean;
}

/** A schema with everything, for the statements that do not depend on a probe. */
export const ALL_COLUMNS: SchemaColumns = { has: () => true, hasTable: () => true };

// Microsecond precision, in UTC, so a cursor never lands between two rows created in the same
// millisecond.
const CURSOR_KEY = `to_char(created_on AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** `$n` epoch milliseconds as a timestamptz, exactly: a float would round at microseconds. */
export const at = (param: string) =>
  `(timestamptz 'epoch' + ${param}::bigint * interval '1 millisecond')`;

const QUEUE_COLUMNS = [
  'name',
  'policy',
  'partition',
  'dead_letter',
  'retry_limit',
  'retry_delay',
  'retry_backoff',
  'retry_delay_max',
  'expire_seconds',
  'retention_seconds',
  'deletion_seconds',
  'deferred_count',
  'queued_count',
  'ready_count',
  'active_count',
  'failed_count',
  'total_count',
  'warning_queued',
  'ready_history',
  'heartbeat_seconds',
  'notify',
  'singletons_active',
  'monitor_on',
  'created_on',
  'updated_on',
];

const JOB_SUMMARY_COLUMNS = [
  'id',
  'name',
  'state',
  'priority',
  'retry_count',
  'retry_limit',
  'created_on',
  'start_after',
  'started_on',
  'completed_on',
  'singleton_key',
  'group_id',
  'blocked',
  'source_name',
  'source_id',
  'source_created_on',
  'source_retry_count',
];

const JOB_DETAIL_COLUMNS = [
  'data',
  'output',
  'policy',
  'retry_delay',
  'retry_backoff',
  'retry_delay_max',
  'expire_seconds',
  'deletion_seconds',
  'keep_until',
  'singleton_on',
  'group_tier',
  'heartbeat_seconds',
  'heartbeat_on',
  'dead_letter',
  'blocking',
  'pending_dependencies',
];

const DEPTH_COLUMNS = ['deferred', 'queued', 'ready', 'active', 'failed', 'total'] as const;

export const sql = (s: string, columns: SchemaColumns = ALL_COLUMNS) => {
  /** The columns of `table` that exist, and a typed-free `NULL` in place of the ones that do not. */
  const pick = (table: string, list: string[], alias?: string) =>
    list
      .map((column) =>
        columns.has(table, column) ? (alias ? `${alias}.${column}` : column) : `NULL AS ${column}`
      )
      .join(', ');

  const jobSummary = `${pick('job', JOB_SUMMARY_COLUMNS)},
             (state = 'created' AND start_after > now()) AS deferred`;

  return {
    installed: `SELECT to_regclass($1) IS NOT NULL AS installed`,

    version: `SELECT version FROM ${s}.version LIMIT 1`,

    columns: `
      SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = ANY($2::text[])`,

    persistsQueueStats: `SELECT EXISTS (SELECT 1 FROM ${s}.queue_stats) AS persists`,

    persistsWarnings: `SELECT EXISTS (SELECT 1 FROM ${s}.warning) AS persists`,

    postgresStats: `
      SELECT split_part(current_setting('server_version'), ' ', 1) AS version,
             current_setting('port') AS port,
             extract(epoch from now() - pg_postmaster_start_time())::int AS uptime,
             (SELECT count(*) FROM pg_stat_activity)::int AS connected,
             (SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock')::int AS blocked`,

    queues: (byName: boolean) => `
      SELECT ${pick('queue', QUEUE_COLUMNS, 'q')},
             ${
               columns.hasTable('schedule')
                 ? `(SELECT count(*)::int FROM ${s}.schedule sc WHERE sc.name = q.name)`
                 : '0'
             } AS schedule_count
        FROM ${s}.queue q
       ${byName ? 'WHERE q.name = $1' : ''}
       ORDER BY q.name`,

    queueNames: `SELECT name FROM ${s}.queue`,

    cappedCount: `
      SELECT count(*)::int AS count
        FROM (SELECT 1 FROM ${s}.job WHERE name = $1 AND state = $2::${s}.job_state LIMIT $3) capped`,

    jobs: ({
      state,
      id,
      singletonKey,
      cursor,
      descending,
    }: {
      state: boolean;
      id: boolean;
      singletonKey: boolean;
      cursor: boolean;
      descending: boolean;
    }) => {
      const where = ['name = $1'];
      let placeholders = 1;
      const next = () => `$${++placeholders}`;
      if (state) where.push(`state = ${next()}::${s}.job_state`);
      if (id) where.push(`id = ${next()}::uuid`);
      if (singletonKey) where.push(`singleton_key = ${next()}`);
      if (cursor) {
        const createdOn = next();
        const jobId = next();
        where.push(
          `(created_on, id) ${descending ? '<' : '>'} (${createdOn}::timestamptz, ${jobId}::uuid)`
        );
      }
      const direction = descending ? 'DESC' : 'ASC';
      return `
        SELECT ${jobSummary},
               ${CURSOR_KEY} AS cursor_key
          FROM ${s}.job
         WHERE ${where.join(' AND ')}
         ORDER BY created_on ${direction}, id ${direction}
         LIMIT ${next()}`;
    },

    job: `
      SELECT ${jobSummary},
             ${pick('job', JOB_DETAIL_COLUMNS)}
        FROM ${s}.job
       WHERE name = $1 AND id = $2::uuid`,

    /**
     * `WHERE id = $1` alone would walk the whole `(name, id)` primary key, since `id` is its
     * second column. Naming the queues puts both key columns in the index condition, so the
     * lookup descends the key once per queue, and the partitions of queues not named are pruned.
     */
    findJob: `
      SELECT ${jobSummary}
        FROM ${s}.job
       WHERE name = ANY($1::text[]) AND id = $2::uuid
       LIMIT 1`,

    dependencies: `
      SELECT parent_name AS queue_name, parent_id AS id FROM ${s}.job_dependency
       WHERE child_name = $1 AND child_id = $2::uuid
       ORDER BY parent_name, parent_id`,

    dependents: `
      SELECT child_name AS queue_name, child_id AS id FROM ${s}.job_dependency
       WHERE parent_name = $1 AND parent_id = $2::uuid
       ORDER BY child_name, child_id`,

    schedules: (byName: boolean) => `
      SELECT name, key, cron, coalesce(timezone, 'UTC') AS timezone, data, options,
             created_on, updated_on, ${pick('schedule', ['kind', 'last_job_id'])}
        FROM ${s}.schedule
       ${byName ? 'WHERE name = $1' : ''}
       ORDER BY name, key`,

    schedule: `
      SELECT name, key, cron, coalesce(timezone, 'UTC') AS timezone, data, options,
             created_on, updated_on, ${pick('schedule', ['kind', 'last_job_id'])}
        FROM ${s}.schedule
       WHERE name = $1 AND key = $2`,

    /** The same bucketing as pg-boss's `getQueueStatsHistoryBucketed`, on epoch-aligned buckets. */
    depth: (fold: 'max' | 'avg') => `
      SELECT (floor(extract(epoch FROM captured_on) / $4) * $4 * 1000)::float8 AS ts,
             ${DEPTH_COLUMNS.map((c) => `round(${fold}(${c}_count))::int AS ${c}`).join(', ')}
        FROM ${s}.queue_stats
       WHERE name = $1 AND captured_on >= ${at('$2')} AND captured_on <= ${at('$3')}
       GROUP BY 1
       ORDER BY 1`,

    /**
     * Newest first on `warning_i1 (created_on DESC)`, the index pg-boss creates with the table,
     * with `id` breaking ties so a page boundary never skips a warning.
     */
    warnings: ({
      type,
      cursor,
      descending,
    }: {
      type: boolean;
      cursor: boolean;
      descending: boolean;
    }) => {
      const where: string[] = [];
      let placeholders = 0;
      const next = () => `$${++placeholders}`;
      if (type) where.push(`type = ${next()}`);
      if (cursor) {
        const createdOn = next();
        const id = next();
        where.push(
          `(created_on, id) ${descending ? '<' : '>'} (${createdOn}::timestamptz, ${id}::uuid)`
        );
      }
      const direction = descending ? 'DESC' : 'ASC';
      return `
        SELECT id, type, message, data, created_on, ${CURSOR_KEY} AS cursor_key
          FROM ${s}.warning
         ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY created_on ${direction}, id ${direction}
         LIMIT ${next()}`;
    },

    idsInState: `
      SELECT id FROM ${s}.job WHERE name = $1 AND state = $2::${s}.job_state
       ORDER BY created_on, id LIMIT $3`,

    deletableIds: `
      SELECT id FROM ${s}.job
       WHERE name = $1 AND id = ANY($2::uuid[]) AND state <> 'active'`,

    countWhere: (predicate: 'queued' | 'stored') => `
      SELECT count(*)::int AS count FROM ${s}.job
       WHERE name = $1 AND state ${predicate === 'queued' ? "< 'active'" : "> 'active'"}`,
  };
};

export type Statements = ReturnType<typeof sql>;
