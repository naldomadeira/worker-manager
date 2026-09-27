import { Redis } from 'ioredis';
import { MetricsHistoryAdmin } from '../src/HistoryAdmin';
import { HistoryStore } from '../src/HistoryStore';
import { REDIS_METRICS_LAYOUT_VERSION } from '../src/index';
import { metricsKeys, minuteToDay, resolveNamespace } from '../src/keys';
import { NewerRedisLayoutError } from '../src/layout';
import { MetricsRecorder } from '../src/MetricsRecorder';
import { RedisMetricsHistoryProvider } from '../src/RedisMetricsHistoryProvider';
import { RedisMetricsStore } from '../src/RedisMetricsStore';
import { connection } from './connection';

const RETENTION = { minutes: 7, hours: 90, days: 90 };
const MS_PER_MINUTE = 60000;
const MS_PER_DAY = 86_400_000;
/** Midday UTC yesterday, so the seeded minutes sit inside one day and every retention tier. */
const MINUTE = (Math.floor(Date.now() / MS_PER_DAY) * MS_PER_DAY - MS_PER_DAY / 2) / MS_PER_MINUTE;
const DAY = minuteToDay(MINUTE);

describe('Redis storage layout marker', () => {
  let redis: Redis;
  let prefix: string;
  const keys = () => metricsKeys(resolveNamespace(prefix, false));

  beforeEach(() => {
    redis = new Redis(connection);
    prefix = `layout-test:${Math.random().toString(36).slice(2, 10)}`;
  });

  afterEach(async () => {
    const found = await redis.keys(`${prefix}:*`);
    if (found.length > 0) {
      await redis.del(...found);
    }
    await redis.quit();
  });

  it('is layout 1 in this build', () => {
    expect(REDIS_METRICS_LAYOUT_VERSION).toBe(1);
  });

  it('marks a fresh namespace on the first snapshot, even with nothing to record', async () => {
    const recorder = new MetricsRecorder({ connection: redis, prefix, sources: [] });

    expect(await redis.exists(keys().meta)).toBe(0);
    await recorder.snapshot();

    expect(await redis.hgetall(keys().meta)).toEqual({ layout: '1' });
    expect(keys().meta).toBe(`${prefix}:__meta__`);
    recorder.stop();
  });

  it('adopts history written before the marker existed as layout 1, keeping it', async () => {
    // A store built directly carries no layout check, which is what an older build wrote with.
    const legacy = new HistoryStore({ redis, keys: keys(), retention: RETENTION });
    await legacy.upsertMinute('orders', 'completed', MINUTE - 1, 3);
    expect(await redis.exists(keys().meta)).toBe(0);

    const store = new RedisMetricsStore({ connection: redis, prefix });
    await store
      .counterStore(RETENTION)
      .upsertMinutes('orders', 'completed', [{ minute: MINUTE, value: 4 }]);

    expect(await redis.hget(keys().meta, 'layout')).toBe('1');
    const totals = await store
      .counterStore(RETENTION)
      .readDailyTotals('orders', 'completed', [DAY]);
    expect(totals).toEqual([7]);
  });

  it('leaves the marker alone once present, and out of the storage panel and purges', async () => {
    const store = new RedisMetricsStore({ connection: redis, prefix });
    await store
      .counterStore(RETENTION)
      .upsertMinutes('orders', 'completed', [{ minute: MINUTE, value: 2 }]);
    const admin = new MetricsHistoryAdmin({ store });

    const stats = await admin.stats();
    expect(stats.queues.map((queue) => queue.queue).sort()).toEqual(['__global__', 'orders']);

    await admin.purge();
    expect((await admin.stats()).keys).toBe(0);
    expect(await redis.hget(keys().meta, 'layout')).toBe('1');
  });

  describe('a namespace claimed by a newer build', () => {
    beforeEach(async () => {
      const legacy = new HistoryStore({ redis, keys: keys(), retention: RETENTION });
      await legacy.upsertMinute('orders', 'completed', MINUTE, 5);
      await redis.hset(keys().meta, 'layout', String(REDIS_METRICS_LAYOUT_VERSION + 1));
    });

    it('refuses every write, and reports it through onSnapshotError from start()', async () => {
      const errors: unknown[] = [];
      const store = new RedisMetricsStore({ connection: redis, prefix });
      const recorder = new MetricsRecorder({
        store,
        sources: [
          {
            name: 'orders',
            readMinutes: async () => [{ minute: MINUTE + 1, value: 9 }],
            jobSource: () => null,
          },
        ],
        onSnapshotError: (error) => errors.push(error),
      });
      const before = (await redis.keys(`${prefix}:*`)).sort();

      recorder.start();
      await waitFor(() => errors.length > 0);
      recorder.stop();

      expect(errors[0]).toBeInstanceOf(NewerRedisLayoutError);
      expect((errors[0] as Error).message).toMatch(/uses storage layout 2, newer than the 1/);
      await expect(recorder.snapshot()).rejects.toThrow(NewerRedisLayoutError);
      await expect(
        store
          .counterStore(RETENTION)
          .upsertMinutes('orders', 'completed', [{ minute: MINUTE + 2, value: 1 }])
      ).rejects.toThrow(NewerRedisLayoutError);
      await expect(
        store.latencyStore(RETENTION).acquireLease('orders', 'me', 1000)
      ).rejects.toThrow(NewerRedisLayoutError);

      expect((await redis.keys(`${prefix}:*`)).sort()).toEqual(before);
      expect(await redis.hget(keys().meta, 'layout')).toBe('2');
    });

    it('still serves reads, and refuses a purge', async () => {
      const provider = new RedisMetricsHistoryProvider({ connection: redis, prefix });
      const history = await provider.getHistory({
        queue: 'orders',
        metric: 'completed',
        granularity: 'day',
        from: (MINUTE - 1) * MS_PER_MINUTE,
        to: (MINUTE + 1) * MS_PER_MINUTE,
      });
      expect(history.map((point) => point.value)).toContain(5);

      const admin = new MetricsHistoryAdmin({ connection: redis, prefix });
      expect((await admin.stats()).keys).toBeGreaterThan(0);
      await expect(admin.purge()).rejects.toThrow(NewerRedisLayoutError);
      expect(await redis.exists(keys().totals('orders', 'completed'))).toBe(1);
    });
  });

  it('retries the claim after a transient failure instead of caching it', async () => {
    const store = new RedisMetricsStore({ connection: redis, prefix });
    const evalSpy = jest.spyOn(redis, 'eval').mockRejectedValueOnce(new Error('connection lost'));

    await expect(store.prepareWrites()).rejects.toThrow('connection lost');
    evalSpy.mockRestore();
    await expect(store.prepareWrites()).resolves.toBeUndefined();
    expect(await redis.hget(keys().meta, 'layout')).toBe('1');
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('condition was not met in time');
}
