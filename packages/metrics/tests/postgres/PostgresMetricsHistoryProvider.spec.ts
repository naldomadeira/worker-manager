import type {
  MetricsHistoryProvider,
  MetricsHistoryQuery,
  MetricsLatencyQuery,
} from '@worker-manager/api/typings/app';
import { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { emptyVector } from '../../src/histogram';
import { PostgresMetricsHistoryProvider } from '../../src/postgres/PostgresMetricsHistoryProvider';
import type { PostgresMetricsStore } from '../../src/postgres/PostgresMetricsStore';
import { RedisMetricsHistoryProvider } from '../../src/RedisMetricsHistoryProvider';
import { RedisMetricsStore } from '../../src/RedisMetricsStore';
import type { MetricsStore } from '../../src/store';
import { connection } from '../connection';
import { describePostgres, dropSchema, freshStore, POSTGRES_URL, testPool } from '../postgres';

const RETENTION = { minutes: 90, hours: 90, days: 90 };
const QUEUE = 'ProviderQueue';
const D1 = Date.UTC(2021, 1, 1, 10, 0);
const D2 = Date.UTC(2021, 1, 2, 15, 30);

/** The same history, written through a store's own seams. */
async function seed(store: MetricsStore): Promise<void> {
  const counters = store.counterStore(RETENTION);
  const latency = store.latencyStore(RETENTION);
  const m1 = D1 / 60000;
  const m2 = D2 / 60000;
  await counters.upsertMinutes(QUEUE, 'completed', [
    { minute: m1, value: 3 },
    { minute: m1 + 90, value: 4 },
    { minute: m2, value: 5 },
  ]);
  await counters.upsertMinutes('Other', 'completed', [{ minute: m1, value: 2 }]);
  await counters.upsertMinutes(QUEUE, 'failed', [{ minute: m2, value: 1 }]);

  const fast = emptyVector();
  fast[1] = 90;
  fast[8] = 10;
  const slow = emptyVector();
  slow[11] = 100;
  await latency.addSamples(QUEUE, 'runtime', Math.floor(D1 / 3600000), fast);
  await latency.addSamples(QUEUE, 'runtime', Math.floor(D2 / 3600000), slow);
  await latency.addSamples('Other', 'waittime', Math.floor(D1 / 3600000), fast);
  await latency.recordQueueAge(QUEUE, Math.floor(D1 / 3600000), 4200);
  await latency.recordQueueAge(QUEUE, Math.floor(D1 / 3600000) + 1, 1200);
  await latency.recordQueueAge('Other', Math.floor(D2 / 3600000), 9000);
}

const from = Date.UTC(2021, 0, 31);
const to = Date.UTC(2021, 1, 3, 23, 59);

const historyQueries: MetricsHistoryQuery[] = [
  { queue: QUEUE, metric: 'completed', from, to, granularity: 'day' },
  { queue: QUEUE, metric: 'completed', from, to, granularity: 'hour' },
  { metric: 'completed', from, to, granularity: 'day' },
  { metric: 'completed', from, to, granularity: 'hour' },
  { queue: QUEUE, metric: 'failed', from, to, granularity: 'day' },
  { queue: 'Never', metric: 'completed', from, to, granularity: 'day' },
  { queue: QUEUE, metric: 'completed', from: D1 + 3600000, to: D2, granularity: 'day' },
  { queue: QUEUE, metric: 'completed', from: 0, to, granularity: 'day' },
  { queue: QUEUE, metric: 'queueage', from, to, granularity: 'hour' },
  { queue: QUEUE, metric: 'queueage', from, to, granularity: 'day' },
  { metric: 'queueage', from, to, granularity: 'day' },
];

const latencyQueries: MetricsLatencyQuery[] = [
  { queue: QUEUE, metric: 'runtime', from, to, granularity: 'day', percentiles: [50, 95, 99] },
  { queue: QUEUE, metric: 'runtime', from, to, granularity: 'hour', percentiles: [50, 99] },
  { queue: QUEUE, metric: 'runtime', from, to, granularity: 'range', percentiles: [95] },
  { metric: 'waittime', from, to, granularity: 'range', percentiles: [50] },
  { metric: 'runtime', from, to, granularity: 'day', percentiles: [95] },
  { queue: 'Never', metric: 'runtime', from, to, granularity: 'range', percentiles: [95] },
];

describePostgres('PostgresMetricsHistoryProvider', () => {
  let pool: Pool;
  let metrics: PostgresMetricsStore;
  let provider: PostgresMetricsHistoryProvider;

  beforeAll(() => {
    pool = testPool();
  });

  beforeEach(async () => {
    metrics = await freshStore(pool, 'provider');
    provider = new PostgresMetricsHistoryProvider({ store: metrics, retention: RETENTION });
    await seed(metrics);
  });

  afterEach(async () => {
    await provider.disconnect();
    await dropSchema(pool, metrics.tables.schema);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('returns a continuous zero-backfilled daily series once any day has data', async () => {
    expect(await provider.getHistory(historyQueries[0])).toEqual([
      { ts: Date.UTC(2021, 0, 31), value: 0 },
      { ts: Date.UTC(2021, 1, 1), value: 7 },
      { ts: Date.UTC(2021, 1, 2), value: 5 },
      { ts: Date.UTC(2021, 1, 3), value: 0 },
    ]);
  });

  it('returns sparse hourly buckets and the global rollup', async () => {
    expect(await provider.getHistory(historyQueries[1])).toEqual([
      { ts: Date.UTC(2021, 1, 1, 10), value: 3 },
      { ts: Date.UTC(2021, 1, 1, 11), value: 4 },
      { ts: Date.UTC(2021, 1, 2, 15), value: 5 },
    ]);
    expect((await provider.getHistory(historyQueries[2]))[1]).toEqual({
      ts: Date.UTC(2021, 1, 1),
      value: 9,
    });
  });

  it('returns an empty series when no day in range was ever recorded', async () => {
    expect(await provider.getHistory(historyQueries[5])).toEqual([]);
  });

  it('computes latency percentiles from merged buckets, and merges a range once', async () => {
    const [day1] = await provider.getLatency(latencyQueries[0]);
    expect(day1.count).toBe(100);
    expect(day1.values['50']).toBeLessThanOrEqual(25);
    expect(day1.values['99']).toBeGreaterThan(2500);

    const [range] = await provider.getLatency(latencyQueries[2]);
    expect(range).toMatchObject({ ts: from, count: 200 });
  });

  it('serves queue age as a max gauge through getHistory', async () => {
    expect(await provider.getHistory(historyQueries[9])).toEqual([
      { ts: Date.UTC(2021, 1, 1), value: 4200 },
    ]);
    expect(await provider.getHistory(historyQueries[10])).toEqual([
      { ts: Date.UTC(2021, 1, 1), value: 4200 },
      { ts: Date.UTC(2021, 1, 2), value: 9000 },
    ]);
  });

  it('backs the storage panel: usage, then purge', async () => {
    const usage = await provider.getUsage();
    expect(usage.queues.map((q) => q.queue).sort()).toEqual([QUEUE, 'Other', '__global__'].sort());
    expect(usage.oldestDay).toBe('2021-02-01');
    expect(usage.newestDay).toBe('2021-02-02');

    await provider.purge({ before: '2021-02-02' });
    expect((await provider.getUsage()).oldestDay).toBe('2021-02-02');
    await provider.purge({});
    expect((await provider.getUsage()).queues).toEqual([]);
  });

  it('builds, migrates and closes its own pool from a connection string', async () => {
    const schema = `${metrics.tables.schema}_own`;
    await dropSchema(pool, schema);
    const own = new PostgresMetricsHistoryProvider({
      connection: POSTGRES_URL!,
      schema,
      migrate: true,
    });
    expect(await own.getHistory(historyQueries[0])).toEqual([]);
    await own.disconnect();
    await expect(own.store.pool.query('SELECT 1')).rejects.toThrow();
    await dropSchema(pool, schema);
  });

  describe('parity with the Redis provider', () => {
    let redis: Redis;
    let redisProvider: MetricsHistoryProvider;
    const prefix = `pg-parity-${process.env.JEST_WORKER_ID ?? 0}`;

    async function clearRedis(): Promise<void> {
      const keys = await redis.keys(`${prefix}:*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }

    beforeEach(async () => {
      redis = new Redis(connection);
      await clearRedis();
      await seed(new RedisMetricsStore({ connection: redis, prefix }));
      redisProvider = new RedisMetricsHistoryProvider({
        connection: redis,
        prefix,
        retention: RETENTION,
      });
    });

    afterEach(async () => {
      await clearRedis();
      await redis.quit();
    });

    it.each(historyQueries.map((query, i) => [i, query] as const))(
      'answers history query #%i exactly as Redis does',
      async (_i, query) => {
        expect(await provider.getHistory(query)).toEqual(await redisProvider.getHistory(query));
      }
    );

    it.each(latencyQueries.map((query, i) => [i, query] as const))(
      'answers latency query #%i exactly as Redis does',
      async (_i, query) => {
        expect(await provider.getLatency(query)).toEqual(await redisProvider.getLatency!(query));
      }
    );

    it('reports the same days, minutes and queues in usage', async () => {
      const pg = await provider.getUsage();
      const rd = await redisProvider.getUsage!();
      const shape = (usage: typeof pg) => ({
        minutes: usage.minutes,
        oldestDay: usage.oldestDay,
        newestDay: usage.newestDay,
        queues: usage.queues
          .map((q) => ({ queue: q.queue, minutes: q.minutes, days: q.days }))
          .sort((a, b) => a.queue.localeCompare(b.queue)),
      });
      expect(shape(pg)).toEqual(shape(rd));
    });

    it('purges one queue out of the global rollup the same way', async () => {
      await provider.purge({ queue: QUEUE });
      await redisProvider.purge!({ queue: QUEUE });
      for (const query of historyQueries.slice(0, 4)) {
        expect(await provider.getHistory(query)).toEqual(await redisProvider.getHistory(query));
      }
    });
  });
});
