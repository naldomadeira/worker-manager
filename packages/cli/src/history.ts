import type { BaseAdapter } from '@worker-manager/api/baseAdapter';
import type { MetricsHistoryProvider } from '@worker-manager/api/typings/app';
import {
  MetricsRecorder,
  PostgresMetricsHistoryProvider,
  PostgresMetricsStore,
  RedisMetricsHistoryProvider,
  type CounterSources,
  type MetricsStore,
} from '@worker-manager/metrics';
import type { HistoryConfig, PostgresConfig } from './config/types';
import { describeError } from './describeError';
import type { RedisClient } from './redisClient';

export interface HistoryRuntime {
  provider: MetricsHistoryProvider;
  /** Where the history is kept, for the startup log. */
  label: string;
  /** `sources` records queues that are not adapters, such as a pg-boss board's. */
  start(queues: () => BaseAdapter[], sources?: CounterSources): void;
  stop(): Promise<void>;
}

/**
 * Exactly one of the two. Next to Redis the history stays in Redis, as it always has; a
 * PostgreSQL-only board keeps it in PostgreSQL instead.
 */
export type HistoryBackend = { client: RedisClient } | { postgres: PostgresConfig };

export type HistoryDeps = HistoryBackend & {
  config: HistoryConfig;
  onWarning(message: string): void;
};

/**
 * The metrics tables go into BullMQ's own schema, under the package's table prefix. That is
 * the one schema the board's database role is already known to be able to create tables in,
 * which `public` no longer is by default since PostgreSQL 15.
 */
function createPostgresStore(
  postgres: PostgresConfig,
  config: HistoryConfig,
  onWarning: (message: string) => void
): PostgresMetricsStore {
  return new PostgresMetricsStore({
    connection: { ...postgres.connection, max: 2 },
    schema: postgres.schema,
    // A read-only board writes nothing, schema included: another process has to have recorded
    // (and so migrated) before it has anything to show.
    migrate: config.record,
    onError: (error) => onWarning(`History database error: ${describeError(error)}`),
  });
}

export function createHistory(deps: HistoryDeps): HistoryRuntime {
  const { config, onWarning } = deps;
  const shared = { retentionDays: config.retentionDays, retention: config.retention };

  let provider: MetricsHistoryProvider & { disconnect(): void | Promise<void> };
  let store: MetricsStore | null = null;
  let label: string;
  if ('client' in deps) {
    provider = new RedisMetricsHistoryProvider({
      connection: deps.client,
      prefix: config.prefix,
      ...shared,
    });
    label = 'Redis';
  } else {
    const pgStore = createPostgresStore(deps.postgres, config, onWarning);
    store = pgStore;
    provider = new PostgresMetricsHistoryProvider({ store: pgStore, ...shared });
    label = `PostgreSQL (schema ${pgStore.tables.schema}, tables ${pgStore.tables.prefix}*)`;
  }
  let recorder: MetricsRecorder | null = null;

  return {
    provider,
    label,
    start(queues, sources) {
      if (!config.record || recorder) return;

      const target =
        'client' in deps
          ? { connection: deps.client, prefix: config.prefix }
          : { store: store as MetricsStore };
      recorder = new MetricsRecorder({
        queues,
        ...(sources ? { sources } : {}),
        ...target,
        ...shared,
        latency: config.latency,
        snapshotIntervalMs: config.snapshotIntervalMs,
        onLatencyError: (error, queueName) =>
          onWarning(`Latency sampling failed for "${queueName}": ${describeError(error as Error)}`),
        onSnapshotError: (error) =>
          onWarning(`Recording history failed: ${describeError(error as Error)}`),
      });
      recorder.start();
    },
    async stop() {
      recorder?.stop();
      recorder = null;
      await provider.disconnect();
      await store?.close().catch(() => undefined);
    },
  };
}

export async function warnIfCountersUnavailable(
  queues: BaseAdapter[],
  onWarning: (message: string) => void
): Promise<void> {
  if (queues.length === 0) return;

  const populated = await Promise.all(
    queues.map((queue) =>
      queue
        .getMetrics('completed')
        .then((metrics) => (metrics?.data?.length ?? 0) > 0)
        .catch(() => false)
    )
  );
  if (populated.some(Boolean)) return;

  onWarning(
    'No BullMQ metrics data found on any queue. Completed and failed history stays empty ' +
      'until your workers are created with metrics: { maxDataPoints: MetricsTime.ONE_WEEK }. ' +
      'Latency and queue age are recorded either way.'
  );
}
