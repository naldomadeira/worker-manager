import type { MetricsConnection } from './connection';
import { resolveRetention } from './MetricsRecorder';
import { RedisMetricsStore } from './RedisMetricsStore';
import type { Retention } from './store';
import { StoreHistoryProvider } from './StoreHistoryProvider';

export interface RedisMetricsHistoryProviderOptions {
  connection: MetricsConnection;
  /** Must match the recorder's. See `MetricsRecorderOptions.prefix`. */
  prefix?: string;
  /** Should mirror the recorder's retention. Only used to bound the query span. */
  retention?: Partial<Retention>;
  retentionDays?: number;
}

/** Serves the board's history charts and storage panel from the Redis store. */
export class RedisMetricsHistoryProvider extends StoreHistoryProvider {
  private readonly ownedStore: RedisMetricsStore;

  constructor(opts: RedisMetricsHistoryProviderOptions) {
    const store = new RedisMetricsStore({ connection: opts.connection, prefix: opts.prefix });
    super(store, resolveRetention(opts));
    this.ownedStore = store;
  }

  /** Closes the Redis connection this provider opened itself. A client handed in is left open. */
  disconnect(): void {
    void this.ownedStore.close();
  }
}
