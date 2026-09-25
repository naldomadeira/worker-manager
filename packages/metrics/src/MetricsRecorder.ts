import type { BaseAdapter } from '@worker-manager/api/baseAdapter';
import type { MetricsConnection } from './connection';
import {
  adapterCounterSource,
  adapterOf,
  type CounterMetric,
  type CounterSource,
  type CounterSources,
} from './counterSources';
import type { MinutePoint } from './dataMapping';
import { LatencySampler } from './LatencySampler';
import { RedisMetricsStore } from './RedisMetricsStore';
import type { CounterStore, MetricsStore, Retention } from './store';

const METRICS: CounterMetric[] = ['completed', 'failed'];
const MS_PER_MINUTE = 60000;
const MINUTES_PER_DAY = 1440;

/**
 * Minute detail is the expensive tier by two orders of magnitude, so it defaults to a week
 * rather than the full window: long enough to match the recommended `MetricsTime.ONE_WEEK`
 * worker buffer, so the recorder can be down for a week and still catch up completely.
 * The hourly and daily rollups are cheap enough to keep for the whole window.
 */
export const DEFAULT_RETENTION: Retention = { minutes: 7, hours: 90, days: 90 };

interface RedisOptions {
  /** Redis. Shorthand for `store: new RedisMetricsStore({ connection, prefix })`. */
  connection: MetricsConnection;
  /**
   * Redis key namespace, defaulting to `worker-manager:metrics`. Set it to separate two boards
   * sharing one Redis, and give the reading `RedisMetricsHistoryProvider` the same value.
   *
   * On a Redis Cluster the namespace has to sit in one hash slot, since the rollup scripts
   * write a queue's keys and the cross-queue keys in one EVAL. A prefix with no `{...}` hash
   * tag is wrapped in one, so `staging:metrics` becomes `{staging:metrics}`; supply your own
   * tag to choose the slot yourself.
   */
  prefix?: string;
  store?: never;
}

interface StoreOptions {
  /**
   * Where history is written, e.g. `new PostgresMetricsStore({ connection, migrate: true })`
   * for a board with no Redis. The recorder never closes a store it was handed.
   */
  store: MetricsStore;
  connection?: never;
  prefix?: never;
}

export type MetricsRecorderOptions = RecorderBaseOptions &
  (RedisOptions | StoreOptions) &
  (QueuesOption | SourcesOption);

interface QueuesOption {
  /**
   * A function is resolved on every tick, for a board whose queue set changes while it
   * runs. An array is read once, at construction.
   */
  queues: BaseAdapter[] | (() => BaseAdapter[]);
  /** See `SourcesOption.sources`. Either or both may be given. */
  sources?: CounterSources;
}

interface SourcesOption {
  queues?: BaseAdapter[] | (() => BaseAdapter[]);
  /**
   * Queues that are not queue adapters, such as `pgBossMetricsSources(engine)` from
   * `@worker-manager/pg-boss`. A function is resolved, and awaited, on every tick; an array is
   * read once. Recorded after `queues`, in the same tick.
   */
  sources: CounterSources;
}

interface RecorderBaseOptions {
  /** Per-resolution retention in days. Unspecified tiers fall back to the defaults. */
  retention?: Partial<Retention>;
  /**
   * Shorthand that sets the daily and hourly windows. Minute retention stays at its
   * default unless raised explicitly, since that is the tier that drives storage size.
   */
  retentionDays?: number;
  snapshotIntervalMs?: number;
  /**
   * Latency histograms and the queue-age gauge. On by default: the package exists to give
   * boards without a metrics stack something useful, and an opt-in feature is one nobody
   * finds. At default retention this costs roughly 250 to 300KB per queue under typical
   * traffic, up to about 575KB in a pathological worst case, plus a one-off shared cost of
   * roughly 224KB for the cross-queue rollup regardless of queue count.
   */
  latency?: boolean;
  /** Above this many finished jobs in one tick, the sampler subsamples. */
  maxLatencySamplesPerTick?: number;
  /**
   * Test-oriented escape hatch: overrides the sampler's default 5s safety margin (see
   * `LatencySampler`'s `SAFETY_MARGIN_MS`), which otherwise excludes jobs that finished
   * just before a scan. Lets a test read back a sample immediately instead of sleeping
   * past the margin.
   */
  latencySafetyMarginMs?: number;
  /**
   * Notified whenever a latency tick fails. Latency errors are swallowed on purpose so a
   * failing scan cannot take the counter snapshot with it, which also means a collector
   * broken since startup looks the same as a board with no traffic. Default stays silent;
   * wire this to your logger to tell an empty chart from a broken one.
   */
  onLatencyError?: (error: unknown, queueName: string) => void;
  /**
   * Notified when a scheduled snapshot fails, say because the store is unreachable. The
   * timer keeps running and the next tick retries; without a listener the failure is
   * dropped rather than surfacing as an unhandled rejection.
   */
  onSnapshotError?: (error: unknown) => void;
}

export function resolveRetention(opts: {
  retention?: Partial<Retention>;
  retentionDays?: number;
}): Retention {
  const base =
    opts.retentionDays === undefined
      ? DEFAULT_RETENTION
      : {
          minutes: Math.min(DEFAULT_RETENTION.minutes, opts.retentionDays),
          hours: opts.retentionDays,
          days: opts.retentionDays,
        };
  return { ...base, ...opts.retention };
}

export class MetricsRecorder {
  private readonly resolveQueues: (() => BaseAdapter[]) | null;
  private readonly resolveSources: (() => CounterSource[] | Promise<CounterSource[]>) | null;
  private readonly store: CounterStore;
  /** Set only when the recorder built the store itself, from a `connection`. */
  private readonly ownedStore: MetricsStore | null;
  private readonly intervalMs: number;
  private readonly lastMinute = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private stopped = false;
  readonly latencyEnabled: boolean;
  private readonly latencySampler: LatencySampler | null;
  private readonly onSnapshotError?: (error: unknown) => void;

  constructor(opts: MetricsRecorderOptions) {
    const { queues, sources } = opts;
    if (!queues && !sources) {
      throw new Error('MetricsRecorder needs `queues`, `sources`, or both.');
    }
    this.resolveQueues = !queues ? null : typeof queues === 'function' ? queues : () => queues;
    this.resolveSources = !sources ? null : typeof sources === 'function' ? sources : () => sources;
    this.intervalMs = opts.snapshotIntervalMs ?? 60000;
    const store =
      opts.store ?? new RedisMetricsStore({ connection: opts.connection, prefix: opts.prefix });
    this.ownedStore = opts.store ? null : store;
    const retention = resolveRetention(opts);
    this.store = store.counterStore(retention);
    this.onSnapshotError = opts.onSnapshotError;
    this.latencyEnabled = opts.latency !== false;
    this.latencySampler = this.latencyEnabled
      ? new LatencySampler({
          redis: store.jobClient ?? undefined,
          store: store.latencyStore(retention),
          tickMs: this.intervalMs,
          maxSamplesPerTick: opts.maxLatencySamplesPerTick,
          safetyMarginMs: opts.latencySafetyMarginMs,
          onError: opts.onLatencyError,
        })
      : null;
  }

  get retention(): Retention {
    return this.store.retention;
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => this.scheduledSnapshot(), this.intervalMs);
    // Do not keep the event loop alive solely for the recorder.
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
    this.scheduledSnapshot();
  }

  /** Stops the timer and closes a connection the recorder opened. A store handed in stays open. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.ownedStore && !this.stopped) {
      void this.ownedStore.close();
    }
    this.stopped = true;
  }

  private scheduledSnapshot(): void {
    this.snapshot().catch((error) => {
      try {
        this.onSnapshotError?.(error);
      } catch {
        // A throwing reporter must not turn a contained failure into an unhandled one.
      }
    });
  }

  async snapshot(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const sources = (this.resolveQueues?.() ?? []).map(adapterCounterSource);
      if (this.resolveSources) {
        sources.push(...(await this.resolveSources()));
      }
      for (const source of sources) {
        const name = source.name;
        for (const metric of METRICS) {
          await this.snapshotOne(source, name, metric);
        }
        if (this.latencySampler) {
          const adapter = adapterOf(source);
          await (adapter
            ? this.latencySampler.sample(adapter)
            : this.latencySampler.sampleSource(name, source.jobSource(), source.rollup));
        }
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Incrementally copies BullMQ's per-minute ring buffer into long-retention storage.
   * `seenUpTo` is a per-(queue, metric) watermark of the newest minute already written.
   * getMetrics() returns points newest-first, so we walk from the newest and stop at the
   * first minute we've already stored: everything past it is older and stored too. Fresh
   * minutes are upserted (safe against overlapping windows across ticks), then the
   * watermark advances. So the first tick backfills the buffer and every later tick only
   * writes the minutes that appeared since.
   *
   * A `CounterSource` that is not an adapter is asked for exactly the range past the
   * watermark, and a cold start takes that watermark from the store rather than re-reading the
   * whole minute window: a source that counts rows (pg-boss) can have lost rows it already
   * counted, and writing its smaller count back would subtract them from every rollup.
   */
  private async snapshotOne(
    source: CounterSource,
    name: string,
    metric: CounterMetric
  ): Promise<void> {
    const cursorKey = `${name}:${metric}`;
    let seenUpTo = this.lastMinute.get(cursorKey);
    const currentMinute = Math.floor(Date.now() / MS_PER_MINUTE);
    const isAdapter = adapterOf(source) !== null;
    if (seenUpTo === undefined && !isAdapter) {
      seenUpTo = (await this.store.latestMinute(name, metric)) ?? -1;
      this.lastMinute.set(cursorKey, seenUpTo);
    }
    seenUpTo ??= -1;

    const fromMinute = Math.max(
      seenUpTo + 1,
      currentMinute - this.store.retention.minutes * MINUTES_PER_DAY
    );
    const points = await source.readMinutes(
      metric,
      fromMinute * MS_PER_MINUTE,
      currentMinute * MS_PER_MINUTE
    );
    if (points.length === 0) {
      return;
    }

    // Correctness guard, not an optimization. Idempotency comes from the minute hash
    // holding the previously written value, so a minute whose hash has already expired
    // would look brand new and be added to the hourly and daily rollups a second time.
    // That can only happen when the worker's metrics buffer reaches further back than the
    // minute window (say a two-week buffer against a one-week window) and the recorder
    // restarts, losing its in-memory watermark. Refusing to write past the window closes
    // it. Nothing is lost that could have been retained anyway.
    const oldestWritable =
      Math.floor(Date.now() / MS_PER_MINUTE) - this.store.retention.minutes * MINUTES_PER_DAY;

    // A filter rather than an early exit, since only an adapter promises newest-first order.
    // For an adapter the result is the same: its minutes strictly descend, so everything past
    // the first stored or too-old minute is stored or too old as well.
    let newest = seenUpTo;
    const fresh: MinutePoint[] = [];
    for (const point of points) {
      if (point.minute <= seenUpTo || point.minute < oldestWritable) {
        continue;
      }
      if (!isAdapter && point.minute >= currentMinute) {
        continue; // a source is not trusted with the minute in progress
      }
      fresh.push(point);
      if (point.minute > newest) {
        newest = point.minute;
      }
    }
    // One call per queue and metric, so a SQL store can make it one transaction. The
    // watermark only moves once the write has landed.
    await (source.rollup === undefined
      ? this.store.upsertMinutes(name, metric, fresh)
      : this.store.upsertMinutes(name, metric, fresh, source.rollup));
    this.lastMinute.set(cursorKey, newest);
  }
}
