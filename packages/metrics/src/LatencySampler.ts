import type { BaseAdapter } from '@worker-manager/api/baseAdapter';
import type { MetricsClient } from './connection';
import { bucketIndex, emptyVector } from './histogram';
import { postgresSourceOf, RedisJobSource, type JobSource } from './jobSources';
import type { MetricsKeys } from './keys';
import type { LatencyMetric, LatencyStorage } from './store';

const MS_PER_HOUR = 3600000;
const SECONDS_PER_DAY = 86400;
const DEFAULT_MAX_SAMPLES = 5000;
/**
 * ZADD into the finished set and this scan are not atomic with respect to each other, so a
 * job finishing microseconds before the scan can be absent from it. Advancing the watermark
 * to the highest score seen would skip that job forever. Scanning only up to a slightly
 * stale bound, and advancing the watermark to that bound rather than to what was observed,
 * means anything finishing inside the margin is picked up by the next tick instead.
 * Costs a few seconds of freshness in data that is bucketed hourly.
 *
 * The score is `Date.now()` read in the worker process and passed into BullMQ's Lua (or SQL),
 * not a datastore clock, so the margin only holds while the worker and this recorder agree on
 * the time: the effective margin is `margin - skew`. A worker running far enough ahead of
 * the recorder can still land jobs below an already-advanced watermark and lose them.
 */
const SAFETY_MARGIN_MS = 5000;

interface AdapterWithKeys extends BaseAdapter {
  getQueueKey(set: string): string;
  getClient?(): Promise<MetricsClient | null>;
}

export interface LatencySamplerOptions {
  /**
   * Redis to read Redis-backed queues through. The recorder passes its Redis store's client,
   * which is the queues' Redis in the classic setup. Omitted, each adapter's own client is
   * used. PostgreSQL-backed queues are always read through their own pool.
   */
  redis?: MetricsClient;
  /** Unused since the lease and watermark moved into `store`. Accepted for compatibility. */
  keys?: MetricsKeys;
  store: LatencyStorage;
  /** Recorder tick, used to size the lease and to bound a cold start. */
  tickMs: number;
  /** Above this, the tick subsamples uniformly rather than fetching every job. */
  maxSamplesPerTick?: number;
  /**
   * How far back from now a scan stops. Defaults to SAFETY_MARGIN_MS. Injectable so tests
   * can set it to 0 and sample jobs that just finished, rather than sleeping past the
   * margin in every case.
   */
  safetyMarginMs?: number;
  /**
   * Called with anything `sample()` swallows. The default is silent, which keeps a broken
   * latency scan from taking the counter snapshot down with it, but also makes a collector
   * that is failing every tick look exactly like an idle board. Supply this to tell the two
   * apart. Errors thrown by the hook itself are ignored, since a throwing reporter would
   * undo the containment it was added to observe.
   */
  onError?: (error: unknown, queueName: string) => void;
}

/**
 * Copies job durations out of a queue's finished jobs on the recorder's tick.
 *
 * Both backends index finished jobs by finish time (Redis: the completed and failed sorted
 * sets; PostgreSQL: `job_finished_idx`), so scanning past a stored watermark returns exactly
 * the jobs finished since the last tick, with no gaps and no bias. The only loss is a queue
 * whose removeOnComplete trims faster than the tick runs.
 *
 * Where the durations are read from (a `JobSource`) and where they are written to (a
 * `LatencyStorage`) are independent: the watermark, margin, lease and subsampling logic
 * here is the same for every combination.
 */
export class LatencySampler {
  private readonly redis: MetricsClient | undefined;
  private readonly store: LatencyStorage;
  private readonly tickMs: number;
  private readonly maxSamples: number;
  private readonly safetyMarginMs: number;
  private readonly onError?: (error: unknown, queueName: string) => void;
  private readonly id = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  private readonly sources = new Map<string, JobSource | null>();

  constructor(opts: LatencySamplerOptions) {
    this.redis = opts.redis;
    this.store = opts.store;
    this.tickMs = opts.tickMs;
    this.maxSamples = opts.maxSamplesPerTick ?? DEFAULT_MAX_SAMPLES;
    this.safetyMarginMs = opts.safetyMarginMs ?? SAFETY_MARGIN_MS;
    this.onError = opts.onError;
  }

  static supports(adapter: BaseAdapter): boolean {
    return typeof (adapter as Partial<AdapterWithKeys>).getQueueKey === 'function';
  }

  /**
   * One queue, one tick. Swallows its own errors: the counter snapshot is the more
   * important metric and must not fail as collateral damage from a latency scan. Pass
   * `onError` to see what was swallowed; without it a collector failing every tick is
   * indistinguishable from a queue with nothing to sample.
   */
  async sample(adapter: BaseAdapter): Promise<void> {
    if (!LatencySampler.supports(adapter)) {
      return;
    }
    const name = adapter.getName();
    try {
      const source = await this.sourceFor(adapter as AdapterWithKeys, name);
      if (!source) {
        return;
      }
      await this.sampleLeased(name, source);
    } catch (error) {
      this.report(error, name);
    }
  }

  /**
   * The same tick for a queue that is not an adapter, whose `JobSource` the caller already
   * holds (a `CounterSource`'s). `rollup` names the cross-queue series, `__global__` if omitted.
   * Swallows its errors exactly like `sample`.
   */
  async sampleSource(name: string, source: JobSource | null, rollup?: string): Promise<void> {
    if (!source) {
      return;
    }
    try {
      await this.sampleLeased(name, source, rollup);
    } catch (error) {
      this.report(error, name);
    }
  }

  private async sampleLeased(name: string, source: JobSource, rollup?: string): Promise<void> {
    if (!(await this.store.acquireLease(name, this.id, this.tickMs * 2))) {
      return;
    }
    try {
      await this.sampleDurations(source, name, rollup);
      await this.sampleQueueAge(source, name, rollup);
    } finally {
      await this.store.releaseLease(name, this.id);
    }
  }

  /** Intentionally swallowed, see `sample`. */
  private report(error: unknown, name: string): void {
    try {
      this.onError?.(error, name);
    } catch {
      // A reporter that throws must not resurrect the failure this catch contains.
    }
  }

  /**
   * PostgreSQL first, because `getQueueKey` answers for a PostgreSQL-backed queue too, with
   * keys no Redis holds: reading those would record a reassuring zero backlog forever. A Redis
   * source is only used once the adapter confirms it really sits on Redis. Cached per queue,
   * since a queue does not change datastores while the board runs.
   */
  private async sourceFor(adapter: AdapterWithKeys, name: string): Promise<JobSource | null> {
    if (this.sources.has(name)) {
      return this.sources.get(name) ?? null;
    }
    let source: JobSource | null = postgresSourceOf(adapter);
    if (!source && (await adapter.getRedisInfo()) !== null) {
      const client =
        this.redis ?? (typeof adapter.getClient === 'function' ? await adapter.getClient() : null);
      source = client ? new RedisJobSource(client, adapter) : null;
    }
    this.sources.set(name, source);
    return source;
  }

  /**
   * Bounded rather than eternal: an unexpiring watermark would leave one entry behind per
   * queue forever once that queue is purged or decommissioned, which is exactly the
   * unbounded-storage failure this package exists to avoid. The day retention is already the
   * horizon everything else here is bounded by. Losing the watermark just means the next
   * tick cold starts, which is already a supported path.
   */
  private watermarkTtlSeconds(): number {
    return Math.max(1, Math.floor(this.store.retention.days * SECONDS_PER_DAY));
  }

  private async sampleDurations(source: JobSource, name: string, rollup?: string): Promise<void> {
    const stored = await this.store.readWatermark(name);
    // Cold start covers one tick ending at the safety bound rather than backfilling, since a
    // first run against a large completed set would be a surprise fetch storm. Ending at the
    // bound rather than at now is what keeps a tick shorter than the margin from producing a
    // window that is empty on every tick, leaving the watermark stuck forever.
    const watermark = stored ?? Date.now() - this.tickMs - this.safetyMarginMs;

    const upperBound = Date.now() - this.safetyMarginMs;
    if (upperBound <= watermark) {
      return; // ticks closer together than the margin; next tick covers this range
    }

    const { total, sampled, jobs } = await source.finishedJobs(
      watermark,
      upperBound,
      this.maxSamples
    );
    if (total === 0) {
      await this.store.writeWatermark(name, upperBound, this.watermarkTtlSeconds());
      return;
    }

    // Counts are scaled back up by this ratio, so a subsampled hour reads as an estimate
    // with the same shape rather than a dip. The fact that it was subsampled is currently
    // invisible to clients: marking it would mean persisting a flag alongside the packed
    // vector, which is a storage-format change. Known follow-up.
    const ratio = total / Math.max(1, sampled);

    const runByHour = new Map<number, number[]>();
    const waitByHour = new Map<number, number[]>();

    for (const job of jobs) {
      const hour = Math.floor(job.finishedOn / MS_PER_HOUR);

      observe(runByHour, hour, job.finishedOn - job.processedOn, ratio);

      // A retried job's timestamp is its creation, but processedOn is the latest attempt,
      // so wait would absorb every prior attempt and backoff. Run time is unaffected.
      if (job.timestamp !== null && job.attempts <= 1) {
        // Every one of these is a Date.now() taken in some client process, not a datastore
        // clock: timestamp in the producer, processedOn in the worker. Skew between the two
        // can make the difference negative, hence the clamp.
        observe(waitByHour, hour, Math.max(0, job.processedOn - job.timestamp), ratio);
      }
    }

    await this.flush(name, 'runtime', runByHour, rollup);
    await this.flush(name, 'waittime', waitByHour, rollup);
    // The bound, not the highest score observed. See SAFETY_MARGIN_MS.
    await this.store.writeWatermark(name, upperBound, this.watermarkTtlSeconds());
  }

  private async flush(
    name: string,
    metric: LatencyMetric,
    byHour: Map<number, number[]>,
    rollup?: string
  ): Promise<void> {
    for (const [hour, vector] of byHour) {
      // Scaled counts are fractional. Left unrounded, join(',') would write seventeen
      // significant digits per bucket and blow up the packed value the storage design
      // depends on staying small.
      await this.store.addSamples(
        name,
        metric,
        hour,
        vector.map((v) => Math.round(v)),
        rollup
      );
    }
  }

  /** A tick that could not read the backlog cleanly records nothing, see `JobSource`. */
  private async sampleQueueAge(source: JobSource, name: string, rollup?: string): Promise<void> {
    const hour = Math.floor(Date.now() / MS_PER_HOUR);
    const age = await source.oldestWaitingAge(Date.now());
    if (age === null) {
      return;
    }
    await this.store.recordQueueAge(name, hour, age, rollup);
  }
}

function observe(
  byHour: Map<number, number[]>,
  hour: number,
  durationMs: number,
  ratio: number
): void {
  let vector = byHour.get(hour);
  if (!vector) {
    vector = emptyVector();
    byHour.set(hour, vector);
  }
  vector[bucketIndex(durationMs)] += ratio;
}
