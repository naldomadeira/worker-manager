import { dayToIndex, shiftDay } from '../keys';
import type { Retention } from '../store';
import type { PgPool, PgPoolClient } from './connection';
import type { MetricsTables } from './schema';

const MINUTES_PER_DAY = 1440;
const HOURS_PER_DAY = 24;

/** What the PostgreSQL stores share: one pool, one set of tables, one readiness gate. */
export interface PgContext {
  pool: PgPool;
  tables: MetricsTables;
  /** Resolves once the tables are there, migrating first when the store was asked to. */
  ready(): Promise<void>;
}

export async function inTransaction<T>(
  ctx: PgContext,
  work: (client: PgPoolClient) => Promise<T>
): Promise<T> {
  await ctx.ready();
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    try {
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  } finally {
    client.release();
  }
}

export function normalizeRetention(retention: Retention): Retention {
  return {
    minutes: Math.max(1, Math.floor(retention.minutes)),
    hours: Math.max(1, Math.floor(retention.hours)),
    days: Math.max(1, Math.floor(retention.days)),
  };
}

/**
 * The SQL counterpart of the Redis TTLs and totals trimming: every tier drops the days older
 * than its own retention, counted back from `day`.
 *
 * Anchored on the day being written rather than on the wall clock, exactly as the Redis
 * scripts trim against the day of the write, and run by each writer on its first write and
 * then on the first write of every new day, so about once a day per process. The deletes
 * are range scans on the `(tier, bucket)` indexes. Sampler state past its expiry goes too:
 * a watermark outliving its queue is the unbounded-storage failure this package avoids.
 */
export class RetentionPruner {
  private prunedFor: string | null = null;

  constructor(
    private readonly ctx: PgContext,
    private readonly retention: Retention
  ) {}

  async afterWrite(day: string): Promise<void> {
    if (this.prunedFor !== null && day <= this.prunedFor) {
      return;
    }
    this.prunedFor = day;
    const { counters, histograms, samplerState } = this.ctx.tables;
    const minuteCutoff = dayToIndex(shiftDay(day, -this.retention.minutes)) * MINUTES_PER_DAY;
    const hourCutoff = dayToIndex(shiftDay(day, -this.retention.hours)) * HOURS_PER_DAY;
    const dayCutoff = dayToIndex(shiftDay(day, -this.retention.days));
    try {
      await this.ctx.pool.query(
        `DELETE FROM ${counters}
          WHERE (tier = 'minute' AND bucket < $1)
             OR (tier = 'hour' AND bucket < $2)
             OR (tier = 'day' AND bucket < $3)`,
        [minuteCutoff, hourCutoff, dayCutoff]
      );
      await this.ctx.pool.query(
        `DELETE FROM ${histograms}
          WHERE (tier = 'hour' AND bucket < $1) OR (tier = 'day' AND bucket < $2)`,
        [hourCutoff, dayCutoff]
      );
      await this.ctx.pool.query(`DELETE FROM ${samplerState} WHERE expires_at <= now()`);
    } catch (error) {
      this.prunedFor = null; // retried on the next write instead of waiting a day
      throw error;
    }
  }
}
