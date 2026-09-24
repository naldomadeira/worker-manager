import type { Pool } from 'pg';
import { BUCKET_COUNT, emptyVector, vectorTotal } from '../../src/histogram';
import { GLOBAL_QUEUE, minuteToDay } from '../../src/keys';
import type { PostgresMetricsStore } from '../../src/postgres/PostgresMetricsStore';
import type { LatencyStorage, Retention } from '../../src/store';
import { describePostgres, dropSchema, freshStore, testPool } from '../postgres';

const RETENTION: Retention = { minutes: 7, hours: 90, days: 90 };
const HOUR = Math.floor(Date.UTC(2020, 2, 10, 12) / 3600000);
const DAY = minuteToDay(HOUR * 60);

function vector(entries: Record<number, number>): number[] {
  const out = emptyVector();
  for (const [index, count] of Object.entries(entries)) {
    out[Number(index)] = count;
  }
  return out;
}

describePostgres('PostgresLatencyStore', () => {
  let pool: Pool;
  let metrics: PostgresMetricsStore;
  let store: LatencyStorage;

  beforeAll(() => {
    pool = testPool();
  });

  beforeEach(async () => {
    metrics = await freshStore(pool, 'latency');
    store = metrics.latencyStore(RETENTION);
  });

  afterEach(async () => {
    await dropSchema(pool, metrics.tables.schema);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('merges repeated samples into the same hour bucket, element by element', async () => {
    await store.addSamples('Q', 'runtime', HOUR, vector({ 0: 1, 3: 2 }));
    await store.addSamples('Q', 'runtime', HOUR, vector({ 3: 5, 17: 1 }));

    const hours = await store.readRange('Q', 'runtime', 'hour', [DAY]);
    expect(hours).toEqual({ [HOUR]: vector({ 0: 1, 3: 7, 17: 1 }) });
    expect(hours[HOUR]).toHaveLength(BUCKET_COUNT);
  });

  it('rolls the same samples into day totals and the global rollup', async () => {
    await store.addSamples('Q', 'runtime', HOUR, vector({ 2: 3 }));
    await store.addSamples('Q', 'runtime', HOUR + 1, vector({ 2: 4 }));
    await store.addSamples('Q2', 'runtime', HOUR, vector({ 5: 1 }));

    expect(await store.readRange('Q', 'runtime', 'day', [DAY])).toEqual({
      [DAY]: vector({ 2: 7 }),
    });
    const global = await store.readRange(GLOBAL_QUEUE, 'runtime', 'day', [DAY]);
    expect(global[DAY]).toEqual(vector({ 2: 7, 5: 1 }));
    expect(vectorTotal(global[DAY])).toBe(8);
  });

  it('keeps runtime and waittime separate', async () => {
    await store.addSamples('Q', 'runtime', HOUR, vector({ 1: 1 }));
    await store.addSamples('Q', 'waittime', HOUR, vector({ 9: 2 }));

    expect(await store.readRange('Q', 'runtime', 'day', [DAY])).toEqual({
      [DAY]: vector({ 1: 1 }),
    });
    expect(await store.readRange('Q', 'waittime', 'day', [DAY])).toEqual({
      [DAY]: vector({ 9: 2 }),
    });
  });

  it('stores queue age as a max rather than a sum, per queue and across queues', async () => {
    await store.recordQueueAge('Q', HOUR, 5000);
    await store.recordQueueAge('Q', HOUR, 1000);
    await store.recordQueueAge('Q2', HOUR, 3000);
    await store.recordQueueAge('Q2', HOUR + 1, 9000);

    expect(await store.readQueueAge('Q', 'hour', [DAY])).toEqual({ [HOUR]: 5000 });
    expect(await store.readQueueAge('Q', 'day', [DAY])).toEqual({ [DAY]: 5000 });
    expect(await store.readQueueAge(GLOBAL_QUEUE, 'hour', [DAY])).toEqual({
      [HOUR]: 5000,
      [HOUR + 1]: 9000,
    });
    expect(await store.readQueueAge(GLOBAL_QUEUE, 'day', [DAY])).toEqual({ [DAY]: 9000 });
  });

  it('records a zero age, so an idle queue reads as measured rather than missing', async () => {
    await store.recordQueueAge('Q', HOUR, 0);
    expect(await store.readQueueAge('Q', 'day', [DAY])).toEqual({ [DAY]: 0 });
  });

  it('returns nothing for a day that was never written', async () => {
    expect(await store.readRange('Q', 'runtime', 'day', [DAY])).toEqual({});
    expect(await store.readRange('Q', 'runtime', 'hour', [DAY])).toEqual({});
    expect(await store.readQueueAge('Q', 'day', [DAY])).toEqual({});
  });

  it('drops histogram days older than the retention window', async () => {
    const short = metrics.latencyStore({ minutes: 2, hours: 2, days: 2 });
    await short.addSamples('Q', 'runtime', HOUR, vector({ 1: 1 }));
    await short.addSamples('Q', 'runtime', HOUR + 3 * 24, vector({ 1: 1 }));

    const days = [0, 3].map((offset) => minuteToDay((HOUR + offset * 24) * 60));
    expect(Object.keys(await short.readRange('Q', 'runtime', 'day', days))).toEqual([days[1]]);
    expect(Object.keys(await short.readRange(GLOBAL_QUEUE, 'runtime', 'day', days))).toEqual([
      days[1],
    ]);
  });

  describe('sampler coordination', () => {
    it('grants the lease to one holder at a time and releases it only for that holder', async () => {
      expect(await store.acquireLease('Q', 'a', 60000)).toBe(true);
      expect(await store.acquireLease('Q', 'b', 60000)).toBe(false);
      expect(await store.acquireLease('Q', 'a', 60000)).toBe(false);

      await store.releaseLease('Q', 'b');
      expect(await store.acquireLease('Q', 'b', 60000)).toBe(false);

      await store.releaseLease('Q', 'a');
      expect(await store.acquireLease('Q', 'b', 60000)).toBe(true);
    });

    it('lets a lease that outlived its crash ceiling be retaken', async () => {
      expect(await store.acquireLease('Q', 'crashed', 20)).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(await store.acquireLease('Q', 'next', 60000)).toBe(true);
    });

    it('grants one lease under a race', async () => {
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => store.acquireLease('Race', `h${i}`, 60000))
      );
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it('stores a watermark that reads back until it expires', async () => {
      expect(await store.readWatermark('Q')).toBeNull();
      await store.writeWatermark('Q', 1234567, 60);
      expect(await store.readWatermark('Q')).toBe(1234567);
      await store.writeWatermark('Q', 2345678, 60);
      expect(await store.readWatermark('Q')).toBe(2345678);

      await pool.query(
        `UPDATE ${metrics.tables.samplerState} SET expires_at = now() - interval '1 second'`
      );
      expect(await store.readWatermark('Q')).toBeNull();
    });
  });
});
