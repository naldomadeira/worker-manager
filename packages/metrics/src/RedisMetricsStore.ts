import { isCluster, resolveClient, type MetricsClient, type MetricsConnection } from './connection';
import { HistoryStore } from './HistoryStore';
import { metricsKeys, resolveNamespace, type MetricsKeys } from './keys';
import { LatencyStore } from './LatencyStore';
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
 */
export class RedisMetricsStore implements MetricsStore {
  readonly redis: MetricsClient;
  readonly keys: MetricsKeys;
  /** Whether `redis` was opened here from options, and so is closed by `close()`. */
  readonly ownsClient: boolean;
  private closed = false;

  constructor(opts: RedisMetricsStoreOptions) {
    const { client, owned } = resolveClient(opts.connection);
    this.redis = client;
    this.ownsClient = owned;
    this.keys = metricsKeys(resolveNamespace(opts.prefix, isCluster(client)));
  }

  get jobClient(): MetricsClient {
    return this.redis;
  }

  counterStore(retention: Retention): CounterStore {
    return new HistoryStore({ redis: this.redis, keys: this.keys, retention });
  }

  latencyStore(retention: Retention): LatencyStorage {
    return new LatencyStore({ redis: this.redis, keys: this.keys, retention });
  }

  administration(): HistoryAdministration {
    return new RedisHistoryAdmin({ redis: this.redis, keys: this.keys });
  }

  /** Disconnects a client this store opened; synchronous in effect, like `redis.disconnect()`. */
  async close(): Promise<void> {
    if (this.ownsClient && !this.closed) {
      this.redis.disconnect();
    }
    this.closed = true;
  }
}
