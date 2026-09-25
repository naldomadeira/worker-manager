import {
  MetricsRecorder,
  namespacedHistoryProvider,
  PostgresMetricsHistoryProvider,
  PostgresMetricsStore,
} from '@worker-manager/metrics';
import {
  createPgBossEngine,
  isUsableMetricsIndex,
  pgBossMetricsIndexDdl,
  pgBossMetricsNamespace,
  pgBossMetricsSources,
  readPgBossQueueDepth,
} from '../src';
import { describeWithPostgres, installSchema, jobIn, POSTGRES_URL } from './support';

const MS_PER_MINUTE = 60000;

describe('isUsableMetricsIndex', () => {
  it.each([
    ['CREATE INDEX a ON s.job USING btree (name, completed_on)', true],
    ['CREATE INDEX a ON s.job USING btree (name, completed_on DESC, id)', true],
    ['CREATE INDEX a ON s.job USING btree (name, completed_on) INCLUDE (state)', true],
    [
      "CREATE INDEX a ON s.job USING btree (name, completed_on) WHERE (state = ANY (ARRAY['completed'::s.job_state, 'failed'::s.job_state]))",
      true,
    ],
    [
      "CREATE INDEX a ON s.job USING btree (name, completed_on) WHERE (state = 'completed'::s.job_state)",
      false,
    ],
    ['CREATE INDEX a ON s.job USING btree (completed_on)', false],
    ['CREATE INDEX a ON s.job USING btree (name, state, completed_on)', false],
    ['CREATE INDEX a ON s.job USING hash (name)', false],
  ])('%s -> %s', (indexdef, usable) => {
    expect(isUsableMetricsIndex(indexdef)).toBe(usable);
  });
});

describeWithPostgres('pg-boss metrics sources', () => {
  let seed: Awaited<ReturnType<typeof installSchema>>;
  let engine: ReturnType<typeof createPgBossEngine>;

  const minuteAgo = (minutes: number) => Math.floor(Date.now() / MS_PER_MINUTE) - minutes;

  /** Moves a job's timestamps to fixed points, the way a worker would have left them. */
  const finishAt = async (
    queue: string,
    state: 'completed' | 'failed' | 'cancelled',
    {
      startAfter,
      startedOn,
      completedOn,
      retryCount = 0,
    }: {
      startAfter: number;
      startedOn: number;
      completedOn: number;
      retryCount?: number;
    }
  ) => {
    const id = await jobIn(seed, queue, state === 'cancelled' ? 'cancelled' : state);
    await seed.admin.query(
      `UPDATE "${seed.schema}".job
          SET start_after = to_timestamp($3 / 1000.0), started_on = to_timestamp($4 / 1000.0),
              completed_on = to_timestamp($5 / 1000.0), retry_count = $6
        WHERE name = $1 AND id = $2`,
      [queue, id, startAfter, startedOn, completedOn, retryCount]
    );
    return id;
  };

  const createIndex = () =>
    seed.admin.query(
      `CREATE INDEX IF NOT EXISTS wm_job_completed_on ON "${seed.schema}".job (name, completed_on)`
    );
  const dropIndex = () =>
    seed.admin.query(`DROP INDEX IF EXISTS "${seed.schema}".wm_job_completed_on`);

  beforeAll(async () => {
    seed = await installSchema('metrics');
    for (const queue of ['emails', 'reports', 'hidden', 'idle']) {
      await seed.app.createQueue(queue);
    }
    engine = createPgBossEngine({
      connection: POSTGRES_URL,
      schema: seed.schema,
      queues: (name) => name !== 'hidden',
    });

    const m = minuteAgo(3) * MS_PER_MINUTE;
    await finishAt('emails', 'completed', {
      startAfter: m,
      startedOn: m + 1000,
      completedOn: m + 3000,
    });
    await finishAt('emails', 'completed', {
      startAfter: m,
      startedOn: m + 2000,
      completedOn: m + 7000,
    });
    await finishAt('emails', 'failed', {
      startAfter: m,
      startedOn: m + 1000,
      completedOn: m + 2000,
      retryCount: 2,
    });
    await finishAt('emails', 'cancelled', { startAfter: m, startedOn: m, completedOn: m + 1000 });
    await finishAt('reports', 'completed', { startAfter: m, startedOn: m, completedOn: m + 500 });
  });

  afterAll(async () => {
    await engine?.close();
    await seed?.teardown();
  });

  afterEach(async () => {
    await dropIndex();
  });

  it('names each visible queue under the schema namespace and its own rollup', async () => {
    await createIndex();
    const sources = pgBossMetricsSources(engine, { onWarning: () => undefined });
    const namespace = pgBossMetricsNamespace(seed.schema);

    const list = await sources();

    expect(sources.namespace).toBe(namespace);
    expect(list.map((source) => source.name).sort()).toEqual(
      ['emails', 'idle', 'reports'].map((queue) => `${namespace}${queue}`)
    );
    expect(new Set(list.map((source) => source.rollup))).toEqual(
      new Set([`${namespace}__global__`])
    );
  });

  it('counts finished minutes by state, leaving out cancels and the minute in progress', async () => {
    await createIndex();
    const sources = pgBossMetricsSources(engine, { onWarning: () => undefined });
    const emails = (await sources()).find((source) => source.name.endsWith(':emails'))!;
    const from = minuteAgo(60) * MS_PER_MINUTE;
    const to = (minuteAgo(0) + 1) * MS_PER_MINUTE;
    const justNow = await jobIn(seed, 'emails', 'completed');

    try {
      expect(await emails.readMinutes('completed', from, to)).toEqual([
        { minute: minuteAgo(3), value: 2 },
      ]);
      expect(await emails.readMinutes('failed', from, to)).toEqual([
        { minute: minuteAgo(3), value: 1 },
      ]);
      expect(await emails.readMinutes('completed', minuteAgo(2) * MS_PER_MINUTE, to)).toEqual([]);
    } finally {
      await seed.admin.query(`DELETE FROM "${seed.schema}".job WHERE id = $1`, [justNow]);
    }
  });

  it('keeps the counters and the latency scan off without the index, and says how to fix it', async () => {
    const warnings: string[] = [];
    const sources = pgBossMetricsSources(engine, {
      onWarning: (message) => warnings.push(message),
      indexRecheckMs: 0,
    });
    const emails = (await sources()).find((source) => source.name.endsWith(':emails'))!;
    const from = minuteAgo(60) * MS_PER_MINUTE;
    const to = minuteAgo(0) * MS_PER_MINUTE;

    expect(await emails.readMinutes('completed', from, to)).toEqual([]);
    expect(await emails.jobSource()!.finishedJobs(from, to, 100)).toEqual({
      total: 0,
      sampled: 0,
      jobs: [],
    });
    expect(
      warnings.some((w) => w.includes('"emails"') && w.includes(pgBossMetricsIndexDdl(seed.schema)))
    ).toBe(true);
    expect(warnings.some((w) => w.includes('"hidden"'))).toBe(false);

    await createIndex();

    expect(await emails.readMinutes('completed', from, to)).toEqual([
      { minute: minuteAgo(3), value: 2 },
    ]);
  });

  it('reads job timings as run = completed - started, wait = started - start_after', async () => {
    await createIndex();
    const sources = pgBossMetricsSources(engine, { onWarning: () => undefined });
    const emails = (await sources()).find((source) => source.name.endsWith(':emails'))!;
    const m = minuteAgo(3) * MS_PER_MINUTE;

    const all = await emails.jobSource()!.finishedJobs(m - 1, m + MS_PER_MINUTE, 100);
    const sampled = await emails.jobSource()!.finishedJobs(m - 1, m + MS_PER_MINUTE, 2);

    expect(all.total).toBe(3);
    expect(
      all.jobs.map((job) => ({
        run: job.finishedOn - job.processedOn,
        wait: job.processedOn - job.timestamp!,
        attempts: job.attempts,
      }))
    ).toEqual([
      { run: 1000, wait: 1000, attempts: 3 },
      { run: 2000, wait: 1000, attempts: 1 },
      { run: 5000, wait: 2000, attempts: 1 },
    ]);
    expect(sampled).toMatchObject({ total: 3, sampled: 2 });
  });

  it('ages the backlog from the oldest due job, ignoring deferred ones', async () => {
    const queue = 'idle';
    const sources = pgBossMetricsSources(engine, { onWarning: () => undefined });
    const idle = (await sources()).find((source) => source.name.endsWith(':idle'))!;

    expect(await idle.jobSource()!.oldestWaitingAge(Date.now())).toBe(0);

    const due = await jobIn(seed, queue, 'created');
    await seed.app.send(queue, {}, { startAfter: 3600 });
    await seed.admin.query(
      `UPDATE "${seed.schema}".job SET start_after = now() - interval '30 seconds' WHERE id = $1`,
      [due]
    );

    const age = await idle.jobSource()!.oldestWaitingAge(Date.now());
    expect(age).toBeGreaterThanOrEqual(30000);
    expect(age).toBeLessThan(60000);
    await seed.app.deleteQueuedJobs(queue);
  });

  it('builds and closes an engine of its own from connection options', async () => {
    await createIndex();
    const sources = pgBossMetricsSources(
      { connection: POSTGRES_URL, schema: seed.schema, queues: ['reports'] },
      { onWarning: () => undefined }
    );
    const list = await sources();
    await sources.close();

    expect(list.map((source) => source.name)).toEqual([
      `${pgBossMetricsNamespace(seed.schema)}reports`,
    ]);
    expect(() => pgBossMetricsSources({ listQueues: () => [] } as never)).toThrow(
      /createPgBossEngine/
    );
  });

  it('records into a shared store without touching the BullMQ board’s global series', async () => {
    await createIndex();
    const storeSchema = `${seed.schema}_history`;
    await seed.admin.query(`DROP SCHEMA IF EXISTS "${storeSchema}" CASCADE`);
    const store = new PostgresMetricsStore({
      connection: POSTGRES_URL!,
      schema: storeSchema,
      migrate: true,
    });
    const sources = pgBossMetricsSources(engine, { onWarning: () => undefined });
    const recorder = new MetricsRecorder({ store, sources, latencySafetyMarginMs: 0 });
    const provider = new PostgresMetricsHistoryProvider({ store });
    const pgBossBoard = namespacedHistoryProvider(provider, sources.namespace);
    const range = {
      metric: 'completed' as const,
      from: Date.now() - 86400000,
      to: Date.now(),
      granularity: 'day' as const,
    };
    const sum = (points: { value: number }[]) => points.reduce((total, p) => total + p.value, 0);

    try {
      await recorder.snapshot();
      await recorder.snapshot();

      expect(sum(await pgBossBoard.getHistory({ ...range, queue: 'emails' }))).toBe(2);
      expect(sum(await pgBossBoard.getHistory(range))).toBe(3);
      expect(sum(await pgBossBoard.getHistory({ ...range, metric: 'failed' }))).toBe(1);
      expect(await provider.getHistory(range)).toEqual([]);
      const usage = await pgBossBoard.getUsage!();
      expect(usage.queues.map((q) => q.queue)).toEqual(
        expect.arrayContaining(['__global__', 'emails', 'reports'])
      );
    } finally {
      recorder.stop();
      await store.close();
      await seed.admin.query(`DROP SCHEMA IF EXISTS "${storeSchema}" CASCADE`);
    }
  });

  it('folds persisted queue_stats snapshots into depth buckets, hiding filtered queues', async () => {
    const t = Date.now() - 10 * MS_PER_MINUTE;
    const bucket = Math.floor(t / 300000) * 300000;
    for (const [offset, queued] of [
      [0, 4],
      [1000, 9],
    ]) {
      for (const name of ['reports', 'hidden']) {
        await seed.admin.query(
          `INSERT INTO "${seed.schema}".queue_stats (name, queued_count, total_count, captured_on)
           VALUES ($1, $2, $2, to_timestamp($3 / 1000.0))`,
          [name, queued, bucket + offset]
        );
      }
    }

    const max = await readPgBossQueueDepth(engine, 'reports', {
      from: t - 3600000,
      to: Date.now(),
    });
    const avg = await readPgBossQueueDepth(engine, 'reports', {
      from: t - 3600000,
      to: Date.now(),
      aggregate: 'avg',
    });

    expect(max).toEqual([
      { ts: bucket, deferred: 0, queued: 9, ready: 0, active: 0, failed: 0, total: 9 },
    ]);
    expect(avg[0]).toMatchObject({ ts: bucket, queued: 7 });
    expect(await readPgBossQueueDepth(engine, 'hidden', { from: 0, to: Date.now() })).toEqual([]);
    expect(await readPgBossQueueDepth(engine, 'emails', { from: 0, to: Date.now() })).toEqual([]);
  });
});
