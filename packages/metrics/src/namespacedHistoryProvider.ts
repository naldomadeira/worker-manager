import type {
  MetricsHistoryProvider,
  MetricsHistoryPurgeOptions,
  MetricsHistoryUsage,
} from '@worker-manager/api/typings/app';
import type { HistoryTier, TierStats } from './HistoryAdmin';
import { GLOBAL_QUEUE } from './keys';
import { StoreHistoryProvider } from './StoreHistoryProvider';

/** The rollup a `CounterSource` recording under `prefix` writes into, e.g. `pgboss:app:__global__`. */
export function namespacedRollup(prefix: string): string {
  return `${prefix}${GLOBAL_QUEUE}`;
}

function emptyTiers(): Record<HistoryTier, TierStats> {
  return {
    minute: { keys: 0, bytes: 0 },
    hour: { keys: 0, bytes: 0 },
    day: { keys: 0, bytes: 0 },
  };
}

/**
 * One board's view of a store that several boards record into. Every queue the board asks for
 * is read as `prefix + queue`, and the cross-queue chart as `prefix + '__global__'`, which is
 * the rollup a `CounterSource` recording under the same prefix writes (see
 * `CounterSource.rollup`). A pg-boss board and a BullMQ board can then share one
 * `PostgresMetricsStore` without either one's global chart counting the other's jobs:
 *
 * ```ts
 * const provider = new PostgresMetricsHistoryProvider({ store });
 * createWorkerManagerBoard({ queues, serverAdapter, options: { historyProvider: provider } });
 * createPgBossBoard({
 *   serverAdapter: pgBossAdapter,
 *   pgBoss: { connection, schema: 'pgboss' },
 *   options: { historyProvider: namespacedHistoryProvider(provider, pgBossMetricsNamespace('pgboss')) },
 * });
 * ```
 *
 * The storage panel lists only the namespace's queues, without the prefix. Purging is offered
 * only over this package's own providers, whose purge understands a namespace: a single queue
 * is subtracted from the namespace's rollup, and "clear all" stays inside the namespace. A
 * third-party provider would treat the same call as a purge of everything, so it gets none.
 *
 * The un-namespaced board sharing the store still sees everything in its storage panel,
 * pg-boss queues included, and its "clear all" clears those too.
 */
export function namespacedHistoryProvider(
  provider: MetricsHistoryProvider,
  prefix: string
): MetricsHistoryProvider {
  if (!prefix) {
    throw new Error('namespacedHistoryProvider needs a non-empty prefix.');
  }
  const rollup = namespacedRollup(prefix);
  const scoped = (queue: string | undefined) =>
    queue === undefined || queue === GLOBAL_QUEUE ? rollup : `${prefix}${queue}`;

  const namespaced: MetricsHistoryProvider = {
    getHistory: (query) => provider.getHistory({ ...query, queue: scoped(query.queue) }),
  };

  if (provider.getLatency) {
    const getLatency = provider.getLatency.bind(provider);
    namespaced.getLatency = (query) => getLatency({ ...query, queue: scoped(query.queue) });
  }

  if (provider.getUsage) {
    const getUsage = provider.getUsage.bind(provider);
    namespaced.getUsage = async () => narrowUsage(await getUsage(), prefix);
  }

  if (provider instanceof StoreHistoryProvider) {
    namespaced.purge = (options: MetricsHistoryPurgeOptions) =>
      provider.purge(
        options.queue === undefined
          ? { before: options.before, queuePrefix: prefix }
          : { before: options.before, queue: scoped(options.queue), rollup }
      );
  }

  return namespaced;
}

/** The namespace's share of a store-wide report, re-totalled, with the prefix taken off. */
function narrowUsage(usage: MetricsHistoryUsage, prefix: string): MetricsHistoryUsage {
  const queues = usage.queues
    .filter((queue) => queue.queue.startsWith(prefix))
    .map((queue) => ({ ...queue, queue: queue.queue.slice(prefix.length) }));

  const tiers = emptyTiers();
  let keys = 0;
  let bytes = 0;
  let minutes = 0;
  let oldestDay: string | null = null;
  let newestDay: string | null = null;
  for (const queue of queues) {
    keys += queue.keys;
    bytes += queue.bytes;
    minutes += queue.minutes;
    for (const tier of Object.keys(tiers) as HistoryTier[]) {
      tiers[tier].keys += queue.tiers[tier].keys;
      tiers[tier].bytes += queue.tiers[tier].bytes;
    }
    for (const day of queue.days) {
      if (oldestDay === null || day < oldestDay) oldestDay = day;
      if (newestDay === null || day > newestDay) newestDay = day;
    }
  }
  return { ...usage, keys, bytes, minutes, oldestDay, newestDay, tiers, queues };
}
