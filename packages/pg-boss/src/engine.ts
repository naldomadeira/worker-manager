import {
  decodePgBossCursor,
  encodePgBossCursor,
  PgBossEngineError,
  type PgBossEngine,
  type PgBossJobAction,
} from '@worker-manager/api/engine';
import type {
  PgBossDependencyRef,
  PgBossInfo,
  PgBossJob,
  PgBossJobState,
  PgBossJobSummary,
  PgBossQueueSummary,
  PgBossSchedule,
  PgBossStateCounts,
  TranslatableMessage,
} from '@worker-manager/api/typings/app';
import type {
  GetPgBossJobsQuery,
  SendPgBossJobBody,
  UpsertPgBossScheduleBody,
} from '@worker-manager/api/typings/requests';
import {
  createReader,
  createWriteExecutor,
  loadPgBoss,
  moduleSchemaVersion,
  unstartedWriter,
} from './connection';
import { INTERNAL_QUEUE_PREFIX, quoteSchema, sql } from './sql';
import type { PgBossBoardOptions, PgBossLike } from './types';
import {
  probeSchema,
  SCHEMA_MAX,
  SCHEMA_MIN,
  type SchemaState,
  writeRefusal,
} from './versionGuard';

const JOB_STATES: readonly PgBossJobState[] = [
  'created',
  'retry',
  'active',
  'completed',
  'cancelled',
  'failed',
];

const GUARD_TTL_MS = 10_000;
const RETRY_BATCH = 1000;
const PREVIEW_COUNT = 5;

type Row = Record<string, any>;

const iso = (value: unknown): string | null =>
  value === null || value === undefined ? null : new Date(value as string).toISOString();

const numberOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

function toQueue(row: Row): PgBossQueueSummary {
  const warningQueueSize = Number(row.warning_queued ?? 0);
  const queued = Number(row.queued_count ?? 0);
  return {
    name: row.name,
    policy: row.policy,
    partition: !!row.partition,
    counts: {
      queued,
      deferred: Number(row.deferred_count ?? 0),
      ready: Number(row.ready_count ?? 0),
      active: Number(row.active_count ?? 0),
      failed: Number(row.failed_count ?? 0),
      total: Number(row.total_count ?? 0),
    },
    statsCapturedOn: iso(row.monitor_on),
    readyHistory: (row.ready_history ?? []).map(Number),
    deadLetter: row.dead_letter ?? null,
    retryLimit: Number(row.retry_limit),
    retryDelay: Number(row.retry_delay),
    retryBackoff: !!row.retry_backoff,
    retryDelayMax: numberOrNull(row.retry_delay_max),
    expireInSeconds: Number(row.expire_seconds),
    retentionSeconds: Number(row.retention_seconds),
    deleteAfterSeconds: Number(row.deletion_seconds),
    warningQueueSize,
    // The dashboard's "attention" rule: only a queue with a warning size set can be backlogged.
    backlogged: warningQueueSize > 0 && queued > warningQueueSize,
    heartbeatSeconds: numberOrNull(row.heartbeat_seconds),
    notify: !!row.notify,
    singletonsActive: row.singletons_active ?? null,
    scheduleCount: Number(row.schedule_count ?? 0),
    createdOn: iso(row.created_on)!,
    updatedOn: iso(row.updated_on)!,
  };
}

function toJobSummary(row: Row): PgBossJobSummary {
  return {
    id: row.id,
    queueName: row.name,
    state: row.state,
    priority: Number(row.priority),
    retryCount: Number(row.retry_count),
    retryLimit: Number(row.retry_limit),
    createdOn: iso(row.created_on)!,
    startAfter: iso(row.start_after)!,
    startedOn: iso(row.started_on),
    completedOn: iso(row.completed_on),
    singletonKey: row.singleton_key ?? null,
    groupId: row.group_id ?? null,
    deferred: !!row.deferred,
    blocked: !!row.blocked,
    deadLetterSource:
      row.source_name && row.source_id
        ? {
            queueName: row.source_name,
            id: row.source_id,
            createdOn: iso(row.source_created_on),
            retryCount: numberOrNull(row.source_retry_count),
          }
        : null,
  };
}

function toJob(row: Row): PgBossJob {
  return {
    ...toJobSummary(row),
    data: row.data ?? null,
    output: row.output ?? null,
    policy: row.policy ?? null,
    retryDelay: Number(row.retry_delay),
    retryBackoff: !!row.retry_backoff,
    retryDelayMax: numberOrNull(row.retry_delay_max),
    expireInSeconds: Number(row.expire_seconds),
    deleteAfterSeconds: Number(row.deletion_seconds),
    keepUntil: iso(row.keep_until)!,
    singletonOn: iso(row.singleton_on),
    groupTier: row.group_tier ?? null,
    heartbeatSeconds: numberOrNull(row.heartbeat_seconds),
    heartbeatOn: iso(row.heartbeat_on),
    deadLetter: row.dead_letter ?? null,
    blocking: !!row.blocking,
    pendingDependencies: Number(row.pending_dependencies ?? 0),
  };
}

const toRef = (row: Row): PgBossDependencyRef => ({ queueName: row.queue_name, id: row.id });

const isMissingQueue = (error: unknown) =>
  error instanceof Error && /Queue .* does not exist/.test(error.message);

/** pg-boss validates an expression before it touches the database, so only a driver error has a code. */
function scheduleFailure(error: unknown): unknown {
  if (isMissingQueue(error)) return new PgBossEngineError(404, 'ERRORS.QUEUE_NOT_FOUND');
  return (error as { code?: unknown })?.code ? error : invalidSchedule(error);
}

function invalidSchedule(error: unknown): PgBossEngineError {
  const detail = error instanceof Error ? error.message : String(error);
  return new PgBossEngineError(400, 'ERRORS.PGBOSS_INVALID_SCHEDULE', undefined, detail);
}

/**
 * The pg-boss engine: reads with SQL against the pg-boss schema, writes through the pg-boss API,
 * and never migrates, supervises or creates anything in the database it is pointed at.
 */
export function createPgBossEngine(
  options: PgBossBoardOptions,
  { readOnly = false }: { readOnly?: boolean } = {}
): PgBossEngine {
  const schema = options.schema ?? 'pgboss';
  const statements = sql(quoteSchema(schema));
  const timeoutMs = options.queryTimeoutMs ?? 5000;
  const countCap = options.countCap ?? 10_000;
  const reader = createReader(options, timeoutMs);
  const writes =
    !options.instance && options.connection ? createWriteExecutor(options.connection) : null;

  let guard: { at: number; state: Promise<SchemaState> } | null = null;
  const schemaState = (): Promise<SchemaState> => {
    if (!guard || Date.now() - guard.at > GUARD_TTL_MS) {
      const state = probeSchema(reader, statements, schema);
      guard = { at: Date.now(), state };
      state.catch(() => {
        guard = null;
      });
    }
    return guard.state;
  };

  const writer = async (): Promise<PgBossLike | null> => {
    if (options.instance) return options.instance;
    const module = writes ? await loadPgBoss() : null;
    return module && writes ? unstartedWriter(module, writes.executor, schema) : null;
  };

  const writerVersion = async (): Promise<number | null | undefined> => {
    if (options.instance) return undefined;
    const module = writes ? await loadPgBoss() : null;
    return module ? moduleSchemaVersion(module) : null;
  };

  const previewer = async () => {
    if (options.instance) {
      return typeof options.instance.previewSchedule === 'function' ? options.instance : null;
    }
    const module = await loadPgBoss();
    if (!module) return null;
    const preview = unstartedWriter(
      module,
      { executeSql: () => Promise.reject(new Error('preview only')) },
      schema
    );
    return typeof preview.previewSchedule === 'function' ? preview : null;
  };

  const writeReason = async (): Promise<TranslatableMessage | null> => {
    if (readOnly) return { key: 'ERRORS.QUEUE_READ_ONLY' };
    return writeRefusal(await schemaState(), await writerVersion());
  };

  const allowed = (name: string) => {
    if (!options.includeInternalQueues && name.startsWith(INTERNAL_QUEUE_PREFIX)) return false;
    const { queues } = options;
    if (!queues) return true;
    return typeof queues === 'function' ? queues(name) : queues.includes(name);
  };

  const requireWriter = async (): Promise<PgBossLike> => {
    const boss = await writer();
    if (!boss) {
      throw new PgBossEngineError(409, 'ERRORS.PGBOSS_WRITES_DISABLED', undefined, {
        key: 'ERRORS.PGBOSS_WRITER_UNAVAILABLE',
      });
    }
    return boss;
  };

  const nextRuns = async (expression: string, timezone: string): Promise<string[]> => {
    const preview = await previewer();
    if (!preview) return [];
    try {
      return preview.previewSchedule!(expression, { tz: timezone, count: PREVIEW_COUNT }).map(
        (date) => date.toISOString()
      );
    } catch {
      return [];
    }
  };

  const toSchedule = async (row: Row): Promise<PgBossSchedule> => {
    const timezone = row.timezone ?? 'UTC';
    return {
      queueName: row.name,
      key: row.key ?? '',
      kind: row.kind === 'rrule' ? 'rrule' : 'cron',
      expression: row.cron,
      timezone,
      data: row.data ?? null,
      options: row.options ?? {},
      createdOn: iso(row.created_on)!,
      updatedOn: iso(row.updated_on)!,
      lastJobId: row.last_job_id ?? null,
      nextRuns: await nextRuns(row.cron, timezone),
    };
  };

  const readSchedule = async (name: string, key: string) => {
    const { scheduleKindColumns } = await schemaState();
    const [row] = await reader.query(statements.schedule(scheduleKindColumns), [name, key]);
    return row ? toSchedule(row) : null;
  };

  const countWhere = async (name: string, predicate: 'queued' | 'stored') => {
    const [row] = await reader.query(statements.countWhere(predicate), [name]);
    return Number(row?.count ?? 0);
  };

  const engine: PgBossEngine = {
    async info(): Promise<PgBossInfo> {
      const state = await schemaState();
      const writesDisabledReason = await writeReason();
      const writable = !writesDisabledReason;
      const preview = state.readable ? await previewer() : null;
      const persistQueueStats = state.readable
        ? !!(await reader.query(statements.persistsQueueStats))[0]?.persists
        : false;
      const [stats] = await reader.query(statements.postgresStats).catch(() => []);

      return {
        schema,
        delimiter: options.delimiter ?? '',
        installed: state.installed,
        schemaVersion: state.version,
        supportedRange: { min: SCHEMA_MIN, max: SCHEMA_MAX },
        readable: state.readable,
        writable,
        readOnly,
        unavailableReason: state.unavailableReason,
        writesDisabledReason,
        persistQueueStats,
        datastore: stats
          ? {
              backend: 'postgres',
              version: String(stats.version),
              port: Number(stats.port),
              uptime: Number(stats.uptime),
              clients: { connected: Number(stats.connected), blocked: Number(stats.blocked) },
            }
          : null,
        capabilities: {
          send: writable,
          retry: writable,
          cancel: writable,
          resume: writable,
          delete: writable,
          scheduleWrite: writable,
          schedulePreview: !!preview,
          bulk: writable,
        },
      };
    },

    async readGate() {
      return (await schemaState()).unavailableReason;
    },

    writeGate: writeReason,

    async listQueues() {
      const rows = await reader.query(statements.queues(false));
      return rows.filter((row) => allowed(row.name)).map(toQueue);
    },

    async getQueue(name) {
      if (!allowed(name)) return null;
      const [row] = await reader.query(statements.queues(true), [name]);
      return row ? toQueue(row) : null;
    },

    async countStates(name) {
      const entries = await Promise.all(
        JOB_STATES.map(async (state) => {
          try {
            const [row] = await reader.query(statements.cappedCount, [name, state, countCap + 1]);
            const count = Number(row?.count ?? 0);
            return [state, { count: Math.min(count, countCap), capped: count > countCap }] as const;
          } catch (error) {
            if (error instanceof PgBossEngineError && error.key === 'ERRORS.PGBOSS_QUERY_TIMEOUT') {
              return [state, { count: null, capped: false }] as const;
            }
            throw error;
          }
        })
      );
      return { counts: Object.fromEntries(entries) as PgBossStateCounts, cap: countCap };
    },

    async listJobs(name, query: GetPgBossJobsQuery) {
      const limit = Number(query.limit);
      const cursor = query.cursor ? decodePgBossCursor(query.cursor) : null;
      const newestFirst = query.order !== 'asc';
      const backwards = cursor?.direction === 'prev';
      // Walking back reads the other way from the key and flips the page afterwards.
      const descending = backwards ? !newestFirst : newestFirst;

      const values: unknown[] = [name];
      if (query.state) values.push(query.state);
      if (query.id) values.push(query.id);
      if (query.singletonKey !== undefined) values.push(query.singletonKey);
      if (cursor) values.push(cursor.createdOn, cursor.id);
      values.push(limit + 1);

      const rows = await reader.query(
        statements.jobs({
          state: !!query.state,
          id: !!query.id,
          singletonKey: query.singletonKey !== undefined,
          cursor: !!cursor,
          descending,
        }),
        values
      );

      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      if (backwards) page.reverse();

      const first = page[0];
      const last = page[page.length - 1];
      const keyOf = (row: Row, direction: 'next' | 'prev') =>
        encodePgBossCursor({ direction, createdOn: row.cursor_key, id: row.id });

      return {
        jobs: page.map(toJobSummary),
        nextCursor: last && (backwards || hasMore) ? keyOf(last, 'next') : null,
        prevCursor: first && (backwards ? hasMore : !!cursor) ? keyOf(first, 'prev') : null,
      };
    },

    async getJob(name, id) {
      const [row] = await reader.query(statements.job, [name, id]);
      return row ? toJob(row) : null;
    },

    async getDependencies(name, id) {
      const [dependencies, dependents] = await Promise.all([
        reader.query(statements.dependencies, [name, id]),
        reader.query(statements.dependents, [name, id]),
      ]);
      return { dependencies: dependencies.map(toRef), dependents: dependents.map(toRef) };
    },

    async listSchedules(queueName) {
      const { scheduleKindColumns } = await schemaState();
      const rows = await reader.query(
        statements.schedules(queueName !== undefined, scheduleKindColumns),
        queueName !== undefined ? [queueName] : []
      );
      return Promise.all(rows.filter((row) => allowed(row.name)).map(toSchedule));
    },

    async previewSchedule({ expression, tz, count }) {
      const preview = await previewer();
      if (!preview) {
        throw new PgBossEngineError(409, 'ERRORS.PGBOSS_PREVIEW_UNAVAILABLE');
      }
      try {
        return preview.previewSchedule!(expression, {
          tz: tz ?? 'UTC',
          count: count ?? PREVIEW_COUNT,
        }).map((date) => date.toISOString());
      } catch (error) {
        throw invalidSchedule(error);
      }
    },

    async send(name, { data, options: sendOptions }: SendPgBossJobBody) {
      const boss = await requireWriter();
      try {
        return await boss.send(name, data ?? null, sendOptions ?? {});
      } catch (error) {
        if (isMissingQueue(error)) throw new PgBossEngineError(404, 'ERRORS.QUEUE_NOT_FOUND');
        throw error;
      }
    },

    async command(action: PgBossJobAction, name, ids) {
      const boss = await requireWriter();
      let targets = ids;
      if (action === 'delete') {
        // pg-boss deletes whatever id it is given; an active job belongs to a running handler.
        const rows = await reader.query(statements.deletableIds, [name, ids]);
        targets = rows.map((row) => row.id);
        if (targets.length === 0) return { requested: ids.length, affected: 0 };
      }
      const run = {
        retry: () => boss.retry(name, targets),
        cancel: () => boss.cancel(name, targets),
        resume: () => boss.resume(name, targets),
        delete: () => boss.deleteJob(name, targets),
      }[action];
      const { affected } = await run();
      return { requested: ids.length, affected: Number(affected ?? 0) };
    },

    async retryFailed(name) {
      const boss = await requireWriter();
      let requested = 0;
      let affected = 0;
      for (;;) {
        const rows = await reader.query(statements.idsInState, [name, 'failed', RETRY_BATCH]);
        if (rows.length === 0) break;
        const ids = rows.map((row) => row.id);
        const result = await boss.retry(name, ids);
        requested += ids.length;
        affected += Number(result.affected ?? 0);
        // Nothing moved means something else holds them; stop rather than spin on the same batch.
        if (!result.affected || rows.length < RETRY_BATCH) break;
      }
      return { requested, affected };
    },

    async deleteQueued(name) {
      const boss = await requireWriter();
      const matched = await countWhere(name, 'queued');
      await boss.deleteQueuedJobs(name);
      return { requested: matched, affected: matched };
    },

    async deleteStored(name) {
      const boss = await requireWriter();
      const matched = await countWhere(name, 'stored');
      await boss.deleteStoredJobs(name);
      return { requested: matched, affected: matched };
    },

    async upsertSchedule(
      name,
      { key, cron, tz, data, options: sendOptions, missed }: UpsertPgBossScheduleBody
    ) {
      const boss = await requireWriter();
      try {
        await boss.schedule(name, cron, data ?? null, {
          ...sendOptions,
          key,
          tz: tz ?? 'UTC',
          ...(missed ? { missed } : {}),
        });
      } catch (error) {
        throw scheduleFailure(error);
      }
      const schedule = await readSchedule(name, key);
      if (!schedule) throw new PgBossEngineError(404, 'ERRORS.JOB_SCHEDULER_NOT_FOUND');
      return schedule;
    },

    async removeSchedule(name, key) {
      const boss = await requireWriter();
      if (!(await readSchedule(name, key))) return { requested: 1, affected: 0 };
      await boss.unschedule(name, key);
      return { requested: 1, affected: 1 };
    },

    isVisible(request, queueName) {
      if (!allowed(queueName)) return false;
      return options.visibilityGuard ? options.visibilityGuard(request, queueName) : true;
    },

    async close() {
      await Promise.all([reader.close(), writes?.close()]);
    },
  };

  return engine;
}
