import { randomUUID } from 'crypto';
import { PGBOSS_FEATURES, PGBOSS_JOB_STATES, pgBossJobSummarySchema } from '../../schemas/pgBoss';
import type {
  PgBossCapabilities,
  PgBossFeature,
  PgBossFeatures,
  PgBossInfo,
  PgBossJob,
  PgBossJobState,
  PgBossJobSummary,
  PgBossQueueDepthPoint,
  PgBossQueueSummary,
  PgBossSchedule,
  PgBossStateCounts,
  PgBossWarning,
  TranslatableMessage,
} from '../../types';
import { decodePgBossCursor, encodePgBossCursor } from './cursor';
import { PgBossEngineError } from './errors';
import type { PgBossEngine } from './types';
import { mentionsQueue, pageWarnings, warningQueueName } from './warnings';

export interface PgBossStubOptions {
  queues?: string[];
  jobs?: Partial<PgBossJob>[];
  schedules?: Partial<PgBossSchedule>[];
  /** Makes every read answer with this reason, the way a missing or unsupported schema does. */
  unreadable?: TranslatableMessage;
  /** Makes every write answer with this reason, the way the schema guard does. */
  unwritable?: TranslatableMessage;
  hidden?: string[];
  /** Persisted warnings, newest first or in any order. */
  warnings?: Partial<PgBossWarning>[];
  /** What `queueDepth` answers for every queue. */
  depth?: PgBossQueueDepthPoint[];
  /** Features the schema lacks, the way the column probe reports them. */
  missingFeatures?: PgBossFeature[];
}

const EPOCH = Date.parse('2026-01-01T00:00:00.000Z');

function queueSummary(name: string): PgBossQueueSummary {
  return {
    name,
    policy: 'standard',
    partition: false,
    counts: { queued: 0, deferred: 0, ready: 0, active: 0, failed: 0, total: 0 },
    statsCapturedOn: null,
    readyHistory: [],
    deadLetter: null,
    retryLimit: 2,
    retryDelay: 0,
    retryBackoff: false,
    retryDelayMax: null,
    expireInSeconds: 900,
    retentionSeconds: 1_209_600,
    deleteAfterSeconds: 604_800,
    warningQueueSize: 0,
    backlogged: false,
    heartbeatSeconds: null,
    notify: false,
    singletonsActive: null,
    scheduleCount: 0,
    createdOn: new Date(EPOCH).toISOString(),
    updatedOn: new Date(EPOCH).toISOString(),
  };
}

function makeJob(partial: Partial<PgBossJob>, index: number): PgBossJob {
  const createdOn = partial.createdOn ?? new Date(EPOCH + index * 1000).toISOString();
  return {
    id: randomUUID(),
    queueName: 'default',
    state: 'created',
    priority: 0,
    retryCount: 0,
    retryLimit: 2,
    createdOn,
    startAfter: createdOn,
    startedOn: null,
    completedOn: null,
    singletonKey: null,
    groupId: null,
    deferred: false,
    blocked: false,
    deadLetterSource: null,
    data: null,
    output: null,
    policy: 'standard',
    retryDelay: 0,
    retryBackoff: false,
    retryDelayMax: null,
    expireInSeconds: 900,
    deleteAfterSeconds: 604_800,
    keepUntil: createdOn,
    singletonOn: null,
    groupTier: null,
    heartbeatSeconds: null,
    heartbeatOn: null,
    deadLetter: null,
    blocking: false,
    pendingDependencies: 0,
    ...partial,
  };
}

const ALLOWED: Record<'retry' | 'cancel' | 'resume' | 'delete', PgBossJobState[]> = {
  retry: ['failed'],
  cancel: ['created', 'retry', 'active'],
  resume: ['cancelled'],
  delete: ['created', 'retry', 'completed', 'cancelled', 'failed'],
};

const NEXT_STATE: Record<'retry' | 'cancel' | 'resume', PgBossJobState> = {
  retry: 'retry',
  cancel: 'cancelled',
  resume: 'created',
};

function toSummary(job: PgBossJob): PgBossJobSummary {
  return Object.fromEntries(
    Object.keys(pgBossJobSummarySchema.entries).map((name) => [name, job[name as keyof PgBossJob]])
  ) as PgBossJobSummary;
}

/**
 * An in-memory {@link PgBossEngine}: what the OpenAPI generator mounts the pg-boss route table
 * with, and what the handler specs drive. It keeps pg-boss's state rules, not its storage.
 */
export function createPgBossStubEngine(options: PgBossStubOptions = {}): PgBossEngine {
  const queues = new Map<string, PgBossQueueSummary>(
    (options.queues ?? ['default']).map((name) => [name, queueSummary(name)])
  );
  const jobs: PgBossJob[] = (options.jobs ?? []).map(makeJob);
  const schedules: PgBossSchedule[] = (options.schedules ?? []).map((partial) => ({
    queueName: 'default',
    key: '',
    kind: 'cron',
    expression: '0 * * * *',
    timezone: 'UTC',
    data: null,
    options: {},
    createdOn: new Date(EPOCH).toISOString(),
    updatedOn: new Date(EPOCH).toISOString(),
    lastJobId: null,
    nextRuns: [],
    ...partial,
  }));
  const hidden = new Set(options.hidden ?? []);
  const missing = new Set(options.missingFeatures ?? []);
  const features = Object.fromEntries(
    PGBOSS_FEATURES.map((feature) => [feature, !missing.has(feature)])
  ) as PgBossFeatures;
  const warnings: PgBossWarning[] = (options.warnings ?? []).map((partial, index) => ({
    id: `00000000-0000-4000-9000-${String(index).padStart(12, '0')}`,
    type: 'queue_backlog',
    message: 'Warning: large queue backlog',
    data: null,
    queueName: null,
    createdOn: new Date(EPOCH + index * 60_000).toISOString(),
    ...partial,
  }));
  const unavailable = (feature: PgBossFeature) =>
    new PgBossEngineError(409, 'ERRORS.PGBOSS_FEATURE_UNAVAILABLE', { feature });

  const capabilities: PgBossCapabilities = {
    send: !options.unwritable,
    retry: !options.unwritable,
    cancel: !options.unwritable,
    resume: !options.unwritable,
    delete: !options.unwritable,
    scheduleWrite: !options.unwritable,
    schedulePreview: true,
    bulk: !options.unwritable,
  };

  const jobsOf = (name: string) => jobs.filter((job) => job.queueName === name);

  const engine: PgBossEngine = {
    async info(): Promise<PgBossInfo> {
      return {
        schema: 'pgboss',
        delimiter: '',
        installed: options.unreadable?.key !== 'ERRORS.PGBOSS_NOT_INSTALLED',
        schemaVersion: 42,
        supportedRange: { min: 35, max: 42 },
        readable: !options.unreadable,
        writable: !options.unwritable,
        readOnly: false,
        unavailableReason: options.unreadable ?? null,
        writesDisabledReason: options.unwritable ?? null,
        untested: false,
        features,
        disabledFeatures: [...missing],
        persistQueueStats: !!options.depth?.length,
        persistWarnings: warnings.length > 0,
        datastore: null,
        capabilities,
      };
    },
    async readGate() {
      return options.unreadable ?? null;
    },
    async writeGate() {
      return options.unwritable ?? null;
    },
    async listQueues() {
      return [...queues.values()];
    },
    async getQueue(name) {
      return queues.get(name) ?? null;
    },
    async countStates(name) {
      const counts = Object.fromEntries(
        PGBOSS_JOB_STATES.map((state) => [
          state,
          { count: jobsOf(name).filter((job) => job.state === state).length, capped: false },
        ])
      ) as PgBossStateCounts;
      return { counts, cap: 10_000 };
    },
    async listJobs(name, query) {
      const direction = query.order === 'asc' ? 1 : -1;
      const compare = (
        a: { createdOn: string; id: string },
        b: { createdOn: string; id: string }
      ) => direction * (a.createdOn.localeCompare(b.createdOn) || a.id.localeCompare(b.id));
      const ordered = jobsOf(name)
        .filter((job) => !query.state || job.state === query.state)
        .filter((job) => !query.id || job.id === query.id)
        .filter((job) => !query.singletonKey || job.singletonKey === query.singletonKey)
        .sort(compare);
      const limit = Number(query.limit);
      const cursor = query.cursor ? decodePgBossCursor(query.cursor) : null;
      const firstAfter = (strict: boolean) => {
        const at = ordered.findIndex((job) =>
          strict ? compare(job, cursor!) > 0 : compare(job, cursor!) >= 0
        );
        return at === -1 ? ordered.length : at;
      };
      let start = 0;
      let end = Math.min(limit, ordered.length);
      if (cursor?.direction === 'next') {
        start = firstAfter(true);
        end = Math.min(start + limit, ordered.length);
      } else if (cursor?.direction === 'prev') {
        end = firstAfter(false);
        start = Math.max(0, end - limit);
      }
      const page = ordered.slice(start, end);
      const first = page[0];
      const last = page[page.length - 1];
      return {
        jobs: page.map(toSummary),
        nextCursor:
          last && end < ordered.length
            ? encodePgBossCursor({ direction: 'next', createdOn: last.createdOn, id: last.id })
            : null,
        prevCursor:
          first && start > 0
            ? encodePgBossCursor({ direction: 'prev', createdOn: first.createdOn, id: first.id })
            : null,
      };
    },
    async getJob(name, id) {
      return jobsOf(name).find((job) => job.id === id) ?? null;
    },
    async findJob(id, queueNames) {
      const job = jobs.find(
        (candidate) => candidate.id === id && queueNames.includes(candidate.queueName)
      );
      return job ? toSummary(job) : null;
    },
    async queueDepth(_name, { from, to }) {
      if (missing.has('queueDepth')) throw unavailable('queueDepth');
      return (options.depth ?? []).filter((point) => point.ts >= from && point.ts <= to);
    },
    async listWarnings(query, isVisible) {
      if (missing.has('warnings')) throw unavailable('warnings');
      const names = [...queues.keys()];
      const shown = new Set<string>();
      for (const name of names) if (!hidden.has(name) && (await isVisible(name))) shown.add(name);
      const concealed = names.filter((name) => !shown.has(name));
      const ordered = warnings
        .filter((warning) => !query.type || warning.type === query.type)
        .map((warning) => ({ ...warning, queueName: warningQueueName(warning.data, shown) }));
      const compare = (
        a: { createdOn: string; id: string },
        b: { createdOn: string; id: string }
      ) => a.createdOn.localeCompare(b.createdOn) || a.id.localeCompare(b.id);
      return pageWarnings(
        async (after, descending, limit) =>
          ordered
            .filter(
              (warning) =>
                !after || (descending ? compare(warning, after) < 0 : compare(warning, after) > 0)
            )
            .sort((a, b) => (descending ? -compare(a, b) : compare(a, b)))
            .slice(0, limit),
        query,
        async (warning) => !concealed.some((name) => mentionsQueue(warning, name))
      );
    },
    async getDependencies() {
      return { dependencies: [], dependents: [] };
    },
    async listSchedules(queueName) {
      return schedules.filter((schedule) => !queueName || schedule.queueName === queueName);
    },
    async previewSchedule({ expression, count = 5 }) {
      if (!/^\S+( \S+){4,5}$/.test(expression)) {
        throw new PgBossEngineError(400, 'ERRORS.PGBOSS_INVALID_SCHEDULE', undefined, expression);
      }
      return Array.from({ length: count }, (_, i) => new Date(EPOCH + i * 3_600_000).toISOString());
    },
    async send(name, body) {
      const job = makeJob({ queueName: name, data: body.data ?? null }, jobs.length);
      jobs.push(job);
      return job.id;
    },
    async command(action, name, ids) {
      let affected = 0;
      for (const job of jobsOf(name)) {
        if (!ids.includes(job.id) || !ALLOWED[action].includes(job.state)) continue;
        affected += 1;
        if (action === 'delete') {
          jobs.splice(jobs.indexOf(job), 1);
        } else {
          job.state = NEXT_STATE[action];
        }
      }
      return { requested: ids.length, affected };
    },
    async retryFailed(name) {
      const ids = jobsOf(name)
        .filter((job) => job.state === 'failed')
        .map((job) => job.id);
      return engine.command('retry', name, ids);
    },
    async deleteQueued(name) {
      const ids = jobsOf(name)
        .filter((job) => job.state === 'created' || job.state === 'retry')
        .map((job) => job.id);
      return engine.command('delete', name, ids);
    },
    async deleteStored(name) {
      const ids = jobsOf(name)
        .filter((job) => ['completed', 'cancelled', 'failed'].includes(job.state))
        .map((job) => job.id);
      return engine.command('delete', name, ids);
    },
    async upsertSchedule(name, body) {
      const existing = schedules.findIndex(
        (schedule) => schedule.queueName === name && schedule.key === body.key
      );
      const schedule: PgBossSchedule = {
        queueName: name,
        key: body.key,
        kind: 'cron',
        expression: body.cron,
        timezone: body.tz ?? 'UTC',
        data: body.data ?? null,
        options: body.options,
        createdOn: new Date(EPOCH).toISOString(),
        updatedOn: new Date(EPOCH).toISOString(),
        lastJobId: null,
        nextRuns: [],
      };
      if (existing === -1) schedules.push(schedule);
      else schedules[existing] = schedule;
      return schedule;
    },
    async removeSchedule(name, key) {
      const at = schedules.findIndex(
        (schedule) => schedule.queueName === name && schedule.key === key
      );
      if (at !== -1) schedules.splice(at, 1);
      return { requested: 1, affected: at === -1 ? 0 : 1 };
    },
    isVisible(_request, queueName) {
      return !hidden.has(queueName);
    },
    async close() {},
  };

  return engine;
}

/** The stub the OpenAPI generator builds the pg-boss route table from. */
export const PGBOSS_STUB_ENGINE = createPgBossStubEngine();
