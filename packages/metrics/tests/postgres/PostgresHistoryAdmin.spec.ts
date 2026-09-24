import type { Pool } from 'pg';
import { emptyVector } from '../../src/histogram';
import { MetricsHistoryAdmin } from '../../src/HistoryAdmin';
import { GLOBAL_QUEUE, minuteToDay, minuteToHour } from '../../src/keys';
import type { PostgresMetricsStore } from '../../src/postgres/PostgresMetricsStore';
import type { CounterStore, LatencyStorage } from '../../src/store';
import { describePostgres, dropSchema, freshStore, testPool } from '../postgres';

const RETENTION = { minutes: 90, hours: 90, days: 90 };
const MINUTE = Date.UTC(2020, 2, 10, 12, 0) / 60000;
const DAY = minuteToDay(MINUTE);
const NEXT = MINUTE + 1440;
const NEXT_DAY = minuteToDay(NEXT);

describePostgres('MetricsHistoryAdmin on PostgreSQL', () => {
  let pool: Pool;
  let metrics: PostgresMetricsStore;
  let counters: CounterStore;
  let latency: LatencyStorage;
  let admin: MetricsHistoryAdmin;

  beforeAll(() => {
    pool = testPool();
  });

  beforeEach(async () => {
    metrics = await freshStore(pool, 'admin');
    counters = metrics.counterStore(RETENTION);
    latency = metrics.latencyStore(RETENTION);
    admin = new MetricsHistoryAdmin({ store: metrics });
  });

  afterEach(async () => {
    await dropSchema(pool, metrics.tables.schema);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seed(queue: string, value: number, minute = MINUTE): Promise<void> {
    await counters.upsertMinutes(queue, 'completed', [
      { minute, value },
      { minute: minute + 1, value },
    ]);
  }

  async function globalTotals(days = [DAY, NEXT_DAY]): Promise<(number | null)[]> {
    return counters.readDailyTotals(GLOBAL_QUEUE, 'completed', days);
  }

  describe('stats', () => {
    it('reports an empty store as zero', async () => {
      expect(await admin.stats()).toEqual({
        keys: 0,
        bytes: 0,
        minutes: 0,
        oldestDay: null,
        newestDay: null,
        tiers: {
          minute: { keys: 0, bytes: 0 },
          hour: { keys: 0, bytes: 0 },
          day: { keys: 0, bytes: 0 },
        },
        queues: [],
      });
    });

    it('reports per-queue rows, minutes, days and bytes, tier by tier', async () => {
      await seed('Q', 3);
      await seed('Q', 3, NEXT);
      await latency.addSamples('Q', 'runtime', minuteToHour(MINUTE), emptyVector());

      const stats = await admin.stats();
      const q = stats.queues.find((entry) => entry.queue === 'Q')!;

      // 4 minute rows, 2 hour rows and 2 day rows of counters, plus one hour and one day
      // row of histogram.
      expect(q.tiers.minute.keys).toBe(4);
      expect(q.tiers.hour.keys).toBe(3);
      expect(q.tiers.day.keys).toBe(3);
      expect(q.keys).toBe(10);
      expect(q.minutes).toBe(4);
      expect(q.days).toEqual([DAY, NEXT_DAY]);
      expect(q.bytes).toBeGreaterThan(0);
      expect(q.bytes).toBe(q.tiers.minute.bytes + q.tiers.hour.bytes + q.tiers.day.bytes);

      expect(stats.oldestDay).toBe(DAY);
      expect(stats.newestDay).toBe(NEXT_DAY);
      expect(stats.queues.map((entry) => entry.queue).sort()).toEqual(['Q', GLOBAL_QUEUE]);
      expect(stats.keys).toBe(stats.queues.reduce((sum, entry) => sum + entry.keys, 0));
      expect(stats.minutes).toBe(8); // the queue's four and the global rollup's four
    });

    it("apportions the tables' on-disk size, so the parts add up to it", async () => {
      await seed('Q', 3);
      await seed('Big', 3);
      await counters.upsertMinutes(
        'Big',
        'completed',
        Array.from({ length: 300 }, (_, i) => ({ minute: MINUTE + 10 + i, value: 1 }))
      );

      const stats = await admin.stats();
      const { rows } = await pool.query(
        'SELECT pg_total_relation_size($1::regclass) + pg_total_relation_size($2::regclass) AS n',
        [metrics.tables.counters, metrics.tables.histograms]
      );
      // Histograms are empty, so only the counters table is apportioned.
      const { rows: counterSize } = await pool.query(
        'SELECT pg_total_relation_size($1::regclass) AS n',
        [metrics.tables.counters]
      );
      expect(Math.abs(stats.bytes - Number(counterSize[0].n))).toBeLessThanOrEqual(5);
      expect(stats.bytes).toBeLessThanOrEqual(Number(rows[0].n) + 5);
      // Sorted by footprint, largest first.
      expect(stats.queues[0].bytes).toBeGreaterThanOrEqual(stats.queues[1].bytes);
      expect(stats.queues.find((q) => q.queue === 'Big')!.bytes).toBeGreaterThan(
        stats.queues.find((q) => q.queue === 'Q')!.bytes
      );
    });
  });

  describe('purge', () => {
    it('removes everything and reports rows by tier', async () => {
      await seed('Q', 3);
      await seed('Q2', 1);
      await latency.addSamples('Q', 'runtime', minuteToHour(MINUTE), emptyVector());

      const result = await admin.purge();

      // Minute and hour rows as keys: (2 + 1) x (Q, Q2, global) + 2 histogram hours.
      // Day rows as fields: 1 x (Q, Q2, global) + 2 histogram days.
      expect(result).toEqual({ keysDeleted: 3 * 3 + 2, fieldsDeleted: 3 + 2 });
      expect((await admin.stats()).queues).toEqual([]);
    });

    it('is a safe no-op on an empty store and for an unknown queue', async () => {
      expect(await admin.purge()).toEqual({ keysDeleted: 0, fieldsDeleted: 0 });
      await seed('Q', 3);
      expect(await admin.purge({ queue: 'Nope' })).toEqual({ keysDeleted: 0, fieldsDeleted: 0 });
      expect(await globalTotals([DAY])).toEqual([6]);
    });

    it('subtracts the purged queue from the global rollup and leaves the others intact', async () => {
      await seed('Q', 3);
      await seed('Q2', 1);

      await admin.purge({ queue: 'Q' });

      expect(await counters.readDailyTotals('Q', 'completed', [DAY])).toEqual([null]);
      expect(await counters.readDailyTotals('Q2', 'completed', [DAY])).toEqual([2]);
      expect(await globalTotals([DAY])).toEqual([2]);
      expect(await counters.readHours(GLOBAL_QUEUE, 'completed', [DAY])).toEqual({
        [minuteToHour(MINUTE)]: 2,
      });
    });

    it('drains the global rollup instead of leaving zeros when the last queue goes', async () => {
      await seed('Q', 3);

      const result = await admin.purge({ queue: 'Q' });

      expect(await globalTotals([DAY])).toEqual([null]);
      expect((await admin.stats()).queues).toEqual([]);
      // Queue rows (2 minutes + 1 hour, 1 day) and the drained global ones, same shape.
      expect(result).toEqual({ keysDeleted: 6, fieldsDeleted: 2 });
    });

    it('keeps the latency rollups, which cannot be decremented', async () => {
      await latency.addSamples('Q', 'runtime', minuteToHour(MINUTE), emptyVector().fill(1));
      await admin.purge({ queue: 'Q' });

      expect(await latency.readRange('Q', 'runtime', 'day', [DAY])).toEqual({});
      expect(Object.keys(await latency.readRange(GLOBAL_QUEUE, 'runtime', 'day', [DAY]))).toEqual([
        DAY,
      ]);
    });

    it('drops only days before the cutoff, correcting the global rollup for those days', async () => {
      await seed('Q', 3);
      await seed('Q', 5, NEXT);
      await seed('Q2', 1);

      await admin.purge({ queue: 'Q', before: NEXT_DAY });

      expect(await counters.readDailyTotals('Q', 'completed', [DAY, NEXT_DAY])).toEqual([null, 10]);
      expect(await globalTotals()).toEqual([2, 10]);
    });

    it('accepts a Date cutoff and rejects a malformed one', async () => {
      await seed('Q', 3);
      await seed('Q', 5, NEXT);

      await admin.purge({ before: new Date(NEXT * 60000) });
      expect(await globalTotals()).toEqual([null, 10]);

      await expect(admin.purge({ before: '2020/03/10' })).rejects.toThrow('YYYY-MM-DD');
      expect(await globalTotals()).toEqual([null, 10]);
    });

    it('is idempotent and leaves the recorder able to keep writing', async () => {
      await seed('Q', 3);
      await admin.purge({ queue: 'Q' });
      expect(await admin.purge({ queue: 'Q' })).toEqual({ keysDeleted: 0, fieldsDeleted: 0 });

      await seed('Q', 4);
      expect(await counters.readDailyTotals('Q', 'completed', [DAY])).toEqual([8]);
      expect(await globalTotals([DAY])).toEqual([8]);
    });

    it('treats wildcard-looking queue names literally', async () => {
      await seed('Q%', 3);
      await seed('Q_1', 1);

      await admin.purge({ queue: 'Q%' });

      expect(await counters.readDailyTotals('Q_1', 'completed', [DAY])).toEqual([2]);
    });
  });
});
