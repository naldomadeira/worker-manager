import type { MetricsConnection } from './connection';
import { RedisMetricsStore } from './RedisMetricsStore';
import type { HistoryAdministration, MetricsStore } from './store';

export { parseHistoryKey } from './RedisHistoryAdmin';

export interface TierStats {
  keys: number;
  /**
   * Redis: sum of `MEMORY USAGE` over this tier's keys. PostgreSQL: this tier's share of the
   * tables' on-disk size. In bytes either way.
   */
  bytes: number;
}

export interface HistoryQueueStats {
  /** Queue name, or `__global__` for the cross-queue rollup. */
  queue: string;
  keys: number;
  bytes: number;
  /** Recorded minute buckets, the tier that drives storage size. */
  minutes: number;
  /** Days covered by a minute or hour hash, ascending. */
  days: string[];
  /** Where this queue's bytes actually sit, so a footprint can be diagnosed. */
  tiers: Record<HistoryTier, TierStats>;
}

export interface HistoryStats {
  keys: number;
  bytes: number;
  minutes: number;
  oldestDay: string | null;
  newestDay: string | null;
  tiers: Record<HistoryTier, TierStats>;
  queues: HistoryQueueStats[];
}

export interface PurgeOptions {
  /** Limit the purge to one queue. Omit to purge every queue plus the global rollup. */
  queue?: string;
  /** Only drop days strictly before this date (UTC). Omit to drop everything in scope. */
  before?: Date | string;
  /**
   * The cross-queue series a single-queue purge subtracts the queue's counts from. Defaults to
   * `__global__`; a queue recorded from a `CounterSource` with its own `rollup` (a pg-boss
   * queue) names that rollup here, so purging it does not drain another board's totals.
   */
  rollup?: string;
  /**
   * Limit the purge to queues whose recorded name starts with this, the rollup included. What
   * `namespacedHistoryProvider` uses so a board's "clear all" stays inside its namespace.
   */
  queuePrefix?: string;
}

export interface PurgeResult {
  keysDeleted: number;
  /** Day fields removed from totals hashes. */
  fieldsDeleted: number;
}

export type MetricsHistoryAdminOptions =
  | {
      /** Redis. Shorthand for `store: new RedisMetricsStore({ connection, prefix })`. */
      connection: MetricsConnection;
      /** Must match the recorder's. See `MetricsRecorderOptions.prefix`. */
      prefix?: string;
      store?: never;
    }
  | {
      /** Where the history lives, e.g. a `PostgresMetricsStore`. Left open on `disconnect()`. */
      store: MetricsStore;
      connection?: never;
      prefix?: never;
    };

export type HistoryTier = 'minute' | 'hour' | 'day';

/**
 * Inspection and cleanup for the history written by `MetricsRecorder`, in whichever store it
 * lives. See `RedisHistoryAdmin` and `PostgresHistoryAdmin` for what each one measures.
 */
export class MetricsHistoryAdmin implements HistoryAdministration {
  private readonly admin: HistoryAdministration;
  /** Set only when this admin built the store itself, from a `connection`. */
  private readonly ownedStore: MetricsStore | null;

  constructor(opts: MetricsHistoryAdminOptions) {
    if (opts.store) {
      this.admin = opts.store.administration();
      this.ownedStore = null;
    } else {
      const store = new RedisMetricsStore({ connection: opts.connection, prefix: opts.prefix });
      this.admin = store.administration();
      this.ownedStore = store;
    }
  }

  /** Closes the Redis connection this admin opened itself. A connection handed in is left open. */
  disconnect(): void {
    void this.ownedStore?.close();
  }

  stats(): Promise<HistoryStats> {
    return this.admin.stats();
  }

  purge(opts: PurgeOptions = {}): Promise<PurgeResult> {
    return this.admin.purge(opts);
  }
}
