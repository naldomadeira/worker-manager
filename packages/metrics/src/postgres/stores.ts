import type { MinutePoint } from '../dataMapping';
import { BUCKET_COUNT, emptyVector } from '../histogram';
import { GLOBAL_QUEUE, dayToIndex, indexToDay, minuteToDay } from '../keys';
import { QUEUE_AGE_METRIC } from '../LatencyStore';
import type { CounterStore, LatencyMetric, LatencyStorage, Retention } from '../store';
import { inTransaction, normalizeRetention, RetentionPruner, type PgContext } from './context';

const HOURS_PER_DAY = 24;

/** Contiguous `[first, last]` day-index bounds of a day list, for an indexed range read. */
function dayBounds(days: string[]): [number, number] {
  const indices = days.map(dayToIndex);
  return [Math.min(...indices), Math.max(...indices)];
}

function toVector(raw: unknown): number[] {
  const out = emptyVector();
  if (!Array.isArray(raw)) {
    return out;
  }
  for (let i = 0; i < BUCKET_COUNT && i < raw.length; i++) {
    out[i] = Number(raw[i]) || 0;
  }
  return out;
}

/**
 * The PostgreSQL `CounterStore`. One transaction per snapshot of a queue's metric: a
 * transaction-scoped advisory lock on (tables, queue, metric), then one statement that
 * diffs the incoming minutes against the minute ledger and applies only the differences to
 * the hour and day tiers of the queue and of `__global__`.
 *
 * The lock is what makes that diff safe across processes, the way running inside one EVAL
 * does in Redis: a second recorder snapshotting the same window waits, then reads the ledger
 * the first one committed and finds nothing left to add. The rollup rows are written in a
 * fixed order, so two queues contending for the same `__global__` rows cannot deadlock.
 */
export class PostgresCounterStore implements CounterStore {
  readonly retention: Retention;
  private readonly pruner: RetentionPruner;

  constructor(
    private readonly ctx: PgContext,
    retention: Retention
  ) {
    this.retention = normalizeRetention(retention);
    this.pruner = new RetentionPruner(ctx, this.retention);
  }

  async upsertMinute(queue: string, metric: string, minute: number, value: number): Promise<void> {
    await this.upsertMinutes(queue, metric, [{ minute, value }]);
  }

  async upsertMinutes(queue: string, metric: string, points: MinutePoint[]): Promise<void> {
    if (points.length === 0) {
      return;
    }
    const { counters, prefix, schema } = this.ctx.tables;
    await inTransaction(this.ctx, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${schema}.${prefix}:${queue}:${metric}`,
      ]);
      await client.query(
        `WITH incoming AS (
           SELECT DISTINCT ON (minute) minute, value
             FROM unnest($3::bigint[], $4::bigint[]) AS t(minute, value)
            ORDER BY minute
         ),
         changed AS (
           SELECT i.minute, i.value, i.value - coalesce(c.value, 0) AS delta
             FROM incoming i
             LEFT JOIN ${counters} c
               ON c.queue = $1 AND c.metric = $2 AND c.tier = 'minute' AND c.bucket = i.minute
            WHERE i.value <> coalesce(c.value, 0)
         ),
         ledger AS (
           INSERT INTO ${counters} (queue, metric, tier, bucket, value)
           SELECT $1, $2, 'minute', minute, value FROM changed
           ON CONFLICT (queue, metric, tier, bucket) DO UPDATE SET value = EXCLUDED.value
         ),
         rollup AS (
           SELECT r.queue, r.tier, r.bucket, sum(c.delta) AS delta
             FROM changed c
            CROSS JOIN LATERAL (VALUES
              ($1::text, 'hour', c.minute / 60),
              ($1::text, 'day', c.minute / 1440),
              ($5::text, 'minute', c.minute),
              ($5::text, 'hour', c.minute / 60),
              ($5::text, 'day', c.minute / 1440)
            ) AS r(queue, tier, bucket)
            GROUP BY r.queue, r.tier, r.bucket
         )
         INSERT INTO ${counters} (queue, metric, tier, bucket, value)
         SELECT queue, $2, tier, bucket, delta FROM rollup ORDER BY queue, tier, bucket
         ON CONFLICT (queue, metric, tier, bucket)
           DO UPDATE SET value = ${counters}.value + EXCLUDED.value`,
        [
          queue,
          metric,
          points.map((p) => p.minute),
          points.map((p) => Math.round(p.value)),
          GLOBAL_QUEUE,
        ]
      );
    });
    const newest = Math.max(...points.map((p) => p.minute));
    await this.pruner.afterWrite(minuteToDay(newest));
  }

  async readDailyTotals(queue: string, metric: string, days: string[]): Promise<(number | null)[]> {
    if (days.length === 0) {
      return [];
    }
    await this.ctx.ready();
    const { rows } = await this.ctx.pool.query(
      `SELECT bucket, value FROM ${this.ctx.tables.counters}
        WHERE queue = $1 AND metric = $2 AND tier = 'day' AND bucket = ANY($3::bigint[])`,
      [queue, metric, days.map(dayToIndex)]
    );
    const byDay = new Map(rows.map((row) => [indexToDay(Number(row.bucket)), Number(row.value)]));
    return days.map((day) => byDay.get(day) ?? null);
  }

  async readHours(queue: string, metric: string, days: string[]): Promise<Record<string, number>> {
    return readHourScalars(this.ctx, queue, metric, days);
  }
}

async function readHourScalars(
  ctx: PgContext,
  queue: string,
  metric: string,
  days: string[]
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (days.length === 0) {
    return out;
  }
  await ctx.ready();
  const [first, last] = dayBounds(days);
  const wanted = new Set(days);
  const { rows } = await ctx.pool.query(
    `SELECT bucket, value FROM ${ctx.tables.counters}
      WHERE queue = $1 AND metric = $2 AND tier = 'hour' AND bucket >= $3 AND bucket < $4`,
    [queue, metric, first * HOURS_PER_DAY, (last + 1) * HOURS_PER_DAY]
  );
  for (const row of rows) {
    const hour = Number(row.bucket);
    if (wanted.has(indexToDay(Math.floor(hour / HOURS_PER_DAY)))) {
      out[String(hour)] = Number(row.value);
    }
  }
  return out;
}

/**
 * The PostgreSQL `LatencyStorage`. Each write is one multi-row upsert covering the queue's
 * hour and day rows and the `__global__` rollup of both, so it is atomic on its own. The rows
 * go in a fixed order (queue, then global; day, then hour) for the same deadlock reason as
 * the counters.
 *
 * Histograms merge element-wise in SQL, keeping bucket order through `WITH ORDINALITY`; the
 * queue-age gauge keeps the GREATEST value, since an hour holds the worst backlog seen in it.
 */
export class PostgresLatencyStore implements LatencyStorage {
  readonly retention: Retention;
  private readonly pruner: RetentionPruner;

  constructor(
    private readonly ctx: PgContext,
    retention: Retention
  ) {
    this.retention = normalizeRetention(retention);
    this.pruner = new RetentionPruner(ctx, this.retention);
  }

  async addSamples(
    queue: string,
    metric: LatencyMetric,
    hour: number,
    vector: number[]
  ): Promise<void> {
    await this.ctx.ready();
    const { histograms } = this.ctx.tables;
    const day = minuteToDay(hour * 60);
    const counts = toVector(vector).map((v) => Math.round(v));
    await this.ctx.pool.query(
      `INSERT INTO ${histograms} (queue, metric, tier, bucket, counts) VALUES
         ($1, $2, 'day', $4, $5::bigint[]),
         ($1, $2, 'hour', $3, $5::bigint[]),
         ($6, $2, 'day', $4, $5::bigint[]),
         ($6, $2, 'hour', $3, $5::bigint[])
       ON CONFLICT (queue, metric, tier, bucket) DO UPDATE SET counts = ARRAY(
         SELECT coalesce(a, 0) + coalesce(b, 0)
           FROM unnest(${histograms}.counts, EXCLUDED.counts) WITH ORDINALITY AS t(a, b, i)
          ORDER BY i
       )`,
      [queue, metric, hour, dayToIndex(day), counts, GLOBAL_QUEUE]
    );
    await this.pruner.afterWrite(day);
  }

  async recordQueueAge(queue: string, hour: number, ms: number): Promise<void> {
    await this.ctx.ready();
    const { counters } = this.ctx.tables;
    const day = minuteToDay(hour * 60);
    await this.ctx.pool.query(
      `INSERT INTO ${counters} (queue, metric, tier, bucket, value) VALUES
         ($1, $2, 'day', $4, $5),
         ($1, $2, 'hour', $3, $5),
         ($6, $2, 'day', $4, $5),
         ($6, $2, 'hour', $3, $5)
       ON CONFLICT (queue, metric, tier, bucket)
         DO UPDATE SET value = GREATEST(${counters}.value, EXCLUDED.value)`,
      [queue, QUEUE_AGE_METRIC, hour, dayToIndex(day), Math.max(0, Math.round(ms)), GLOBAL_QUEUE]
    );
    await this.pruner.afterWrite(day);
  }

  async readRange(
    queue: string,
    metric: LatencyMetric,
    granularity: 'hour' | 'day',
    days: string[]
  ): Promise<Record<string, number[]>> {
    const out: Record<string, number[]> = {};
    if (days.length === 0) {
      return out;
    }
    await this.ctx.ready();
    const { histograms } = this.ctx.tables;
    if (granularity === 'day') {
      const { rows } = await this.ctx.pool.query(
        `SELECT bucket, counts FROM ${histograms}
          WHERE queue = $1 AND metric = $2 AND tier = 'day' AND bucket = ANY($3::bigint[])`,
        [queue, metric, days.map(dayToIndex)]
      );
      for (const row of rows) {
        out[indexToDay(Number(row.bucket))] = toVector(row.counts);
      }
      return out;
    }
    const [first, last] = dayBounds(days);
    const wanted = new Set(days);
    const { rows } = await this.ctx.pool.query(
      `SELECT bucket, counts FROM ${histograms}
        WHERE queue = $1 AND metric = $2 AND tier = 'hour' AND bucket >= $3 AND bucket < $4`,
      [queue, metric, first * HOURS_PER_DAY, (last + 1) * HOURS_PER_DAY]
    );
    for (const row of rows) {
      const hour = Number(row.bucket);
      if (wanted.has(indexToDay(Math.floor(hour / HOURS_PER_DAY)))) {
        out[String(hour)] = toVector(row.counts);
      }
    }
    return out;
  }

  async readQueueAge(
    queue: string,
    granularity: 'hour' | 'day',
    days: string[]
  ): Promise<Record<string, number>> {
    if (granularity === 'hour') {
      return readHourScalars(this.ctx, queue, QUEUE_AGE_METRIC, days);
    }
    const out: Record<string, number> = {};
    if (days.length === 0) {
      return out;
    }
    await this.ctx.ready();
    const { rows } = await this.ctx.pool.query(
      `SELECT bucket, value FROM ${this.ctx.tables.counters}
        WHERE queue = $1 AND metric = $2 AND tier = 'day' AND bucket = ANY($3::bigint[])`,
      [queue, QUEUE_AGE_METRIC, days.map(dayToIndex)]
    );
    for (const row of rows) {
      out[indexToDay(Number(row.bucket))] = Number(row.value);
    }
    return out;
  }

  /**
   * Set-if-absent on the database clock: the upsert only overwrites a lease that has already
   * expired, and returns a row only when it wrote one.
   */
  async acquireLease(queue: string, holder: string, ttlMs: number): Promise<boolean> {
    await this.ctx.ready();
    const { samplerState } = this.ctx.tables;
    const { rows } = await this.ctx.pool.query(
      `INSERT INTO ${samplerState} (queue, kind, value, expires_at)
       VALUES ($1, 'lease', $2, now() + $3 * interval '1 millisecond')
       ON CONFLICT (queue, kind) DO UPDATE
         SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at
         WHERE ${samplerState}.expires_at <= now()
       RETURNING value`,
      [queue, holder, Math.max(1, Math.round(ttlMs))]
    );
    return rows.length > 0;
  }

  async releaseLease(queue: string, holder: string): Promise<void> {
    await this.ctx.ready();
    await this.ctx.pool.query(
      `DELETE FROM ${this.ctx.tables.samplerState}
        WHERE queue = $1 AND kind = 'lease' AND value = $2`,
      [queue, holder]
    );
  }

  async readWatermark(queue: string): Promise<number | null> {
    await this.ctx.ready();
    const { rows } = await this.ctx.pool.query(
      `SELECT value FROM ${this.ctx.tables.samplerState}
        WHERE queue = $1 AND kind = 'watermark' AND expires_at > now()`,
      [queue]
    );
    return rows[0] ? Number(rows[0].value) : null;
  }

  async writeWatermark(queue: string, ms: number, ttlSeconds: number): Promise<void> {
    await this.ctx.ready();
    await this.ctx.pool.query(
      `INSERT INTO ${this.ctx.tables.samplerState} (queue, kind, value, expires_at)
       VALUES ($1, 'watermark', $2, now() + $3 * interval '1 second')
       ON CONFLICT (queue, kind) DO UPDATE
         SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at`,
      [queue, String(ms), Math.max(1, Math.round(ttlSeconds))]
    );
  }
}
