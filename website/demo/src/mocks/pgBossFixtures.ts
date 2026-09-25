// Seed data for the pg-boss half of the demo: one queue per pg-boss policy, a dead letter queue
// fed by one of them, a flow whose dependent is still blocked, deferred jobs, and cron and RRULE
// schedules. Everything is drawn from the seeded PRNG, so a reload shows the same board.
import type {
  PgBossDependencyRef,
  PgBossJob,
  PgBossJobState,
  PgBossSchedule,
} from '@worker-manager/api/typings/app';
import { hashStr, mulberry32 } from './prng';

/** A queue's configuration, the columns pg-boss keeps on `queue` besides the cached counters. */
export interface DemoPgBossQueue {
  name: string;
  policy: 'standard' | 'short' | 'singleton' | 'stately' | 'exclusive' | 'key_strict_fifo';
  partition: boolean;
  deadLetter: string | null;
  retryLimit: number;
  retryDelay: number;
  retryBackoff: boolean;
  retryDelayMax: number | null;
  expireInSeconds: number;
  retentionSeconds: number;
  deleteAfterSeconds: number;
  warningQueueSize: number;
  heartbeatSeconds: number | null;
  notify: boolean;
  createdOn: string;
  updatedOn: string;
}

/** A job as the demo stores it: the full row, plus the flow edges pg-boss keeps in its own table. */
export interface DemoPgBossJob extends PgBossJob {
  dependsOn: PgBossDependencyRef[];
}

export type DemoPgBossSchedule = Omit<PgBossSchedule, 'nextRuns'>;

export interface DemoPgBossState {
  queues: DemoPgBossQueue[];
  jobs: DemoPgBossJob[];
  schedules: DemoPgBossSchedule[];
  /** Deterministic randomness for everything created after seeding (sent jobs, new ids). */
  random: () => number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A v4 UUID drawn from the given generator, so ids are stable across reloads. */
export function uuidFrom(random: () => number): string {
  const bytes = Array.from({ length: 16 }, () => Math.floor(random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const pick = <T>(random: () => number, items: readonly T[]): T =>
  items[Math.floor(random() * items.length)];

const int = (random: () => number, min: number, max: number) =>
  min + Math.floor(random() * (max - min + 1));

interface QueueSpec extends Partial<DemoPgBossQueue> {
  name: string;
  policy: DemoPgBossQueue['policy'];
  /** How many jobs to seed in each state. */
  states: Partial<Record<PgBossJobState, number>>;
  /** How many of the `created` jobs start later. */
  deferred?: number;
  singletonKeys?: string[];
  groups?: string[];
  priorities?: number[];
  data: (random: () => number, index: number) => unknown;
  output?: (random: () => number, data: unknown) => unknown;
  error?: (random: () => number) => { message: string; stack?: string };
}

const CUSTOMERS = ['cus_4f2a', 'cus_81bd', 'cus_c09e', 'cus_77aa', 'cus_1d3f', 'cus_e5c2'];
const TEMPLATES = ['password-reset', 'receipt', 'magic-link', 'order-shipped', 'invite'];
const ENDPOINTS = [
  'https://hooks.acme.test/orders',
  'https://api.globex.test/webhooks/pg',
  'https://initech.test/integrations/events',
];

const stack = (message: string, where: string) =>
  `Error: ${message}\n    at ${where} (/app/dist/workers/${where}.js:42:17)\n    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)\n    at async PgBoss.work (/app/node_modules/pg-boss/dist/manager.js:412:24)`;

const QUEUE_SPECS: QueueSpec[] = [
  {
    name: 'emails.transactional',
    policy: 'standard',
    deadLetter: 'emails.dead-letter',
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 600,
    warningQueueSize: 15,
    notify: true,
    states: { created: 22, retry: 4, active: 3, completed: 64, cancelled: 2, failed: 7 },
    deferred: 5,
    priorities: [0, 0, 0, 5, 10],
    data: (random, index) => ({
      to: `user${1000 + index}@example.com`,
      template: pick(random, TEMPLATES),
      locale: pick(random, ['en-US', 'pt-BR', 'de-DE']),
    }),
    output: (random) => ({
      provider: 'ses',
      messageId: `0100019${int(random, 100000, 999999)}-mail`,
      durationMs: int(random, 90, 900),
    }),
    error: (random) => {
      const message = pick(random, [
        'SMTP 421: service not available, closing transmission channel',
        'Recipient address rejected: mailbox full',
        'getaddrinfo ENOTFOUND email-smtp.eu-west-1.amazonaws.com',
      ]);
      return { message, stack: stack(message, 'sendEmail') };
    },
  },
  {
    name: 'emails.dead-letter',
    policy: 'standard',
    retryLimit: 0,
    states: {},
    data: () => null,
  },
  {
    name: 'billing.invoice-sync',
    policy: 'singleton',
    retryLimit: 5,
    retryDelay: 60,
    retryBackoff: true,
    retryDelayMax: 3600,
    heartbeatSeconds: 60,
    states: { created: 6, active: 2, completed: 38, failed: 3, cancelled: 1 },
    singletonKeys: CUSTOMERS,
    data: (random) => ({
      customerId: pick(random, CUSTOMERS),
      since: new Date(Date.now() - int(random, 1, 7) * DAY).toISOString().slice(0, 10),
    }),
    output: (random) => ({ invoices: int(random, 0, 40), pushedToErp: true }),
    error: () => {
      const message = 'ERP responded 503: maintenance window';
      return { message, stack: stack(message, 'syncInvoices') };
    },
  },
  {
    name: 'billing.payouts',
    policy: 'exclusive',
    retryLimit: 2,
    retryDelay: 300,
    expireInSeconds: 1800,
    states: { created: 3, retry: 1, active: 1, completed: 21, failed: 1 },
    singletonKeys: ['acct_eu', 'acct_us', 'acct_br'],
    data: (random) => ({
      account: pick(random, ['acct_eu', 'acct_us', 'acct_br']),
      amountCents: int(random, 10_000, 9_000_000),
      currency: pick(random, ['EUR', 'USD', 'BRL']),
    }),
    output: (random) => ({ transferId: `tr_${int(random, 1e6, 9e6)}`, status: 'paid' }),
    error: () => {
      const message = 'Insufficient balance in the settlement account';
      return { message, stack: stack(message, 'payout') };
    },
  },
  {
    name: 'reports.nightly',
    policy: 'stately',
    partition: true,
    retryLimit: 1,
    expireInSeconds: 7200,
    deleteAfterSeconds: 30 * 24 * 3600,
    states: { created: 2, active: 1, completed: 18, cancelled: 1, failed: 1 },
    singletonKeys: ['sales', 'inventory', 'finance'],
    data: (random) => ({
      report: pick(random, ['sales', 'inventory', 'finance']),
      format: pick(random, ['csv', 'parquet']),
    }),
    output: (random) => ({
      rows: int(random, 12_000, 2_400_000),
      file: `s3://reports/2026/nightly-${int(random, 1, 28)}.parquet`,
    }),
    error: () => {
      const message = 'canceling statement due to statement timeout';
      return { message, stack: stack(message, 'buildReport') };
    },
  },
  {
    name: 'webhooks.deliver',
    policy: 'key_strict_fifo',
    retryLimit: 8,
    retryDelay: 10,
    retryBackoff: true,
    retryDelayMax: 1800,
    heartbeatSeconds: 30,
    states: { created: 9, retry: 3, active: 2, completed: 52, cancelled: 3, failed: 4 },
    singletonKeys: ENDPOINTS.map((url) => new URL(url).host),
    groups: ['tenant-acme', 'tenant-globex', 'tenant-initech'],
    data: (random, index) => ({
      endpoint: pick(random, ENDPOINTS),
      event: pick(random, ['order.created', 'order.paid', 'refund.issued']),
      sequence: 4000 + index,
    }),
    output: (random) => ({ status: 200, attemptMs: int(random, 40, 1200) }),
    error: (random) => {
      const message = pick(random, [
        'Webhook endpoint answered 502 Bad Gateway',
        'connect ETIMEDOUT 203.0.113.9:443',
      ]);
      return { message, stack: stack(message, 'deliverWebhook') };
    },
  },
  {
    name: 'media.thumbnails',
    policy: 'short',
    retryLimit: 2,
    expireInSeconds: 300,
    states: { created: 14, active: 4, completed: 90, failed: 2 },
    deferred: 2,
    singletonKeys: ['img_1', 'img_2', 'img_3', 'img_4', 'img_5', 'img_6', 'img_7', 'img_8'],
    data: (random) => ({
      assetId: `img_${int(random, 1, 8)}`,
      sizes: [64, 256, 1024],
      source: `s3://uploads/${uuidFrom(random).slice(0, 8)}.jpg`,
    }),
    output: (random) => ({ generated: 3, bytes: int(random, 40_000, 900_000) }),
    error: () => {
      const message = 'Input buffer contains unsupported image format';
      return { message, stack: stack(message, 'resize') };
    },
  },
];

const STATE_ORDER: PgBossJobState[] = [
  'created',
  'retry',
  'active',
  'completed',
  'cancelled',
  'failed',
];

function baseQueue(spec: QueueSpec, now: number): DemoPgBossQueue {
  const created = new Date(now - 120 * DAY).toISOString();
  return {
    partition: false,
    deadLetter: null,
    retryLimit: 2,
    retryDelay: 0,
    retryBackoff: false,
    retryDelayMax: null,
    expireInSeconds: 900,
    retentionSeconds: 1_209_600,
    deleteAfterSeconds: 604_800,
    warningQueueSize: 0,
    heartbeatSeconds: null,
    notify: false,
    createdOn: created,
    updatedOn: new Date(now - 3 * DAY).toISOString(),
    ...Object.fromEntries(
      Object.entries(spec).filter(
        ([key]) =>
          ![
            'states',
            'deferred',
            'singletonKeys',
            'groups',
            'priorities',
            'data',
            'output',
            'error',
          ].includes(key)
      )
    ),
  } as DemoPgBossQueue;
}

function makeJob(
  queue: DemoPgBossQueue,
  spec: QueueSpec,
  state: PgBossJobState,
  index: number,
  random: () => number,
  now: number,
  deferred: boolean
): DemoPgBossJob {
  // Terminal jobs are older, queued ones newer, so the newest-first list reads naturally.
  const ageMs =
    state === 'completed' || state === 'cancelled' || state === 'failed'
      ? int(random, 3 * MINUTE, 20 * HOUR)
      : state === 'active'
        ? int(random, 5_000, 4 * MINUTE)
        : int(random, 2_000, 45 * MINUTE);
  const createdAt = now - ageMs - (index % 997);
  const startAfterAt = deferred
    ? now + int(random, 10 * MINUTE, 6 * HOUR)
    : state === 'retry'
      ? now + int(random, 20_000, 10 * MINUTE)
      : createdAt;
  const startedAt =
    state === 'created' ? null : Math.min(now - 1_000, createdAt + int(random, 200, 30_000));
  const finishedAt =
    state === 'completed' || state === 'failed' || state === 'cancelled'
      ? Math.min(now - 500, (startedAt ?? createdAt) + int(random, 80, 90_000))
      : null;
  const data = spec.data(random, index);
  const retryLimit = queue.retryLimit;
  const retryCount =
    state === 'failed'
      ? retryLimit
      : state === 'retry'
        ? int(random, 1, Math.max(1, retryLimit - 1))
        : state === 'completed' && random() < 0.12
          ? int(random, 1, Math.max(1, retryLimit))
          : 0;
  const error = state === 'failed' || state === 'retry' ? spec.error?.(random) : undefined;
  const singletonKey =
    spec.singletonKeys && random() < 0.85 ? pick(random, spec.singletonKeys) : null;
  const groupId = spec.groups ? pick(random, spec.groups) : null;
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

  return {
    id: uuidFrom(random),
    queueName: queue.name,
    state,
    priority: spec.priorities ? pick(random, spec.priorities) : 0,
    retryCount,
    retryLimit,
    createdOn: iso(createdAt)!,
    startAfter: iso(startAfterAt)!,
    startedOn: iso(startedAt),
    completedOn: iso(finishedAt),
    singletonKey,
    groupId,
    deferred,
    blocked: false,
    deadLetterSource: null,
    data,
    output:
      state === 'completed'
        ? (spec.output?.(random, data) ?? null)
        : state === 'failed' || state === 'retry'
          ? (error ?? null)
          : null,
    policy: queue.policy,
    retryDelay: queue.retryDelay,
    retryBackoff: queue.retryBackoff,
    retryDelayMax: queue.retryDelayMax,
    expireInSeconds: queue.expireInSeconds,
    deleteAfterSeconds: queue.deleteAfterSeconds,
    keepUntil: iso(startAfterAt + queue.retentionSeconds * 1000)!,
    singletonOn: null,
    groupTier: groupId ? pick(random, ['standard', 'priority']) : null,
    heartbeatSeconds: queue.heartbeatSeconds,
    heartbeatOn:
      state === 'active' && queue.heartbeatSeconds
        ? iso(now - int(random, 1_000, queue.heartbeatSeconds * 1000))
        : null,
    deadLetter: queue.deadLetter,
    blocking: false,
    pendingDependencies: 0,
    dependsOn: [],
  };
}

/**
 * Two flows on `reports.nightly`: the `merge` job of the first still waits on an extract that
 * is running, so it is blocked; the second has finished and shows its edges as history.
 */
function seedFlows(
  state: DemoPgBossState,
  queue: DemoPgBossQueue,
  random: () => number,
  now: number
) {
  const spec = QUEUE_SPECS.find((candidate) => candidate.name === queue.name)!;
  const flow = (finished: boolean, offsetMs: number) => {
    const sources = ['orders', 'refunds', 'shipments'].map((source, index) => {
      const jobState: PgBossJobState = finished
        ? 'completed'
        : index === 2
          ? 'active'
          : 'completed';
      const job = makeJob(queue, spec, jobState, 5000 + index, random, now - offsetMs, false);
      job.data = {
        step: 'extract',
        source,
        date: new Date(now - offsetMs).toISOString().slice(0, 10),
      };
      job.output = jobState === 'completed' ? { rows: int(random, 50_000, 900_000), source } : null;
      job.blocking = true;
      job.singletonKey = null;
      return job;
    });
    const merge = makeJob(
      queue,
      spec,
      finished ? 'completed' : 'created',
      5100,
      random,
      now - offsetMs,
      false
    );
    merge.data = { step: 'merge', inputs: sources.map((job) => job.data) };
    merge.singletonKey = null;
    merge.dependsOn = sources.map((job) => ({ queueName: job.queueName, id: job.id }));
    merge.pendingDependencies = sources.filter((job) => job.state !== 'completed').length;
    merge.blocked = merge.pendingDependencies > 0;
    if (!finished) {
      merge.output = null;
      merge.startAfter = merge.createdOn;
    } else {
      merge.output = {
        rows: int(random, 1_000_000, 2_000_000),
        file: 's3://reports/merged.parquet',
      };
    }
    state.jobs.push(...sources, merge);
  };
  flow(false, 0);
  flow(true, 1 * DAY);
}

/**
 * The dead letter queue: pg-boss files a copy of every job that ran out of retries on a queue
 * with `deadLetter`, and remembers where it came from in the `source_*` columns.
 */
function seedDeadLetters(state: DemoPgBossState, random: () => number) {
  const dlq = state.queues.find((queue) => queue.name === 'emails.dead-letter')!;
  const failed = state.jobs.filter(
    (job) => job.queueName === 'emails.transactional' && job.state === 'failed'
  );
  failed.forEach((source, index) => {
    const createdAt = Date.parse(source.completedOn ?? source.createdOn) + 5;
    const inspected = index < 2;
    state.jobs.push({
      ...source,
      id: uuidFrom(random),
      queueName: dlq.name,
      state: inspected ? 'completed' : 'created',
      retryCount: 0,
      retryLimit: dlq.retryLimit,
      createdOn: new Date(createdAt).toISOString(),
      startAfter: new Date(createdAt).toISOString(),
      startedOn: inspected ? new Date(createdAt + 60_000).toISOString() : null,
      completedOn: inspected ? new Date(createdAt + 61_000).toISOString() : null,
      output: inspected ? { archived: true, ticket: `OPS-${int(random, 1000, 9999)}` } : null,
      policy: dlq.policy,
      deadLetter: null,
      keepUntil: new Date(createdAt + dlq.retentionSeconds * 1000).toISOString(),
      deadLetterSource: {
        queueName: source.queueName,
        id: source.id,
        createdOn: source.createdOn,
        retryCount: source.retryCount,
      },
      dependsOn: [],
    });
  });
}

function seedSchedules(state: DemoPgBossState, now: number) {
  const at = (ms: number) => new Date(now - ms).toISOString();
  state.schedules.push(
    {
      queueName: 'reports.nightly',
      key: 'sales',
      kind: 'cron',
      expression: '0 2 * * *',
      timezone: 'America/Sao_Paulo',
      data: { report: 'sales', format: 'parquet' },
      options: { singletonKey: 'sales', retryLimit: 1 },
      createdOn: at(40 * DAY),
      updatedOn: at(6 * DAY),
      lastJobId: null,
    },
    {
      queueName: 'reports.nightly',
      key: 'inventory',
      kind: 'rrule',
      expression: 'FREQ=WEEKLY;BYDAY=MO,TH;BYHOUR=6;BYMINUTE=30',
      timezone: 'UTC',
      data: { report: 'inventory', format: 'csv' },
      options: { singletonKey: 'inventory', missed: 'once' },
      createdOn: at(12 * DAY),
      updatedOn: at(12 * DAY),
      lastJobId: null,
    },
    {
      queueName: 'billing.invoice-sync',
      key: '',
      kind: 'cron',
      expression: '*/15 * * * *',
      timezone: 'UTC',
      data: { customerId: 'all', since: 'last-run' },
      options: {},
      createdOn: at(90 * DAY),
      updatedOn: at(90 * DAY),
      lastJobId: null,
    },
    {
      queueName: 'billing.payouts',
      key: 'eu-weekdays',
      kind: 'rrule',
      expression: 'DTSTART:20260105T160000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      timezone: 'Europe/Berlin',
      data: { account: 'acct_eu', currency: 'EUR' },
      options: { priority: 10 },
      createdOn: at(30 * DAY),
      updatedOn: at(2 * DAY),
      lastJobId: null,
    },
    {
      queueName: 'media.thumbnails',
      key: 'cleanup',
      kind: 'cron',
      expression: '30 3 * * 0',
      timezone: 'UTC',
      data: { sweep: 'orphans' },
      options: { expireInSeconds: 900 },
      createdOn: at(60 * DAY),
      updatedOn: at(60 * DAY),
      lastJobId: null,
    }
  );

  // The last job a schedule sent, the way pg-boss 12.31+ records it.
  for (const schedule of state.schedules) {
    const last = state.jobs
      .filter((job) => job.queueName === schedule.queueName && job.state === 'completed')
      .sort((a, b) => b.createdOn.localeCompare(a.createdOn))[0];
    schedule.lastJobId = last?.id ?? null;
  }
}

export function seedPgBossFixtures(now = Date.now()): DemoPgBossState {
  const random = mulberry32(hashStr('worker-manager pg-boss demo'));
  const state: DemoPgBossState = { queues: [], jobs: [], schedules: [], random };

  for (const spec of QUEUE_SPECS) {
    const queue = baseQueue(spec, now);
    state.queues.push(queue);
    const queueRandom = mulberry32(hashStr(queue.name));
    let index = 0;
    for (const jobState of STATE_ORDER) {
      const count = spec.states[jobState] ?? 0;
      for (let i = 0; i < count; i++) {
        const deferred = jobState === 'created' && i < (spec.deferred ?? 0);
        state.jobs.push(makeJob(queue, spec, jobState, index++, queueRandom, now, deferred));
      }
    }
  }

  seedFlows(
    state,
    state.queues.find((queue) => queue.name === 'reports.nightly')!,
    random,
    now
  );
  seedDeadLetters(state, random);
  seedSchedules(state, now);
  return state;
}
