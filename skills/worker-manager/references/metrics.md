# Historical metrics reference (beta)

Source of truth: <https://naldomadeira.github.io/worker-manager/recipes/historical-metrics>.

`@worker-manager/metrics` is opt-in and **beta** (API and storage layout may change in a minor; pin
an exact version if you depend on the format). Without it the board is stateless and the
throughput chart only reaches back as far as BullMQ's per-minute ring buffer.

Two pieces in two places:

- `MetricsRecorder` runs in an always-on process (usually the workers'). It snapshots per-minute
  completed/failed counts plus wait/run-time histograms and queue age. Idempotent, safe to run in
  several processes.
- A history provider (`RedisMetricsHistoryProvider` or `PostgresMetricsHistoryProvider`) is passed to
  the board as `options.historyProvider`. It adds the Metrics history page (cross-queue throughput,
  per-queue breakdown, daily activity calendar, latency, storage panel) and 7/30/90 day ranges on
  queue charts (those also need `uiConfig.showMetrics: true`).

## Precondition (BullMQ)

Workers must collect native metrics, with a window that survives recorder downtime:

```ts
new Worker(name, processor, { connection, metrics: { maxDataPoints: MetricsTime.ONE_WEEK } });
```

## Redis storage

```ts
import { MetricsRecorder, RedisMetricsHistoryProvider } from '@worker-manager/metrics';

const recorder = new MetricsRecorder({ queues: [new BullMQAdapter(queue)], connection, retentionDays: 90 });
recorder.start();

createWorkerManagerBoard({
  queues,
  serverAdapter,
  options: {
    uiConfig: { showMetrics: true },
    historyProvider: new RedisMetricsHistoryProvider({ connection }),
  },
});
// shutdown: recorder.stop(); provider.disconnect()
```

`connection` is ioredis options or a `Redis`/`Cluster` instance (ioredis v5 or v6 peer). Keys live
under `worker-manager:metrics:`; `prefix` moves them and must match on recorder, provider and
`MetricsHistoryAdmin`. `queues` may be a function resolved every tick. Other recorder options:
`retention: { minutes, hours, days }`, `snapshotIntervalMs`, `latency: false`,
`onSnapshotError`, `onLatencyError`. Data from bull-board 1.x: `prefix: 'bull-board:metrics'`.

## PostgreSQL storage (`pg` optional peer)

```ts
import { MetricsRecorder, PostgresMetricsHistoryProvider, PostgresMetricsStore } from '@worker-manager/metrics';

const store = new PostgresMetricsStore({ connection: process.env.DATABASE_URL, schema: 'bullmq', migrate: true });
const recorder = new MetricsRecorder({ queues, store, retentionDays: 90 });
recorder.start();

createWorkerManagerBoard({
  queues,
  serverAdapter,
  options: {
    uiConfig: { showMetrics: true },
    historyProvider: new PostgresMetricsHistoryProvider({ store, retentionDays: 90 }),
  },
});
// shutdown: recorder.stop(); await store.close()
```

Tables `worker_manager_metrics_*` (`tablePrefix`). Without DDL rights, migrate from a deploy step
with `migratePostgresMetrics({ connection, schema })`. Where queues live and where history is
stored are independent.

## pg-boss queues

```ts
import { createPgBossBoard, pgBossMetricsSources } from '@worker-manager/pg-boss';
import {
  MetricsRecorder,
  namespacedHistoryProvider,
  PostgresMetricsHistoryProvider,
  PostgresMetricsStore,
} from '@worker-manager/metrics';

const store = new PostgresMetricsStore({ connection: pool, migrate: true });
const provider = new PostgresMetricsHistoryProvider({ store });
const board = createPgBossBoard({
  serverAdapter,
  pgBoss: { instance: boss, connection: pool, schema: 'pgboss' },
  options: { uiConfig: { showMetrics: true }, historyProvider: namespacedHistoryProvider(provider, 'pgboss:pgboss:') },
});
const recorder = new MetricsRecorder({ store, sources: pgBossMetricsSources(board.engine) });
recorder.start();
```

Needs the index `CREATE INDEX wm_job_completed_on ON pgboss.job (name, completed_on);`
(`pgBossMetricsIndexDdl(schema)`); without it that queue's counters stay off and `onWarning` says so.
History reaches back only as far as pg-boss keeps finished jobs (`deleteAfterSeconds`).
`pgBossMetricsNamespace(schema)` gives the `pgboss:<schema>:` prefix that lets a BullMQ and a
pg-boss board share one store; one recorder can take `{ store, queues, sources }` for both.

## Admin and CLI

`new MetricsHistoryAdmin({ connection })` or `({ store })`: `stats()`, `purge()`,
`purge({ queue })`, `purge({ before: 'YYYY-MM-DD' })`. The CLI and Docker image bundle the package:
`--history` (and `--history-retention-days`) registers the provider and records in-process;
`--read-only` keeps the provider and drops the recorder.
