import type {
  MetricsHistoryPoint,
  MetricsHistoryProvider,
  MetricsHistoryQuery,
  MetricsLatencyPoint,
  MetricsLatencyQuery,
} from '@worker-manager/api/typings/app';
import { emptyVector, mergeVectors, quantile, vectorTotal } from './histogram';
import type { HistoryStats, PurgeOptions, PurgeResult } from './HistoryAdmin';
import { GLOBAL_QUEUE, dayRange, dayToStartMs } from './keys';
import type {
  CounterStore,
  HistoryAdministration,
  LatencyStorage,
  MetricsStore,
  Retention,
} from './store';

const MS_PER_HOUR = 3600000;

/**
 * The `MetricsHistoryProvider` contract over any `MetricsStore`. Everything that decides what
 * a chart receives lives here, once: span clamping, day-start alignment, the empty-history
 * rule and percentile merging. The stores only fetch buckets, so a Redis and a PostgreSQL
 * board answer the same query with the same points.
 */
export class StoreHistoryProvider implements MetricsHistoryProvider {
  private readonly counters: CounterStore;
  private readonly latency: LatencyStorage;
  private readonly admin: HistoryAdministration;
  private readonly retentionDays: number;

  constructor(store: MetricsStore, retention: Retention) {
    this.retentionDays = retention.days;
    this.counters = store.counterStore(retention);
    this.latency = store.latencyStore(retention);
    this.admin = store.administration();
  }

  /** Backs the board's storage panel. See MetricsHistoryAdmin.stats. */
  async getUsage(): Promise<HistoryStats> {
    return this.admin.stats();
  }

  /** Backs the board's "clear history" action. See MetricsHistoryAdmin.purge. */
  async purge(options: PurgeOptions = {}): Promise<PurgeResult> {
    return this.admin.purge(options);
  }

  async getHistory(query: MetricsHistoryQuery): Promise<MetricsHistoryPoint[]> {
    const queue = query.queue ?? GLOBAL_QUEUE;
    const days = this.daysFor(query);

    if (query.metric === 'queueage') {
      const ages = await this.latency.readQueueAge(queue, query.granularity, days);
      // Day points are stamped at the day's start, so an intraday `from` would drop the day
      // it falls in. Floored, exactly as the counter path below does it.
      const lowerBound = query.granularity === 'day' ? dayFloor(query.from) : query.from;
      return Object.keys(ages)
        .map((key) => ({
          ts: query.granularity === 'day' ? dayToStartMs(key) : Number(key) * MS_PER_HOUR,
          value: ages[key],
        }))
        .filter((p) => p.ts >= lowerBound && p.ts <= query.to)
        .sort((a, b) => a.ts - b.ts);
    }

    if (query.granularity === 'day') {
      const totals = await this.counters.readDailyTotals(queue, query.metric, days);
      // Empty history only when no day in range was ever recorded (all fields missing).
      // A day with a stored 0 still counts as recorded -- otherwise the UI's empty
      // state would be unreachable once any data exists.
      if (totals.every((value) => value == null)) {
        return [];
      }
      return days
        .map((day, i) => ({ ts: dayToStartMs(day), value: totals[i] ?? 0 }))
        .filter((p) => p.ts >= dayFloor(query.from) && p.ts <= query.to);
    }

    const hours = await this.counters.readHours(queue, query.metric, days);
    return Object.keys(hours)
      .map((field) => ({ ts: Number(field) * MS_PER_HOUR, value: hours[field] }))
      .filter((p) => p.ts >= query.from && p.ts <= query.to)
      .sort((a, b) => a.ts - b.ts);
  }

  async getLatency(query: MetricsLatencyQuery): Promise<MetricsLatencyPoint[]> {
    const queue = query.queue ?? GLOBAL_QUEUE;
    const days = this.daysFor(query);

    if (query.granularity === 'range') {
      // Percentiles don't merge: averaging per-day p95s isn't the same number as the p95 of
      // the whole range. Read the day tier's bucket vectors and merge them, then compute each
      // requested percentile once from the summed vector.
      const raw = await this.latency.readRange(queue, query.metric, 'day', days);
      let merged = emptyVector();
      for (const day of days) {
        const vector = raw[day];
        if (vector) {
          merged = mergeVectors(merged, vector);
        }
      }
      const count = vectorTotal(merged);
      if (count === 0) {
        return [];
      }
      const values: Record<string, number> = {};
      for (const p of query.percentiles) {
        values[String(p)] = quantile(merged, p);
      }
      return [{ ts: query.from, count: Math.round(count), values }];
    }

    const raw = await this.latency.readRange(queue, query.metric, query.granularity, days);
    // Same day-start alignment as getHistory: comparing a day bucket against a raw `from`
    // would drop the oldest day and leave this chart one bucket shorter than the throughput
    // chart drawn for the same range.
    const lowerBound = query.granularity === 'day' ? dayFloor(query.from) : query.from;

    const points: MetricsLatencyPoint[] = [];
    for (const key of Object.keys(raw)) {
      const ts = query.granularity === 'day' ? dayToStartMs(key) : Number(key) * MS_PER_HOUR;
      if (ts < lowerBound || ts > query.to) {
        continue;
      }
      const vector = raw[key];
      const count = vectorTotal(vector);
      if (count === 0) {
        continue;
      }
      const values: Record<string, number> = {};
      for (const p of query.percentiles) {
        values[String(p)] = quantile(vector, p);
      }
      points.push({ ts, count: Math.round(count), values });
    }
    return points.sort((a, b) => a.ts - b.ts);
  }

  /**
   * Clamps the span to the retention window so an unbounded `from` (e.g. 0) can't make
   * dayRange produce an unbounded number of day buckets -- older data doesn't exist anyway.
   */
  private daysFor(query: { from: number; to: number }): string[] {
    const maxSpanMs = (this.retentionDays + 1) * 86400000;
    return dayRange(Math.max(query.from, query.to - maxSpanMs), query.to);
  }
}

function dayFloor(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
