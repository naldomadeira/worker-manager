import type { BaseAdapter } from '@worker-manager/api/baseAdapter';
import { metricsToMinutePoints, type MinutePoint } from './dataMapping';
import type { JobSource } from './jobSources';

export type CounterMetric = 'completed' | 'failed';

/**
 * One queue as the recorder sees it: a name to record under, per-minute completed and failed
 * counts, and optionally where job timings are read from. A BullMQ or Bull adapter is one of
 * these through `adapterCounterSource`; an engine with no BullMQ-style metrics buffer (pg-boss)
 * provides its own.
 */
export interface CounterSource {
  /** What the history is recorded under, and what `MetricsHistoryQuery.queue` asks for. */
  readonly name: string;
  /**
   * The cross-queue series this queue's counts and latencies also roll up into. Defaults to
   * `__global__`. A source that shares a store with another board sets its own, so the two
   * boards' global charts stay apart; `namespacedHistoryProvider` reads it back.
   */
  readonly rollup?: string;
  /**
   * Finished minutes in `[fromMs, toMs)`, as absolute counts per minute, in any order. Only
   * minutes that can no longer change belong here: the recorder advances its watermark past
   * the newest minute returned and never asks for it again. `toMs` is the start of the
   * recorder's current minute; a source whose own clock or commit lag says a minute is still
   * open should stop earlier. A source that cannot read returns `[]`, and the recorder retries
   * the same range on the next tick.
   */
  readMinutes(metric: CounterMetric, fromMs: number, toMs: number): Promise<MinutePoint[]>;
  /** Where the latency sampler reads this queue's job timings, or `null` for no latency. */
  jobSource(): JobSource | null;
}

/** Either a fixed list, read once, or a function resolved on every tick. */
export type CounterSources = CounterSource[] | (() => CounterSource[] | Promise<CounterSource[]>);

const ADAPTER = Symbol('worker-manager.metrics.adapter');

interface AdapterCounterSource extends CounterSource {
  readonly [ADAPTER]: BaseAdapter;
}

/**
 * A queue adapter as a `CounterSource`: BullMQ's own per-minute buffer, exactly what the
 * recorder has always read. The buffer never holds the minute in progress, so the range is not
 * applied here; the recorder's watermark does the filtering, as it always has.
 *
 * `jobSource()` answers `null` because choosing between the Redis and the PostgreSQL reader
 * takes a round trip. The recorder hands an adapter source to the sampler whole, and the
 * sampler resolves and caches it the way it does for `queues`.
 */
export function adapterCounterSource(adapter: BaseAdapter): CounterSource {
  const source: AdapterCounterSource = {
    [ADAPTER]: adapter,
    get name() {
      return adapter.getName();
    },
    async readMinutes(metric) {
      return metricsToMinutePoints(await adapter.getMetrics(metric).catch(() => null));
    },
    jobSource: () => null,
  };
  return source;
}

/** The adapter behind a source made by `adapterCounterSource`, or `null`. */
export function adapterOf(source: CounterSource): BaseAdapter | null {
  return (source as Partial<AdapterCounterSource>)[ADAPTER] ?? null;
}
