import { isCluster, resolveClient, type MetricsClient, type MetricsConnection } from './connection';
import { HistoryStore } from './HistoryStore';
import { metricsKeys, resolveNamespace, type MetricsKeys } from './keys';
import { LatencyStore } from './LatencyStore';
import { assertLayoutKnown, claimLayout, NewerRedisLayoutError } from './layout';
import { RedisHistoryAdmin } from './RedisHistoryAdmin';
import type {
  CounterStore,
  HistoryAdministration,
  LatencyStorage,
  MetricsStore,
  Retention,
} from './store';

export interface RedisMetricsStoreOptions {
  /** An ioredis client (or Cluster), or options to open one. */
  connection: MetricsConnection;
  /** Key namespace. See `MetricsRecorderOptions.prefix`. */
  prefix?: string;
}

/**
 * History in Redis: hashes under one key namespace, expired by TTL. The default store,
 * which `connection` on the recorder, provider and admin is shorthand for.
 *
 * The namespace records the storage layout it was written in (`REDIS_METRICS_LAYOUT_VERSION`,
 * in `<namespace>:__meta__`). The first write claims a namespace that has no marker, which
 * covers data from before the marker existed, since that is layout 1. Writes and purges into
 * a namespace a newer build claimed are refused; reads are served regardless.
 */
export class RedisMetricsStore implements MetricsStore {
  readonly redis: MetricsClient;
  readonly keys: MetricsKeys;
  /** Whether `redis` was opened here from options, and so is closed by `close()`. */
  readonly ownsClient: boolean;
  private closed = false;
  private layoutReady: Promise<void> | null = null;

  constructor(opts: RedisMetricsStoreOptions) {
    const { client, owned } = resolveClient(opts.connection);
    this.redis = client;
    this.ownsClient = owned;
    this.keys = metricsKeys(resolveNamespace(opts.prefix, isCluster(client)));
  }

  get jobClient(): MetricsClient {
    return this.redis;
  }

  /**
   * @internal
   * Claims the layout marker once. Memoized, including a newer-layout refusal, which only an
   * upgrade can clear; any other failure (Redis unreachable) is retried on the next write.
   */
  prepareWrites(): Promise<void> {
    if (!this.layoutReady) {
      this.layoutReady = claimLayout(this.redis, this.keys).catch((error) => {
        if (!(error instanceof NewerRedisLayoutError)) {
          this.layoutReady = null;
        }
        throw error;
      });
    }
    return this.layoutReady;
  }

  counterStore(retention: Retention): CounterStore {
    return new HistoryStore({
      redis: this.redis,
      keys: this.keys,
      retention,
      ready: () => this.prepareWrites(),
    });
  }

  latencyStore(retention: Retention): LatencyStorage {
    return new LatencyStore({
      redis: this.redis,
      keys: this.keys,
      retention,
      ready: () => this.prepareWrites(),
    });
  }

  administration(): HistoryAdministration {
    return new RedisHistoryAdmin({
      redis: this.redis,
      keys: this.keys,
      beforePurge: () => assertLayoutKnown(this.redis, this.keys),
    });
  }

  /** Disconnects a client this store opened; synchronous in effect, like `redis.disconnect()`. */
  async close(): Promise<void> {
    if (this.ownsClient && !this.closed) {
      this.redis.disconnect();
    }
    this.closed = true;
  }
}
