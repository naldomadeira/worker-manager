import type { MetricsHistoryProvider } from '@worker-manager/api/typings/app';
import { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { resolveRetention } from '../src/MetricsRecorder';
import { namespacedHistoryProvider } from '../src/namespacedHistoryProvider';
import { PostgresMetricsHistoryProvider } from '../src/postgres/PostgresMetricsHistoryProvider';
import { RedisMetricsHistoryProvider } from '../src/RedisMetricsHistoryProvider';
import { RedisMetricsStore } from '../src/RedisMetricsStore';
import type { MetricsStore } from '../src/store';
import { connection } from './connection';
import { describePostgres, dropSchema, freshStore, POSTGRES_URL, testPool } from './postgres';

const MS_PER_MINUTE = 60000;
const NS = 'pgboss:app:';
const ROLLUP = `${NS}__global__`;

async function seed(store: MetricsStore) {
  const counters = store.counterStore(resolveRetention({}));
  const m = Math.floor(Date.now() / MS_PER_MINUTE) - 10;
  await counters.upsertMinutes('emails', 'completed', [{ minute: m, value: 5 }]);
  await counters.upsertMinutes(`${NS}emails`, 'completed', [{ minute: m, value: 3 }], ROLLUP);
  await counters.upsertMinutes(`${NS}reports`, 'completed', [{ minute: m, value: 4 }], ROLLUP);
}

async function total(provider: MetricsHistoryProvider, queue?: string) {
  const points = await provider.getHistory({
    queue,
    metric: 'completed',
    from: Date.now() - 2 * 86400000,
    to: Date.now(),
    granularity: 'day',
  });
  return points.reduce((sum, p) => sum + p.value, 0);
}

function battery(
  label: string,
  make: () => Promise<{
    store: MetricsStore;
    provider: MetricsHistoryProvider;
    cleanup(): Promise<void>;
  }>
) {
  describe(`namespacedHistoryProvider over ${label}`, () => {
    let store: MetricsStore;
    let provider: MetricsHistoryProvider;
    let cleanup: () => Promise<void>;
    let scoped: MetricsHistoryProvider;

    beforeEach(async () => {
      ({ store, provider, cleanup } = await make());
      scoped = namespacedHistoryProvider(provider, NS);
      await seed(store);
    });

    afterEach(async () => {
      await cleanup();
    });

    it('reads its queues and its own rollup, never the other board’s', async () => {
      expect(await total(scoped)).toBe(7);
      expect(await total(scoped, 'emails')).toBe(3);
      expect(await total(provider)).toBe(5);
      expect(await total(provider, 'emails')).toBe(5);
    });

    it('lists only its namespace in the storage panel, without the prefix', async () => {
      const usage = await scoped.getUsage!();
      expect(usage.queues.map((q) => q.queue).sort()).toEqual(['__global__', 'emails', 'reports']);
      expect(usage.keys).toBe(usage.queues.reduce((sum, q) => sum + q.keys, 0));
      expect(usage.minutes).toBe(3);
      const whole = await provider.getUsage!();
      expect(whole.queues.map((q) => q.queue)).toContain('emails');
      expect(whole.queues.map((q) => q.queue)).toContain(`${NS}emails`);
    });

    it('purges one queue out of its own rollup', async () => {
      await scoped.purge!({ queue: 'emails' });

      expect(await total(scoped)).toBe(4);
      expect(await total(scoped, 'emails')).toBe(0);
      expect(await total(provider)).toBe(5);
      expect(await total(provider, 'emails')).toBe(5);
    });

    it('keeps "clear all" inside the namespace', async () => {
      await scoped.purge!({});

      expect(await total(scoped)).toBe(0);
      expect(await total(scoped, 'reports')).toBe(0);
      expect(await total(provider)).toBe(5);
      expect(await total(provider, 'emails')).toBe(5);
    });
  });
}

battery('Redis', async () => {
  const redis = new Redis(connection);
  const prefix = `wm-test:ns:${process.env.JEST_WORKER_ID ?? 0}`;
  const clear = async () => {
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length > 0) await redis.del(...keys);
  };
  await clear();
  return {
    store: new RedisMetricsStore({ connection: redis, prefix }),
    provider: new RedisMetricsHistoryProvider({ connection: redis, prefix }),
    async cleanup() {
      await clear();
      await redis.quit();
    },
  };
});

if (POSTGRES_URL) {
  let pool: Pool;
  beforeAll(() => {
    pool = testPool();
  });
  afterAll(async () => {
    await pool.end();
  });
  battery('PostgreSQL', async () => {
    const store = await freshStore(pool, 'namespaced');
    return {
      store,
      provider: new PostgresMetricsHistoryProvider({ store }),
      cleanup: () => dropSchema(pool, store.tables.schema),
    };
  });
} else {
  describePostgres('namespacedHistoryProvider over PostgreSQL', () => undefined);
}

describe('namespacedHistoryProvider with a provider of its own', () => {
  it('passes reads through but offers no purge it cannot scope', async () => {
    const seen: (string | undefined)[] = [];
    const custom: MetricsHistoryProvider = {
      async getHistory(query) {
        seen.push(query.queue);
        return [];
      },
      async purge() {
        return { keysDeleted: 0, fieldsDeleted: 0 };
      },
    };
    const scoped = namespacedHistoryProvider(custom, NS);

    await scoped.getHistory({ metric: 'completed', from: 0, to: 1, granularity: 'day' });
    await scoped.getHistory({
      queue: 'q',
      metric: 'completed',
      from: 0,
      to: 1,
      granularity: 'day',
    });

    expect(seen).toEqual([ROLLUP, `${NS}q`]);
    expect(scoped.purge).toBeUndefined();
    expect(scoped.getLatency).toBeUndefined();
    expect(() => namespacedHistoryProvider(custom, '')).toThrow(/prefix/);
  });
});
