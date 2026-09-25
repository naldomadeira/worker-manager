// Adapted from @pg-boss/dashboard (MIT, (c) 2026 Tim Jones): the column lists and the identifier
// check follow `packages/dashboard/app/lib/queries.server.ts`. Pagination is keyset rather than
// the dashboard's OFFSET, and counts are capped.

const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function quoteSchema(schema: string): string {
  if (!IDENTIFIER.test(schema)) {
    throw new Error(`Invalid pg-boss schema name: ${schema}`);
  }
  return `"${schema}"`;
}

export const INTERNAL_QUEUE_PREFIX = '__pgboss__';

// Microsecond precision, in UTC, so a cursor never lands between two jobs created in the same
// millisecond.
const CURSOR_KEY = `to_char(created_on AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export const sql = (s: string) => ({
  installed: `SELECT to_regclass($1) IS NOT NULL AS installed`,

  version: `SELECT version FROM ${s}.version LIMIT 1`,

  scheduleColumns: `
    SELECT count(*)::int AS found FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = 'schedule' AND column_name IN ('kind', 'last_job_id')`,

  persistsQueueStats: `SELECT EXISTS (SELECT 1 FROM ${s}.queue_stats) AS persists`,

  postgresStats: `
    SELECT split_part(current_setting('server_version'), ' ', 1) AS version,
           current_setting('port') AS port,
           extract(epoch from now() - pg_postmaster_start_time())::int AS uptime,
           (SELECT count(*) FROM pg_stat_activity)::int AS connected,
           (SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock')::int AS blocked`,

  queues: (byName: boolean) => `
    SELECT q.name, q.policy, q.partition, q.dead_letter, q.retry_limit, q.retry_delay,
           q.retry_backoff, q.retry_delay_max, q.expire_seconds, q.retention_seconds,
           q.deletion_seconds, q.deferred_count, q.queued_count, q.ready_count, q.active_count,
           q.failed_count, q.total_count, q.warning_queued, q.ready_history, q.heartbeat_seconds,
           q.notify, q.singletons_active, q.monitor_on, q.created_on, q.updated_on,
           (SELECT count(*)::int FROM ${s}.schedule sc WHERE sc.name = q.name) AS schedule_count
      FROM ${s}.queue q
     ${byName ? 'WHERE q.name = $1' : ''}
     ORDER BY q.name`,

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
      SELECT id, name, state, priority, retry_count, retry_limit, created_on, start_after,
             started_on, completed_on, singleton_key, group_id, blocked,
             source_name, source_id, source_created_on, source_retry_count,
             (state = 'created' AND start_after > now()) AS deferred,
             ${CURSOR_KEY} AS cursor_key
        FROM ${s}.job
       WHERE ${where.join(' AND ')}
       ORDER BY created_on ${direction}, id ${direction}
       LIMIT ${next()}`;
  },

  job: `
    SELECT id, name, state, priority, retry_count, retry_limit, created_on, start_after,
           started_on, completed_on, singleton_key, group_id, blocked,
           source_name, source_id, source_created_on, source_retry_count,
           (state = 'created' AND start_after > now()) AS deferred,
           data, output, policy, retry_delay, retry_backoff, retry_delay_max, expire_seconds,
           deletion_seconds, keep_until, singleton_on, group_tier, heartbeat_seconds,
           heartbeat_on, dead_letter, blocking, pending_dependencies
      FROM ${s}.job
     WHERE name = $1 AND id = $2::uuid`,

  dependencies: `
    SELECT parent_name AS queue_name, parent_id AS id FROM ${s}.job_dependency
     WHERE child_name = $1 AND child_id = $2::uuid
     ORDER BY parent_name, parent_id`,

  dependents: `
    SELECT child_name AS queue_name, child_id AS id FROM ${s}.job_dependency
     WHERE parent_name = $1 AND parent_id = $2::uuid
     ORDER BY child_name, child_id`,

  schedules: (byName: boolean, withKindColumns: boolean) => `
    SELECT name, key, cron, coalesce(timezone, 'UTC') AS timezone, data, options,
           created_on, updated_on
           ${withKindColumns ? ', kind, last_job_id' : ''}
      FROM ${s}.schedule
     ${byName ? 'WHERE name = $1' : ''}
     ORDER BY name, key`,

  schedule: (withKindColumns: boolean) => `
    SELECT name, key, cron, coalesce(timezone, 'UTC') AS timezone, data, options,
           created_on, updated_on
           ${withKindColumns ? ', kind, last_job_id' : ''}
      FROM ${s}.schedule
     WHERE name = $1 AND key = $2`,

  idsInState: `
    SELECT id FROM ${s}.job WHERE name = $1 AND state = $2::${s}.job_state
     ORDER BY created_on, id LIMIT $3`,

  deletableIds: `
    SELECT id FROM ${s}.job
     WHERE name = $1 AND id = ANY($2::uuid[]) AND state <> 'active'`,

  countWhere: (predicate: 'queued' | 'stored') => `
    SELECT count(*)::int AS count FROM ${s}.job
     WHERE name = $1 AND state ${predicate === 'queued' ? "< 'active'" : "> 'active'"}`,
});

export type Statements = ReturnType<typeof sql>;
