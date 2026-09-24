import type {
  HistoryQueueStats,
  HistoryStats,
  HistoryTier,
  PurgeOptions,
  PurgeResult,
  TierStats,
} from '../HistoryAdmin';
import { GLOBAL_QUEUE, dayToIndex, indexToDay, toDay } from '../keys';
import type { HistoryAdministration } from '../store';
import { inTransaction, type PgContext } from './context';

/** Same reasoning as the Redis admin: only plain sums can have one queue's share taken out. */
const SUMMABLE_METRICS = ['completed', 'failed'];

function emptyTiers(): Record<HistoryTier, TierStats> {
  return {
    minute: { keys: 0, bytes: 0 },
    hour: { keys: 0, bytes: 0 },
    day: { keys: 0, bytes: 0 },
  };
}

/**
 * The day a row covers, as a SQL expression over its `tier` and `bucket` columns. `null` for
 * the day tier, matching the Redis admin, where only minute and hour hashes carry a day.
 */
const ROW_DAY = `CASE tier WHEN 'minute' THEN bucket / 1440 WHEN 'hour' THEN bucket / 24 END`;

/**
 * `stats()` and `purge()` over the PostgreSQL tables, reported in the same shape as the Redis
 * admin so the board's storage panel reads either one:
 *
 * - `keys` counts rows. A Redis key is a whole hash of buckets; a row here is one bucket, so
 *   the numbers are larger for the same history and only comparable within one backend.
 * - `bytes` is the tables' real on-disk footprint, `pg_total_relation_size` (heap, TOAST and
 *   indexes), apportioned to queues and tiers by each row's `pg_column_size`. The parts add up
 *   to what the tables occupy, rather than to the smaller sum of raw row sizes. Dead tuples
 *   awaiting vacuum count until autovacuum reclaims them, as they do on disk.
 * - `minutes` counts minute-tier rows, which is the same number as the Redis minute fields.
 */
export class PostgresHistoryAdmin implements HistoryAdministration {
  constructor(private readonly ctx: PgContext) {}

  async stats(): Promise<HistoryStats> {
    await this.ctx.ready();
    const { counters, histograms } = this.ctx.tables;
    const [groups, days] = await Promise.all([
      this.ctx.pool.query(
        `WITH sized AS (
           SELECT 'counters' AS tbl, queue, tier,
                  count(*) AS rows, sum(pg_column_size(c.*))::float8 AS size
             FROM ${counters} c GROUP BY queue, tier
           UNION ALL
           SELECT 'histograms', queue, tier,
                  count(*), sum(pg_column_size(h.*))::float8
             FROM ${histograms} h GROUP BY queue, tier
         )
         SELECT s.queue, s.tier, s.rows,
                CASE WHEN t.size > 0
                     THEN round(s.size / t.size * t.bytes)
                     ELSE 0 END AS bytes
           FROM sized s
           JOIN (SELECT tbl, sum(size) AS size,
                        CASE tbl WHEN 'counters' THEN pg_total_relation_size($1::regclass)
                                 ELSE pg_total_relation_size($2::regclass) END AS bytes
                   FROM sized GROUP BY tbl) t ON t.tbl = s.tbl`,
        [counters, histograms]
      ),
      this.ctx.pool.query(
        `SELECT DISTINCT queue, ${ROW_DAY} AS day FROM ${counters} WHERE tier <> 'day'
         UNION
         SELECT DISTINCT queue, ${ROW_DAY} FROM ${histograms} WHERE tier <> 'day'`
      ),
    ]);

    const byQueue = new Map<string, HistoryQueueStats>();
    const entry = (queue: string): HistoryQueueStats => {
      let found = byQueue.get(queue);
      if (!found) {
        found = { queue, keys: 0, bytes: 0, minutes: 0, days: [], tiers: emptyTiers() };
        byQueue.set(queue, found);
      }
      return found;
    };

    const tiers = emptyTiers();
    let keys = 0;
    let bytes = 0;
    let minutes = 0;
    for (const row of groups.rows) {
      const tier = row.tier as HistoryTier;
      const rows = Number(row.rows);
      const size = Number(row.bytes);
      const queue = entry(row.queue);
      queue.keys += rows;
      queue.bytes += size;
      queue.tiers[tier].keys += rows;
      queue.tiers[tier].bytes += size;
      tiers[tier].keys += rows;
      tiers[tier].bytes += size;
      keys += rows;
      bytes += size;
      if (tier === 'minute') {
        queue.minutes += rows;
        minutes += rows;
      }
    }

    let oldestDay: string | null = null;
    let newestDay: string | null = null;
    for (const row of days.rows) {
      const day = indexToDay(Number(row.day));
      entry(row.queue).days.push(day);
      if (oldestDay === null || day < oldestDay) {
        oldestDay = day;
      }
      if (newestDay === null || day > newestDay) {
        newestDay = day;
      }
    }

    const queues = [...byQueue.values()].sort((a, b) => b.bytes - a.bytes);
    for (const queue of queues) {
      queue.days = [...new Set(queue.days)].sort();
    }
    return { keys, bytes, minutes, oldestDay, newestDay, tiers, queues };
  }

  /**
   * One transaction. Purging a single queue first subtracts its completed and failed rows
   * from the matching `__global__` rows, tier by tier, and drops the global rows that drain to
   * zero or below, exactly as the Redis admin does; the latency rollups keep the queue's share
   * until retention drops it, for the same reason (see `SUMMABLE_METRICS` there).
   *
   * `keysDeleted` counts minute and hour rows, the rows a Redis day-scoped key holds;
   * `fieldsDeleted` counts day rows, the Redis totals-hash fields. Both include drained global
   * rows.
   */
  async purge(opts: PurgeOptions = {}): Promise<PurgeResult> {
    const before = opts.before === undefined ? null : dayToIndex(toDay(opts.before));
    const queue = opts.queue ?? null;
    const adjustGlobal = queue !== null && queue !== GLOBAL_QUEUE;
    const { counters, histograms } = this.ctx.tables;
    const scope = `($1::text IS NULL OR queue = $1)
      AND ($2::bigint IS NULL OR coalesce(${ROW_DAY}, bucket) < $2)`;

    return inTransaction(this.ctx, async (client) => {
      const result: PurgeResult = { keysDeleted: 0, fieldsDeleted: 0 };
      const tally = (tier: string, count: number) => {
        if (tier === 'day') {
          result.fieldsDeleted += count;
        } else {
          result.keysDeleted += count;
        }
      };

      const { rows: removed } = await client.query(
        `WITH doomed AS (
           DELETE FROM ${counters} WHERE ${scope}
           RETURNING metric, tier, bucket, value
         ),
         drained AS (
           UPDATE ${counters} g SET value = g.value - d.value
             FROM doomed d
            WHERE $3 AND g.queue = $4 AND g.metric = d.metric AND g.tier = d.tier
              AND g.bucket = d.bucket AND d.metric = ANY($5::text[]) AND d.value <> 0
           RETURNING g.metric, g.tier, g.bucket, g.value
         )
         SELECT 'doomed' AS kind, tier, count(*) AS n, NULL::text[] AS metrics,
                NULL::bigint[] AS buckets
           FROM doomed GROUP BY tier
         UNION ALL
         SELECT 'drained', tier, count(*), array_agg(metric), array_agg(bucket)
           FROM drained WHERE value <= 0 GROUP BY tier`,
        [queue, before, adjustGlobal, GLOBAL_QUEUE, SUMMABLE_METRICS]
      );

      for (const row of removed) {
        if (row.kind === 'doomed') {
          tally(row.tier, Number(row.n));
          continue;
        }
        // The recorder never writes a zero bucket, so a leftover zero would read as
        // recorded-but-idle instead of not recorded.
        const { rowCount } = await client.query(
          `DELETE FROM ${counters} g
             USING unnest($2::text[], $3::bigint[]) AS d(metric, bucket)
            WHERE g.queue = $1 AND g.tier = $4 AND g.metric = d.metric AND g.bucket = d.bucket`,
          [GLOBAL_QUEUE, row.metrics, row.buckets, row.tier]
        );
        tally(row.tier, rowCount ?? 0);
      }

      const { rows: latency } = await client.query(
        `WITH doomed AS (DELETE FROM ${histograms} WHERE ${scope} RETURNING tier)
         SELECT tier, count(*) AS n FROM doomed GROUP BY tier`,
        [queue, before]
      );
      for (const row of latency) {
        tally(row.tier, Number(row.n));
      }
      return result;
    });
  }
}
