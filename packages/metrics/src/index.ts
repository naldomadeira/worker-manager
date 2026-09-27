// The stable, semver-covered surface. Low-level building blocks live in `./internal`
// (`@worker-manager/metrics/internal`), which carries no semver guarantee.
export { MetricsHistoryAdmin } from './HistoryAdmin';
export type {
  HistoryQueueStats,
  HistoryStats,
  HistoryTier,
  MetricsHistoryAdminOptions,
  PurgeOptions,
  PurgeResult,
  TierStats,
} from './HistoryAdmin';
export { MetricsRecorder } from './MetricsRecorder';
export type { MetricsRecorderOptions } from './MetricsRecorder';
export { namespacedHistoryProvider } from './namespacedHistoryProvider';
export type { MetricsStore, Retention } from './store';
export { RedisMetricsStore } from './RedisMetricsStore';
export type { RedisMetricsStoreOptions } from './RedisMetricsStore';
export { REDIS_LAYOUT_VERSION as REDIS_METRICS_LAYOUT_VERSION } from './layout';
export { RedisMetricsHistoryProvider } from './RedisMetricsHistoryProvider';
export type { RedisMetricsHistoryProviderOptions } from './RedisMetricsHistoryProvider';
export { PostgresMetricsStore, migratePostgresMetrics } from './postgres/PostgresMetricsStore';
export type {
  MigratePostgresMetricsOptions,
  PostgresMetricsStoreOptions,
} from './postgres/PostgresMetricsStore';
export { PostgresMetricsHistoryProvider } from './postgres/PostgresMetricsHistoryProvider';
export type { PostgresMetricsHistoryProviderOptions } from './postgres/PostgresMetricsHistoryProvider';
export type { PgPool, PostgresConnection, PostgresPoolConfig } from './postgres/connection';
export { SCHEMA_VERSION as POSTGRES_METRICS_SCHEMA_VERSION } from './postgres/schema';
