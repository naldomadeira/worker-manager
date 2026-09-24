import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { MetricsTime, Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { MetricsRecorder } from '../../src/MetricsRecorder';
import { PostgresMetricsHistoryProvider } from '../../src/postgres/PostgresMetricsHistoryProvider';
import type { PostgresMetricsStore } from '../../src/postgres/PostgresMetricsStore';
import { connection } from '../connection';
import { describePostgres, dropSchema, freshStore, testPool } from '../postgres';

const DAY_MS = 86400000;

async function waitFor(predicate: () => Promise<boolean>, message: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(message);
}

/**
 * History in PostgreSQL does not require the queues to be there too: a Redis-backed queue is
 * sampled through the adapter's own client, since the store has no Redis to lend it.
 */
describePostgres('MetricsRecorder with a PostgreSQL store and Redis-backed queues', () => {
  const QUEUE = `PgStoreRedisQueue-${process.env.JEST_WORKER_ID ?? 0}`;
  let pool: Pool;
  let redis: Redis;
  let store: PostgresMetricsStore;
  let queue: Queue;
  let worker: Worker | undefined;

  beforeAll(() => {
    pool = testPool();
  });

  beforeEach(async () => {
    redis = new Redis(connection);
    queue = new Queue(QUEUE, { connection });
    await queue.obliterate({ force: true }).catch(() => undefined);
    store = await freshStore(pool, 'recorder');
  });

  afterEach(async () => {
    await worker?.close();
    worker = undefined;
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
    await redis.quit();
    await dropSchema(pool, store.tables.schema);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('records counters and latency, and a timer failure never escapes as a rejection', async () => {
    worker = new Worker(QUEUE, async () => 'ok', {
      connection,
      metrics: { maxDataPoints: MetricsTime.ONE_HOUR },
    });
    await queue.addBulk(Array.from({ length: 4 }, () => ({ name: 'job', data: {} })));
    await waitFor(async () => (await queue.getCompletedCount()) >= 4, 'jobs did not complete');
    // Rewind BullMQ's buffer anchor so the next completion finalizes a minute bucket.
    await redis.hset(queue.toKey('metrics:completed'), 'prevTS', String(Date.now() - 120000));
    await queue.add('flush', {});
    await waitFor(async () => (await queue.getCompletedCount()) >= 5, 'flush did not complete');

    const adapter = new BullMQAdapter(queue);
    const errors: unknown[] = [];
    const recorder = new MetricsRecorder({
      queues: [adapter],
      store,
      latencySafetyMarginMs: 0,
      onSnapshotError: (error) => errors.push(error),
    });
    await recorder.snapshot();

    const provider = new PostgresMetricsHistoryProvider({ store });
    const to = Date.now();
    const completed = await provider.getHistory({
      queue: adapter.getName(),
      metric: 'completed',
      from: to - DAY_MS,
      to,
      granularity: 'day',
    });
    expect(completed.reduce((sum, p) => sum + p.value, 0)).toBe(4);

    const [runtime] = await provider.getLatency({
      queue: adapter.getName(),
      metric: 'runtime',
      from: to - DAY_MS,
      to,
      granularity: 'range',
      percentiles: [50],
    });
    expect(runtime.count).toBe(5);

    // A store that has gone away fails the scheduled tick into the hook, not into the void.
    jest.spyOn(adapter, 'getMetrics').mockResolvedValue({
      // A minute newer than the one already stored, so the tick has something to write.
      meta: { count: 1, prevTS: Date.now() + 120000, prevCount: 0 },
      data: [9],
      count: 1,
    } as never);
    const connect = jest
      .spyOn(store.pool, 'connect')
      .mockRejectedValue(new Error('database is gone') as never);
    recorder.start();
    await waitFor(async () => errors.length > 0, 'the failure was not reported');
    recorder.stop();
    connect.mockRestore();
    expect(String(errors[0])).toContain('database is gone');
  });
});
