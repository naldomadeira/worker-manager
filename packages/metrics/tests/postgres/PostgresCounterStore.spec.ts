import type { Pool } from 'pg';
import { GLOBAL_QUEUE, minuteToDay, minuteToHour } from '../../src/keys';
import type { PostgresMetricsStore } from '../../src/postgres/PostgresMetricsStore';
import type { PostgresCounterStore } from '../../src/postgres/stores';
import type { Retention } from '../../src/store';
import { describePostgres, dropSchema, freshStore, testPool } from '../postgres';

const RETENTION: Retention = { minutes: 7, hours: 90, days: 90 };
// A fixed minute well inside one UTC day, far from the wall clock.
const MINUTE = Date.UTC(2020, 2, 10, 12, 0) / 60000;
const DAY = minuteToDay(MINUTE);

describePostgres('PostgresCounterStore', () => {
  let pool: Pool;
  let metrics: PostgresMetricsStore;
  let store: PostgresCounterStore;

  const counters = (retention: Retention = RETENTION) =>
    metrics.counterStore(retention) as PostgresCounterStore;

  async function rows(queue: string, tier: string): Promise<Record<string, number>> {
    const { rows: found } = await pool.query(
      `SELECT bucket, value FROM ${metrics.tables.counters}
        WHERE queue = $1 AND metric = 'completed' AND tier = $2`,
      [queue, tier]
    );
    return Object.fromEntries(found.map((row) => [String(row.bucket), Number(row.value)]));
  }

  beforeAll(() => {
    pool = testPool();
  });

  beforeEach(async () => {
    metrics = await freshStore(pool, 'counters');
    store = counters();
  });

  afterEach(async () => {
    await dropSchema(pool, metrics.tables.schema);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('writes a minute into all three tiers of the queue and the global rollup', async () => {
    await store.upsertMinute('Q', 'completed', MINUTE, 4);

    expect(await rows('Q', 'minute')).toEqual({ [MINUTE]: 4 });
    expect(await rows('Q', 'hour')).toEqual({ [minuteToHour(MINUTE)]: 4 });
    expect(await store.readDailyTotals('Q', 'completed', [DAY])).toEqual([4]);
    expect(await rows(GLOBAL_QUEUE, 'minute')).toEqual({ [MINUTE]: 4 });
    expect(await store.readDailyTotals(GLOBAL_QUEUE, 'completed', [DAY])).toEqual([4]);
  });

  it('is idempotent: re-writing the same minute value changes nothing', async () => {
    for (let i = 0; i < 3; i++) {
      await store.upsertMinute('Q', 'completed', MINUTE, 4);
    }
    expect(await store.readDailyTotals('Q', 'completed', [DAY])).toEqual([4]);
    expect(await store.readHours('Q', 'completed', [DAY])).toEqual({ [minuteToHour(MINUTE)]: 4 });
    expect(await store.readDailyTotals(GLOBAL_QUEUE, 'completed', [DAY])).toEqual([4]);
  });

  it('applies only the delta when a minute value is corrected', async () => {
    await store.upsertMinute('Q', 'completed', MINUTE, 4);
    await store.upsertMinute('Q', 'completed', MINUTE, 7);
    await store.upsertMinute('Q', 'completed', MINUTE, 2);

    expect(await store.readDailyTotals('Q', 'completed', [DAY])).toEqual([2]);
    expect(await store.readDailyTotals(GLOBAL_QUEUE, 'completed', [DAY])).toEqual([2]);
  });

  it('sums queues into the global rollup', async () => {
    await store.upsertMinute('Q', 'completed', MINUTE, 4);
    await store.upsertMinute('Q2', 'completed', MINUTE, 6);

    expect(await store.readDailyTotals(GLOBAL_QUEUE, 'completed', [DAY])).toEqual([10]);
    expect(await rows(GLOBAL_QUEUE, 'minute')).toEqual({ [MINUTE]: 10 });
  });

  it('never writes a zero bucket for a minute that was never recorded', async () => {
    await store.upsertMinute('Q', 'completed', MINUTE, 0);

    expect(await rows('Q', 'minute')).toEqual({});
    expect(await store.readDailyTotals('Q', 'completed', [DAY])).toEqual([null]);
  });

  it('writes a whole snapshot in one call, and re-snapshotting an overlap adds nothing', async () => {
    const points = Array.from({ length: 180 }, (_, i) => ({ minute: MINUTE + i, value: 1 }));
    await store.upsertMinutes('Q', 'completed', points);
    // A restarted recorder re-reads the newest two hours of the buffer plus a new minute.
    await store.upsertMinutes('Q', 'completed', [
      ...points.slice(60),
      { minute: MINUTE + 180, value: 5 },
    ]);

    expect(await store.readDailyTotals('Q', 'completed', [DAY])).toEqual([185]);
    const hour = minuteToHour(MINUTE);
    expect(await store.readHours('Q', 'completed', [DAY])).toEqual({
      [hour]: 60,
      [hour + 1]: 60,
      [hour + 2]: 60,
      [hour + 3]: 5,
    });
  });

  it('does not double count when two recorders snapshot the same window at once', async () => {
    const points = Array.from({ length: 50 }, (_, i) => ({ minute: MINUTE + i, value: 2 }));
    const other = counters();
    await Promise.all([
      store.upsertMinutes('Q', 'completed', points),
      other.upsertMinutes('Q', 'completed', points),
      store.upsertMinutes('Q2', 'completed', points),
    ]);

    expect(await store.readDailyTotals('Q', 'completed', [DAY])).toEqual([100]);
    expect(await store.readDailyTotals(GLOBAL_QUEUE, 'completed', [DAY])).toEqual([200]);
  });

  it('reads hourly buckets across several days', async () => {
    const next = MINUTE + 1440;
    await store.upsertMinute('Q', 'completed', MINUTE, 3);
    await store.upsertMinute('Q', 'completed', next, 9);

    expect(await store.readHours('Q', 'completed', [DAY, minuteToDay(next)])).toEqual({
      [minuteToHour(MINUTE)]: 3,
      [minuteToHour(next)]: 9,
    });
    expect(await store.readHours('Q', 'completed', [minuteToDay(next)])).toEqual({
      [minuteToHour(next)]: 9,
    });
  });

  describe('retention', () => {
    const minuteOn = (offsetDays: number) => MINUTE + offsetDays * 1440;

    it('drops day totals older than the window, for the queue and the global rollup', async () => {
      const short = counters({ minutes: 2, hours: 2, days: 2 });
      for (const offset of [0, 1, 2, 3]) {
        await short.upsertMinute('Q', 'completed', minuteOn(offset), 1);
      }
      const days = [0, 1, 2, 3].map((o) => minuteToDay(minuteOn(o)));

      expect(await short.readDailyTotals('Q', 'completed', days)).toEqual([null, 1, 1, 1]);
      expect(await short.readDailyTotals(GLOBAL_QUEUE, 'completed', days)).toEqual([null, 1, 1, 1]);
    });

    it('gives each tier its own window', async () => {
      const tiered = counters({ minutes: 1, hours: 2, days: 3 });
      await tiered.upsertMinute('Q', 'completed', minuteOn(0), 1);
      await tiered.upsertMinute('Q', 'completed', minuteOn(3), 1);

      // Written on day 3: minutes keep day 2 onward, hours day 1 onward, days day 0 onward.
      expect(Object.keys(await rows('Q', 'minute'))).toEqual([String(minuteOn(3))]);
      expect(Object.keys(await rows('Q', 'hour'))).toEqual([String(minuteToHour(minuteOn(3)))]);
      expect(Object.keys(await rows('Q', 'day'))).toHaveLength(2);
    });

    it('prunes once per new day rather than on every write', async () => {
      const short = counters({ minutes: 2, hours: 2, days: 2 });
      await short.upsertMinute('Q', 'completed', minuteOn(0), 1);
      await pool.query(
        `INSERT INTO ${metrics.tables.counters} (queue, metric, tier, bucket, value)
         VALUES ('Q', 'completed', 'day', 10000, 5)`
      );
      await short.upsertMinute('Q', 'completed', minuteOn(0) + 1, 1);
      expect(await rows('Q', 'day')).toHaveProperty('10000');

      await short.upsertMinute('Q', 'completed', minuteOn(1), 1);
      expect(await rows('Q', 'day')).not.toHaveProperty('10000');
    });
  });
});
