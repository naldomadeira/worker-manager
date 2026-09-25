import { PgBossEngineError, type PgBossEngine } from '@worker-manager/api/engine';
import type {
  PgBossCapabilities,
  PgBossInfo,
  PgBossJob,
  PgBossJobState,
  PgBossJobSummary,
  PgBossQueueSummary,
  PgBossSchedule,
  PgBossStateCounts,
} from '@worker-manager/api/typings/app';
import {
  type DemoPgBossJob,
  type DemoPgBossQueue,
  type DemoPgBossSchedule,
  type DemoPgBossState,
  uuidFrom,
} from './pgBossFixtures';
import { hashStr, mulberry32 } from './prng';
import { InvalidScheduleError, nextRuns, scheduleKind } from './scheduleRuns';

const STATES: PgBossJobState[] = ['created', 'retry', 'active', 'completed', 'cancelled', 'failed'];
const COUNT_CAP = 10_000;
/** How long ago the pretend `supervise` last wrote the cached counters. */
const STATS_AGE_MS = 25_000;

const ALLOWED: Record<'retry' | 'cancel' | 'resume' | 'delete', PgBossJobState[]> = {
  retry: ['failed'],
  cancel: ['created', 'retry', 'active'],
  resume: ['cancelled'],
  delete: ['created', 'retry', 'completed', 'cancelled', 'failed'],
};

/** The policies under which pg-boss refuses a second queued job with the same singleton key. */
const QUEUED_SINGLETON_POLICIES = new Set(['short', 'stately', 'exclusive']);

const SUMMARY_FIELDS: (keyof PgBossJobSummary)[] = [
  'id',
  'queueName',
  'state',
  'priority',
  'retryCount',
  'retryLimit',
  'createdOn',
  'startAfter',
  'startedOn',
  'completedOn',
  'singletonKey',
  'groupId',
  'deferred',
  'blocked',
  'deadLetterSource',
];

type Cursor = { direction: 'next' | 'prev'; createdOn: string; id: string };

// The real cursor is base64url of the same three fields; the demo builds it without Buffer.
function encodeCursor({ direction, createdOn, id }: Cursor): string {
  return btoa(`${direction}|${createdOn}|${id}`)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function decodeCursor(cursor: string): Cursor {
  try {
    const [direction, createdOn, id, ...rest] = atob(
      cursor.replace(/-/g, '+').replace(/_/g, '/')
    ).split('|');
    if (
      rest.length === 0 &&
      (direction === 'next' || direction === 'prev') &&
      !Number.isNaN(Date.parse(createdOn)) &&
      !!id
    ) {
      return { direction, createdOn, id };
    }
  } catch {}
  throw new PgBossEngineError(400, 'ERRORS.PGBOSS_INVALID_CURSOR');
}

function toSummary(job: DemoPgBossJob): PgBossJobSummary {
  return Object.fromEntries(
    SUMMARY_FIELDS.map((field) => [field, job[field]])
  ) as unknown as PgBossJobSummary;
}

function toJob({ dependsOn: _edges, ...job }: DemoPgBossJob): PgBossJob {
  return job;
}

function invalidSchedule(error: unknown): never {
  throw new PgBossEngineError(
    400,
    'ERRORS.PGBOSS_INVALID_SCHEDULE',
    undefined,
    error instanceof Error ? `Invalid schedule: ${error.message}` : undefined
  );
}

/**
 * An in-memory {@link PgBossEngine} over the demo fixtures. It keeps pg-boss's state rules
 * (which command applies in which state, singleton keys, dead letter sources, blocked flow
 * dependents) and answers every route the real engine does, so the pg-boss pages run unchanged.
 */
export class MockPgBossEngine implements PgBossEngine {
  constructor(private readonly state: DemoPgBossState) {}

  private get now() {
    return Date.now();
  }

  private queue(name: string): DemoPgBossQueue | undefined {
    return this.state.queues.find((queue) => queue.name === name);
  }

  private jobsOf(name: string): DemoPgBossJob[] {
    return this.state.jobs.filter((job) => job.queueName === name);
  }

  private findJob(name: string, id: string): DemoPgBossJob | undefined {
    return this.state.jobs.find((job) => job.queueName === name && job.id === id);
  }

  /** Deferred and blocked are derived, so they follow the clock and the flow as it completes. */
  private refresh(job: DemoPgBossJob) {
    job.deferred = job.state === 'created' && Date.parse(job.startAfter) > this.now;
    if (job.dependsOn.length > 0) {
      job.pendingDependencies = job.dependsOn.filter(
        (ref) => this.findJob(ref.queueName, ref.id)?.state !== 'completed'
      ).length;
      job.blocked = job.state === 'created' && job.pendingDependencies > 0;
    }
  }

  private summary(queue: DemoPgBossQueue): PgBossQueueSummary {
    const jobs = this.jobsOf(queue.name);
    jobs.forEach((job) => this.refresh(job));
    const queued = jobs.filter((job) => job.state === 'created' || job.state === 'retry');
    const deferred = queued.filter((job) => Date.parse(job.startAfter) > this.now).length;
    const ready = queued.filter(
      (job) => Date.parse(job.startAfter) <= this.now && !job.blocked
    ).length;
    const active = jobs.filter((job) => job.state === 'active');
    const random = mulberry32(hashStr(`${queue.name}:ready-history`));
    // A gentle wave with a little noise, ending on the current count, the way the monitor's
    // 60 samples of `ready_history` look on a queue that drains and refills.
    const phase = random() * Math.PI * 2;
    const peak = Math.max(ready, 4);
    const readyHistory = Array.from({ length: 60 }, (_, index) =>
      Math.max(0, Math.round(peak * (0.55 + 0.35 * Math.sin(index / 7 + phase) + 0.1 * random())))
    );
    readyHistory[59] = ready;

    return {
      name: queue.name,
      policy: queue.policy,
      partition: queue.partition,
      counts: {
        queued: queued.length,
        deferred,
        ready,
        active: active.length,
        failed: jobs.filter((job) => job.state === 'failed').length,
        total: jobs.length,
      },
      statsCapturedOn: new Date(this.now - STATS_AGE_MS).toISOString(),
      readyHistory,
      deadLetter: queue.deadLetter,
      retryLimit: queue.retryLimit,
      retryDelay: queue.retryDelay,
      retryBackoff: queue.retryBackoff,
      retryDelayMax: queue.retryDelayMax,
      expireInSeconds: queue.expireInSeconds,
      retentionSeconds: queue.retentionSeconds,
      deleteAfterSeconds: queue.deleteAfterSeconds,
      warningQueueSize: queue.warningQueueSize,
      backlogged: queue.warningQueueSize > 0 && queued.length > queue.warningQueueSize,
      heartbeatSeconds: queue.heartbeatSeconds,
      notify: queue.notify,
      singletonsActive:
        queue.policy === 'singleton' || queue.policy === 'key_strict_fifo'
          ? [...new Set(active.map((job) => job.singletonKey).filter((key) => key !== null))]
          : null,
      scheduleCount: this.state.schedules.filter((schedule) => schedule.queueName === queue.name)
        .length,
      createdOn: queue.createdOn,
      updatedOn: queue.updatedOn,
    };
  }

  private withRuns(schedule: DemoPgBossSchedule): PgBossSchedule {
    let runs: string[] = [];
    try {
      runs = nextRuns(schedule.expression, { tz: schedule.timezone });
    } catch {}
    return { ...schedule, nextRuns: runs };
  }

  async info(): Promise<PgBossInfo> {
    const capabilities: PgBossCapabilities = {
      send: true,
      retry: true,
      cancel: true,
      resume: true,
      delete: true,
      scheduleWrite: true,
      schedulePreview: true,
      bulk: true,
    };
    return {
      schema: 'pgboss',
      delimiter: '.',
      installed: true,
      schemaVersion: 42,
      supportedRange: { min: 35, max: 42 },
      readable: true,
      writable: true,
      readOnly: false,
      unavailableReason: null,
      writesDisabledReason: null,
      persistQueueStats: true,
      datastore: {
        backend: 'postgres',
        version: '17.6',
        port: 5432,
        os: 'Linux 6.8.0 x86_64',
        uptime: 1_987_200,
        clients: { connected: 14, blocked: 0 },
      },
      capabilities,
    };
  }

  async readGate() {
    return null;
  }

  async writeGate() {
    return null;
  }

  async listQueues() {
    return this.state.queues.map((queue) => this.summary(queue));
  }

  async getQueue(name: string) {
    const queue = this.queue(name);
    return queue ? this.summary(queue) : null;
  }

  async countStates(name: string) {
    const jobs = this.jobsOf(name);
    const counts = Object.fromEntries(
      STATES.map((state) => {
        const count = jobs.filter((job) => job.state === state).length;
        return [state, { count: Math.min(count, COUNT_CAP), capped: count > COUNT_CAP }];
      })
    ) as PgBossStateCounts;
    return { counts, cap: COUNT_CAP };
  }

  async listJobs(name: string, query: Parameters<PgBossEngine['listJobs']>[1]) {
    const direction = query.order === 'asc' ? 1 : -1;
    const compare = (a: { createdOn: string; id: string }, b: { createdOn: string; id: string }) =>
      direction * (a.createdOn.localeCompare(b.createdOn) || a.id.localeCompare(b.id));
    const ordered = this.jobsOf(name)
      .filter((job) => !query.state || job.state === query.state)
      .filter((job) => !query.id || job.id === query.id)
      .filter((job) => !query.singletonKey || job.singletonKey === query.singletonKey)
      .sort(compare);
    ordered.forEach((job) => this.refresh(job));

    const limit = Number(query.limit);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
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
          ? encodeCursor({ direction: 'next', createdOn: last.createdOn, id: last.id })
          : null,
      prevCursor:
        first && start > 0
          ? encodeCursor({ direction: 'prev', createdOn: first.createdOn, id: first.id })
          : null,
    };
  }

  async getJob(name: string, id: string) {
    const job = this.findJob(name, id);
    if (!job) return null;
    this.refresh(job);
    return toJob(job);
  }

  async getDependencies(name: string, id: string) {
    const job = this.findJob(name, id);
    return {
      dependencies: job?.dependsOn ?? [],
      dependents: this.state.jobs
        .filter((other) => other.dependsOn.some((ref) => ref.queueName === name && ref.id === id))
        .map((other) => ({ queueName: other.queueName, id: other.id })),
    };
  }

  async listSchedules(queueName?: string) {
    return this.state.schedules
      .filter((schedule) => !queueName || schedule.queueName === queueName)
      .map((schedule) => this.withRuns(schedule));
  }

  async previewSchedule({ expression, tz, count }: Parameters<PgBossEngine['previewSchedule']>[0]) {
    try {
      return nextRuns(expression, { tz, count });
    } catch (error) {
      if (error instanceof InvalidScheduleError) invalidSchedule(error);
      throw error;
    }
  }

  async send(name: string, body: Parameters<PgBossEngine['send']>[1]) {
    const queue = this.queue(name);
    if (!queue) throw new PgBossEngineError(404, 'ERRORS.QUEUE_NOT_FOUND');
    const options = body.options ?? {};
    const singletonKey = options.singletonKey ?? null;
    if (
      singletonKey &&
      QUEUED_SINGLETON_POLICIES.has(queue.policy) &&
      this.jobsOf(name).some(
        (job) =>
          job.singletonKey === singletonKey && (job.state === 'created' || job.state === 'retry')
      )
    ) {
      return null;
    }

    const now = this.now;
    const startAfter =
      options.startAfter === undefined
        ? now
        : typeof options.startAfter === 'number'
          ? now + options.startAfter * 1000
          : Date.parse(options.startAfter) || now;
    const job: DemoPgBossJob = {
      id: uuidFrom(this.state.random),
      queueName: name,
      state: 'created',
      priority: options.priority ?? 0,
      retryCount: 0,
      retryLimit: options.retryLimit ?? queue.retryLimit,
      createdOn: new Date(now).toISOString(),
      startAfter: new Date(startAfter).toISOString(),
      startedOn: null,
      completedOn: null,
      singletonKey,
      groupId: null,
      deferred: startAfter > now,
      blocked: false,
      deadLetterSource: null,
      data: body.data ?? null,
      output: null,
      policy: queue.policy,
      retryDelay: options.retryDelay ?? queue.retryDelay,
      retryBackoff: options.retryBackoff ?? queue.retryBackoff,
      retryDelayMax: queue.retryDelayMax,
      expireInSeconds: options.expireInSeconds ?? queue.expireInSeconds,
      deleteAfterSeconds: queue.deleteAfterSeconds,
      keepUntil: new Date(startAfter + queue.retentionSeconds * 1000).toISOString(),
      singletonOn: null,
      groupTier: null,
      heartbeatSeconds: queue.heartbeatSeconds,
      heartbeatOn: null,
      deadLetter: queue.deadLetter,
      blocking: false,
      pendingDependencies: 0,
      dependsOn: [],
    };
    this.state.jobs.push(job);
    return job.id;
  }

  async command(action: 'retry' | 'cancel' | 'resume' | 'delete', name: string, ids: string[]) {
    const now = new Date(this.now).toISOString();
    let affected = 0;
    for (const job of this.jobsOf(name)) {
      if (!ids.includes(job.id) || !ALLOWED[action].includes(job.state)) continue;
      affected += 1;
      switch (action) {
        case 'delete':
          this.state.jobs.splice(this.state.jobs.indexOf(job), 1);
          break;
        case 'cancel':
          job.state = 'cancelled';
          job.completedOn = now;
          break;
        case 'resume':
          job.state = 'created';
          job.completedOn = null;
          job.startAfter = now;
          break;
        case 'retry':
          // Like `boss.retry()`: back to `retry`, with one more attempt if it had none left.
          job.state = 'retry';
          job.completedOn = null;
          job.startAfter = now;
          if (job.retryCount >= job.retryLimit) job.retryLimit = job.retryCount + 1;
          break;
      }
    }
    return { requested: ids.length, affected };
  }

  private idsIn(name: string, states: PgBossJobState[]) {
    return this.jobsOf(name)
      .filter((job) => states.includes(job.state))
      .map((job) => job.id);
  }

  async retryFailed(name: string) {
    return this.command('retry', name, this.idsIn(name, ['failed']));
  }

  async deleteQueued(name: string) {
    return this.command('delete', name, this.idsIn(name, ['created', 'retry']));
  }

  async deleteStored(name: string) {
    return this.command('delete', name, this.idsIn(name, ['completed', 'cancelled', 'failed']));
  }

  async upsertSchedule(name: string, body: Parameters<PgBossEngine['upsertSchedule']>[1]) {
    const timezone = body.tz ?? 'UTC';
    try {
      nextRuns(body.cron, { tz: timezone, count: 1 });
    } catch (error) {
      if (error instanceof InvalidScheduleError) invalidSchedule(error);
      throw error;
    }
    const now = new Date(this.now).toISOString();
    const existing = this.state.schedules.findIndex(
      (schedule) => schedule.queueName === name && schedule.key === body.key
    );
    const schedule: DemoPgBossSchedule = {
      queueName: name,
      key: body.key,
      kind: scheduleKind(body.cron),
      expression: body.cron,
      timezone,
      data: body.data ?? null,
      options: { ...body.options, ...(body.missed ? { missed: body.missed } : {}) },
      createdOn: existing === -1 ? now : this.state.schedules[existing].createdOn,
      updatedOn: now,
      lastJobId: existing === -1 ? null : this.state.schedules[existing].lastJobId,
    };
    if (existing === -1) this.state.schedules.push(schedule);
    else this.state.schedules[existing] = schedule;
    return this.withRuns(schedule);
  }

  async removeSchedule(name: string, key: string) {
    const at = this.state.schedules.findIndex(
      (schedule) => schedule.queueName === name && schedule.key === key
    );
    if (at !== -1) this.state.schedules.splice(at, 1);
    return { requested: 1, affected: at === -1 ? 0 : 1 };
  }

  isVisible() {
    return true;
  }

  async close() {}
}
