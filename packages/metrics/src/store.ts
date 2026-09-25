import type { MetricsClient } from './connection';
import type { MinutePoint } from './dataMapping';
import type { HistoryStats, PurgeOptions, PurgeResult } from './HistoryAdmin';

export interface Retention {
  /** Days of minute-level detail. Doubles as the recorder's catch-up window. */
  minutes: number;
  /** Days of hourly rollup. */
  hours: number;
  /** Days of daily totals, which is what the shipped charts read. */
  days: number;
}

export type LatencyMetric = 'runtime' | 'waittime';

/**
 * Completed and failed throughput, stored at minute, hour and day resolution per queue plus
 * the `__global__` rollup.
 *
 * Writes are absolute per-minute values, never increments: the minute tier is a ledger, and
 * each write applies only its difference against what the ledger already holds, to every
 * coarser tier. Re-writing a minute that is already stored is therefore a no-op, which is what
 * lets a restarted recorder, or a second one, re-snapshot an overlapping window safely.
 */
export interface CounterStore {
  readonly retention: Retention;
  /**
   * `rollup` names the cross-queue series the points are also added to, `__global__` unless a
   * `CounterSource` says otherwise. That is what keeps two boards sharing one store apart.
   */
  upsertMinutes(
    queue: string,
    metric: string,
    points: MinutePoint[],
    rollup?: string
  ): Promise<void>;
  /**
   * The newest minute recorded for a queue inside the minute window, or `null`. A recorder that
   * restarts reads a `CounterSource` from here instead of from the start of the window, since a
   * source that counts rows can lose rows it already counted (pg-boss deletes finished jobs) and
   * re-reading those minutes would write the smaller number back over the recorded one.
   */
  latestMinute(queue: string, metric: string): Promise<number | null>;
  /** One entry per requested day: `null` when never recorded, a number (maybe 0) when it was. */
  readDailyTotals(queue: string, metric: string, days: string[]): Promise<(number | null)[]>;
  /** Hourly buckets over the given days, keyed by absolute hour index. */
  readHours(queue: string, metric: string, days: string[]): Promise<Record<string, number>>;
}

/**
 * Latency histograms (runtime, waittime) and the queue-age gauge, at hour and day resolution,
 * plus the small amount of coordination state the sampler keeps next to them.
 *
 * Histograms are merged by increment, so unlike the counters a double write double-counts.
 * The lease is what prevents that: only its holder scans a queue on a given tick.
 */
export interface LatencyStorage {
  readonly retention: Retention;
  /** `rollup` as in `CounterStore.upsertMinutes`. */
  addSamples(
    queue: string,
    metric: LatencyMetric,
    hour: number,
    vector: number[],
    rollup?: string
  ): Promise<void>;
  recordQueueAge(queue: string, hour: number, ms: number, rollup?: string): Promise<void>;
  /** Keyed by ISO day for `'day'`, by absolute hour index for `'hour'`. */
  readRange(
    queue: string,
    metric: LatencyMetric,
    granularity: 'hour' | 'day',
    days: string[]
  ): Promise<Record<string, number[]>>;
  readQueueAge(
    queue: string,
    granularity: 'hour' | 'day',
    days: string[]
  ): Promise<Record<string, number>>;
  /** Set-if-absent with a crash-ceiling TTL. `true` when `holder` now owns the queue's lease. */
  acquireLease(queue: string, holder: string, ttlMs: number): Promise<boolean>;
  /** Compare and delete: a lease that expired and was retaken by someone else is left alone. */
  releaseLease(queue: string, holder: string): Promise<void>;
  /** Finish-time bound of the last scan, epoch ms, or `null` for a cold start. */
  readWatermark(queue: string): Promise<number | null>;
  writeWatermark(queue: string, ms: number, ttlSeconds: number): Promise<void>;
}

/** Footprint and cleanup, backing the board's storage panel. */
export interface HistoryAdministration {
  stats(): Promise<HistoryStats>;
  purge(options?: PurgeOptions): Promise<PurgeResult>;
}

/**
 * Where recorded history lives. `RedisMetricsStore` and `PostgresMetricsStore` are the two
 * implementations; hand either to `MetricsRecorder`, a history provider or
 * `MetricsHistoryAdmin` as `store`.
 *
 * The members are the seam those classes are built on rather than an API to call directly.
 */
export interface MetricsStore {
  /** @internal */
  counterStore(retention: Retention): CounterStore;
  /** @internal */
  latencyStore(retention: Retention): LatencyStorage;
  /** @internal */
  administration(): HistoryAdministration;
  /**
   * @internal
   * The Redis the sampler reads Redis-backed queues through. A Redis store answers with its
   * own client, which is the queues' Redis in the classic single-Redis setup; `null` makes the
   * sampler ask each adapter for its own client instead.
   */
  readonly jobClient: MetricsClient | null;
  /** Releases what the store opened itself. A connection handed in is left to its owner. */
  close(): Promise<void>;
}
