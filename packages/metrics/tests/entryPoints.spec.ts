import * as main from '../src/index';
import * as internal from '../src/internal';

// The main entry is the semver-covered surface; anything added to it is a promise. The
// `/internal` entry is for Worker Manager's own packages and carries no guarantee.
describe('entry points', () => {
  it('keeps the main entry to the stable, user-facing surface', () => {
    expect(Object.keys(main).sort()).toEqual([
      'MetricsHistoryAdmin',
      'MetricsRecorder',
      'POSTGRES_METRICS_SCHEMA_VERSION',
      'PostgresMetricsHistoryProvider',
      'PostgresMetricsStore',
      'RedisMetricsHistoryProvider',
      'RedisMetricsStore',
      'migratePostgresMetrics',
      'namespacedHistoryProvider',
    ]);
  });

  it('carries the low-level pieces on /internal only', () => {
    expect(Object.keys(internal).sort()).toEqual([
      'BUCKET_BOUNDS',
      'BUCKET_COUNT',
      'LatencySampler',
      'LatencyStore',
      'QUEUE_AGE_METRIC',
      'adapterCounterSource',
      'namespacedRollup',
      'quantile',
    ]);
  });
});
