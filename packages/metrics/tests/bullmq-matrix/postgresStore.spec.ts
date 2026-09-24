import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { Queue, Worker } from 'bullmq';
import type { Pool } from 'pg';
import { MetricsRecorder } from '../../src/MetricsRecorder';
import { PostgresMetricsHistoryProvider } from '../../src/postgres/PostgresMetricsHistoryProvider';
import type { PostgresMetricsStore } from '../../src/postgres/PostgresMetricsStore';
import { describePostgres, dropSchema, freshStore, POSTGRES_URL, testPool } from '../postgres';
import { assertResolvedMajor, uniqueName, waitFor } from './helpers';

const DAY_MS = 86400000;

/**
 * The deployment this store exists for: BullMQ v6 queues on PostgreSQL, history in
 * PostgreSQL, and no Redis anywhere in the process.
 */
describePostgres('PostgreSQL-only board: PostgreSQL queues recording into PostgreSQL', () => {
  assertResolvedMajor();

  let pool: Pool;
  let store: PostgresMetricsStore;
  let queue: Queue;
  let worker: Worker | undefined;
  let adapter: BullMQAdapter;

  beforeAll(() => {
    pool = testPool();
  });

  beforeEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createPostgresBackend } = require('bullmq');
    queue = new Queue(
      uniqueName('pgonly'),
      { connection: POSTGRES_URL } as any,
      createPostgresBackend
    );
    await queue.waitUntilReady();
    adapter = new BullMQAdapter(queue);
    store = await freshStore(pool, 'pgonly');
  });

  afterEach(async () => {
    await worker?.close();
    worker = undefined;
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
    await dropSchema(pool, store.tables.schema);
  });

  afterAll(async () => {
    await pool.end();
  });

  function backendPool(): Pool {
    return (queue as any).getBackend().connection.pool;
  }

  async function completedCount(): Promise<number> {
    const { rows } = await backendPool().query(
      `SELECT count FROM metrics WHERE queue = $1 AND kind = 'completed'`,
      [queue.name]
    );
    return Number(rows[0]?.count ?? 0);
  }

  async function runJobs(count: number, target: number): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createPostgresBackend, MetricsTime } = require('bullmq');
    await queue.addBulk(Array.from({ length: count }, (_, i) => ({ name: 'job', data: { i } })));
    worker =
      worker ??
      new Worker(
        queue.name,
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return 'ok';
        },
        { connection: POSTGRES_URL, metrics: { maxDataPoints: MetricsTime.ONE_HOUR } } as any,
        createPostgresBackend
      );
    await waitFor(async () => (await completedCount()) >= target, 'jobs did not complete');
  }

  it('records throughput, latency and queue age, and serves them back', async () => {
    await runJobs(3, 3);
    // Push the buffer anchor back two minutes so the next job finalizes a minute bucket.
    await backendPool().query(
      `UPDATE metrics SET prev_ts = $2 WHERE queue = $1 AND kind = 'completed'`,
      [queue.name, Date.now() - 120000]
    );
    await runJobs(1, 4);
    await worker!.close();
    worker = undefined;
    await queue.add('waiting', {});
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const recorder = new MetricsRecorder({
      queues: [adapter],
      store,
      latencySafetyMarginMs: 0,
    });
    await recorder.snapshot();
    recorder.stop();

    const provider = new PostgresMetricsHistoryProvider({ store });
    const to = Date.now();
    const from = to - DAY_MS;
    const name = adapter.getName();

    const completed = await provider.getHistory({
      queue: name,
      metric: 'completed',
      from,
      to,
      granularity: 'day',
    });
    expect(completed.reduce((sum, p) => sum + p.value, 0)).toBe(3);

    const [runtime] = await provider.getLatency({
      queue: name,
      metric: 'runtime',
      from,
      to,
      granularity: 'range',
      percentiles: [50],
    });
    expect(runtime.count).toBe(4);
    expect(runtime.values['50']).toBeGreaterThanOrEqual(10);

    const [age] = await provider.getHistory({
      queue: name,
      metric: 'queueage',
      from,
      to,
      granularity: 'day',
    });
    expect(age.value).toBeGreaterThanOrEqual(1000);

    // The cross-queue rollup and the storage panel see the same history.
    const global = await provider.getHistory({ metric: 'completed', from, to, granularity: 'day' });
    expect(global.reduce((sum, p) => sum + p.value, 0)).toBe(3);
    const usage = await provider.getUsage();
    expect(usage.queues.map((q) => q.queue)).toContain(name);
  });

  it('does not double count latency when a second recorder ticks at the same time', async () => {
    await runJobs(5, 5);
    const recorders = [0, 1].map(
      () => new MetricsRecorder({ queues: [adapter], store, latencySafetyMarginMs: 0 })
    );
    await Promise.all(recorders.map((recorder) => recorder.snapshot()));
    recorders.forEach((recorder) => recorder.stop());

    const provider = new PostgresMetricsHistoryProvider({ store });
    const [runtime] = await provider.getLatency({
      queue: adapter.getName(),
      metric: 'runtime',
      from: Date.now() - DAY_MS,
      to: Date.now(),
      granularity: 'range',
      percentiles: [50],
    });
    expect(runtime.count).toBe(5);
  });
});
