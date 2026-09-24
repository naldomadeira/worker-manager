# @worker-manager/metrics

> Status: Beta. The API and the Redis and PostgreSQL storage layouts may still change in a minor release while the feature settles. It is safe to run (opt-in, and it only writes its own namespaced keys), but pin an exact version if you depend on the storage format.

Opt-in long-retention historical job metrics for [Worker Manager](https://github.com/naldomadeira/worker-manager).

Snapshots native BullMQ per-minute metrics into long-retention buckets, in Redis or in
PostgreSQL (see [PostgreSQL storage](#postgresql-storage)), and exposes a
`MetricsHistoryProvider` that feeds Worker Manager's history charts. Everything is opt-in: the core
`@worker-manager/api` stays stateless.

## Precondition

Your BullMQ workers must have native metrics enabled, with a window large enough to survive any
recorder downtime, for example:

    new Worker(name, processor, {
      connection,
      metrics: { maxDataPoints: MetricsTime.ONE_WEEK },
    });

## Usage

    import { MetricsRecorder, RedisMetricsHistoryProvider } from '@worker-manager/metrics';

    // In your always-on worker/app process:
    const recorder = new MetricsRecorder({
      queues: [new BullMQAdapter(queue)],
      connection,
      retentionDays: 90,
    });
    recorder.start();

    // Where you build the board:
    createWorkerManagerBoard({
      queues,
      serverAdapter,
      options: { historyProvider: new RedisMetricsHistoryProvider({ connection }) },
    });

`queues` also accepts a function, resolved on every tick instead of once, which is what you want when the queue set changes while the recorder runs.

Not embedding Worker Manager in an app of your own? This package ships inside [`@worker-manager/cli`](https://www.npmjs.com/package/@worker-manager/cli) and the `ghcr.io/naldomadeira/worker-manager` image, where `--history` registers the provider and starts a recorder in the same process. See the [CLI guide](https://naldomadeira.github.io/worker-manager/guide/cli#historical-metrics).

On shutdown, call `recorder.stop()` and `provider.disconnect()`. Both only close the Redis connection if the recorder/provider opened it internally, so it's a safe no-op if you passed in your own `Redis` instance.

`connection` may be ioredis options, or a `Redis` or `Cluster` instance you created. `ioredis` is a peer dependency (v5 or v6): resolve a single copy in your app, and if you reuse an existing client, pass one built from that same `ioredis`. A client from a different install (for example one created internally by a BullMQ pinned to a different ioredis major) is not recognized as a client and would be misread as options.

Timestamps and buckets are UTC.

## Key namespace

Every key the recorder writes lives under `worker-manager:metrics:`. Pass `prefix` to move it, which is how two boards share one Redis without their histories running together:

    const recorder = new MetricsRecorder({ queues, connection, prefix: 'staging:metrics' });
    const provider = new RedisMetricsHistoryProvider({ connection, prefix: 'staging:metrics' });

The provider, the recorder and any `MetricsHistoryAdmin` must all be given the same prefix. A provider reading a namespace nothing writes to reports empty history rather than an error, the same way a mismatched retention quietly shortens the window.

Before v2.0 the default namespace was `bull-board:metrics` (`{bull-board:metrics}` on a cluster). Nothing is migrated, so to keep reading history recorded by a 1.x board pass `prefix: 'bull-board:metrics'` to the recorder, the provider and any admin.

## Redis Cluster

Pass a `Cluster` as `connection` and it works, with one thing worth knowing about the key layout.

Each snapshot writes a queue's three tiers and the three `__global__` rollup tiers in a single `EVAL`, which is what makes the write idempotent across all resolutions at once. Redis Cluster rejects a multi-key command whose keys land in different slots, so the whole namespace has to hash to one slot. It is given a [hash tag](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/#hash-tags) for that: `worker-manager:metrics` becomes `{worker-manager:metrics}`, and a `prefix` of your own is wrapped the same way unless it already carries a `{...}` tag, in which case yours is used and you choose the slot.

One slot means one master holds the history for the whole board. That is the trade for keeping the rollup consistent on write rather than recomputing it on read, and the volume is the same as the storage section below: roughly 50 MB at 200 busy queues, and one `EVAL` per queue per metric per minute.

Standalone keys are untagged and unchanged, so nothing moves for an existing deployment. Nothing carries over from a standalone Redis to a cluster, since the key names differ.

Latency sampling reads BullMQ's own keys through the same connection, so your queues need the hash-tagged prefix BullMQ already asks for in cluster mode (`new Queue(name, { prefix: '{bull}' })`). Without it the sampler's pipelines span slots; it swallows that error, so pass `onLatencyError` to see it.

The CLI and the Docker image reach a cluster with `--cluster`, where `--history` works the same way.

## Job latency

Alongside the completed/failed counters, the recorder tracks two histograms per queue: wait time (`processedOn - timestamp`, how long a job sat before a worker picked it up) and run time (`finishedOn - processedOn`, how long the handler took). They diagnose different problems, so they're kept separate rather than combined into one number.

Both are collected by scanning the completed and failed sorted sets (BullMQ scores them by finish time via `moveToFinished`'s `ZADD`), or the `job` table of a PostgreSQL-backed queue, past a watermark on the recorder's existing tick, so no worker changes are needed and there's no precondition on `queue.getMetrics()`.

The wait histogram only sees jobs that finished, so it goes quiet exactly when a queue is backed up and jobs stop finishing. A queue-age gauge (oldest job still waiting) is recorded alongside it for that reason, and the UI overlays it on the wait chart. Retries are excluded from wait time only, since `timestamp` is a job's creation but `processedOn` is its latest attempt. Percentiles are estimates bounded by bucket width; the bucket layout is fixed, not configurable, because two ranges with different layouts can't be merged into one percentile.

`removeOnComplete: true` deletes jobs the instant they finish, so there's nothing left to scan; that queue will never show latency data. Deleting, cleaning, or retrying jobs by hand does the same to whatever finished since the last tick. The counter charts are unaffected, since BullMQ counts a job as it finishes and never decrements when it is removed. Latency sampling is on by default; set `latency: false` on `MetricsRecorder` to turn it off.

## PostgreSQL-backed queues

A BullMQ 6 queue backed by PostgreSQL is recorded like any other. Its counters come from `getMetrics()`, whose per-minute buffer the adapter anchors from BullMQ's `metrics` table (BullMQ's own PostgreSQL `getMetrics()` reports `prevTS` as 0). Latency and queue age are read from BullMQ's `job` table through the queue's own pool: finished jobs by `(queue, state, finished_at_ms)`, which BullMQ indexes, and the backlog from three index probes on the ready index rather than a scan. Paused and prioritized jobs are ordinary `waiting` rows there, so both count towards the backlog, as they do on Redis.

Where a queue lives and where its history is stored are independent: PostgreSQL queues can record into Redis next to Redis queues, and the reverse works too. A board with no Redis at all stores its history in PostgreSQL, below.

## PostgreSQL storage

For deployments that run BullMQ 6 entirely on PostgreSQL, the history can live there too. Same tiers, retention, `__global__` rollup, latency histograms and queue-age gauge as the Redis store, behind the same `MetricsHistoryProvider` contract, so the board, its charts and its storage panel cannot tell the two apart.

`pg` is an optional peer dependency: install it (`npm install pg`) only for this. Redis-only installs never load it.

    import {
      MetricsRecorder,
      PostgresMetricsHistoryProvider,
      PostgresMetricsStore,
    } from '@worker-manager/metrics';

    const store = new PostgresMetricsStore({
      connection: process.env.DATABASE_URL, // or a pg.Pool, or a pool config
      schema: 'bullmq',                      // default: `schema` of a pool config, then `public`
      migrate: true,                         // create or upgrade the tables on first use
    });

    const recorder = new MetricsRecorder({ queues, store, retentionDays: 90 });
    recorder.start();

    createWorkerManagerBoard({
      queues,
      serverAdapter,
      options: { historyProvider: new PostgresMetricsHistoryProvider({ store, retentionDays: 90 }) },
    });

    // On shutdown: recorder.stop(), then await store.close().

`connection` takes what BullMQ's PostgreSQL backend takes: a `pg.Pool` (left open by `close()`), a node-postgres pool config, or a connection string (both of which get a pool that `close()` ends). A `schema` key in a pool config is honoured, so the object you hand BullMQ can be reused as is. The provider also accepts `{ connection, schema, tablePrefix, migrate }` directly and then owns its store (`await provider.disconnect()`). `MetricsHistoryAdmin` takes `{ store }` the same way.

A store only writes; the queues it records are whatever the recorder is given, on any datastore. Pass `onSnapshotError` to the recorder to see a tick that failed because the database was unreachable; the next tick retries.

### Schema and migrations

Four tables, named `<tablePrefix><name>` (`tablePrefix` defaults to `worker_manager_metrics_`) in `schema`:

Before v2.0 the default was `bull_board_metrics_`. The tables are not renamed for you: pass `tablePrefix: 'bull_board_metrics_'` to keep using the history a 1.x board recorded.

| Table | Key | Holds |
| --- | --- | --- |
| `counters` | `(queue, metric, tier, bucket)` | completed/failed sums at minute, hour and day resolution; the queue-age max at hour and day |
| `histograms` | `(queue, metric, tier, bucket)` | runtime/waittime bucket counts, a `bigint[]` of the 18 fixed bounds, at hour and day |
| `sampler_state` | `(queue, kind)` | the sampler's lease and finish-time watermark, with an expiry |
| `meta` | `name` | `schema_version` |

`bucket` is an absolute minute, hour or day index since the epoch, UTC; `queue = '__global__'` is the cross-queue rollup. `counters` and `histograms` carry a `(tier, bucket)` index for retention.

`migrate: true` creates the schema (only when it is missing, so no database-level `CREATE` privilege is needed when it exists) and the tables on first use, in one transaction behind an advisory lock, so several processes can start at once. Without it the first query checks `schema_version` and fails with instructions if the tables are missing. Where the application role has no DDL rights, migrate from a deploy step instead:

    import { migratePostgresMetrics } from '@worker-manager/metrics';
    await migratePostgresMetrics({ connection: process.env.DATABASE_URL, schema: 'bullmq' });

Migrations are versioned and append-only; a database newer than the installed package is refused rather than written to. Two boards can share a database by `schema` or `tablePrefix`, the equivalent of the Redis `prefix`.

### Idempotency and concurrency

Each snapshot of a queue's metric is one transaction: a transaction-scoped advisory lock on (tables, queue, metric), then one statement that diffs the incoming minutes against the minute rows and applies only the differences to the hour and day rows of the queue and of `__global__` (`INSERT ... ON CONFLICT DO UPDATE SET value = value + delta`). Re-snapshotting an overlapping window after a restart, or from a second recorder, applies a delta of zero, exactly like the Redis `EVAL`. Histograms merge element-wise and the queue-age gauge keeps `GREATEST`, in one multi-row upsert each. The sampler's lease is an upsert that only overwrites an expired row, on the database clock, so two recorders never both scan a queue on the same tick.

### Retention

The same per-tier windows as Redis. Instead of TTLs, each writer deletes the rows older than each tier's window on its first write and then once per new UTC day, anchored on the day being written, which is how the Redis scripts trim the totals hashes. Expired sampler state goes at the same time. Deleted rows are reclaimed by autovacuum as usual.

### Sizing

Every bucket is its own row, so PostgreSQL costs more per bucket than a Redis hash field. Measured on PostgreSQL 17, including the primary key and retention indexes:

| Row | On disk |
| --- | --- |
| Minute or hour counter | ~180 bytes |
| Histogram (hour or day) | ~300 bytes |

For a queue busy every minute, that is ~250 KB per metric per day of minute detail, so at the default retention (7 days of minutes, 90 of hours and days) about 6.5 MB per busy queue across both counters, both histograms and the gauge, and the same again once for the `__global__` rollup. That is several times the Redis figure below; the minute window is still the one to tune. Idle minutes are never written, on either store.

`getUsage()` (the storage panel) reports `keys` as row counts, and `bytes` as the tables' real on-disk size (`pg_total_relation_size`: heap, TOAST and indexes) apportioned to queues and tiers by each row's `pg_column_size`, so the parts add up to what the tables occupy. Dead rows count until autovacuum reclaims them. `minutes`, `days` and the day range mean what they mean on Redis. `purge()` reports minute and hour rows as `keysDeleted` and day rows as `fieldsDeleted`.

## Storage

These are the Redis figures; see [Sizing](#sizing) for PostgreSQL.

Each snapshot is written at three resolutions at once, each with its own retention, because they cost very different amounts:

| Tier | Default retention | Size per busy day, per queue and metric |
| --- | --- | --- |
| Minute | 7 days | ~72 KB |
| Hour | 90 days | ~0.3 KB |
| Day | 90 days | ~15 bytes |

At the defaults that's roughly 1.1 MB for a queue busy every minute of every day across both metrics, and far less for a bursty one. Minutes with no activity are never written, so the footprint follows how busy a queue is, not how long it has been recording.

    const recorder = new MetricsRecorder({
      queues,
      connection,
      retention: { minutes: 7, hours: 90, days: 90 },
    });

The minute window is the one worth tuning: it holds essentially all the bytes, and it doubles as the recorder's catch-up window after downtime. `retentionDays: N` still works and sets the hourly and daily windows, leaving the minute window at its default.

Latency histograms and the queue-age gauge use a separate packed format and are measured separately, at 90 day retention:

| Scenario | Measured |
| --- | --- |
| One queue, both histograms plus the queue-age gauge, realistic distribution | 254.5 KB |
| Same, pathological: all 18 buckets populated heavily every hour | 574.6 KB |
| Shared `__global__` cross-queue rollup | ~224 KB once, for the whole board |

That rollup is a single shared cost, not multiplied per queue: 200 queues at typical traffic is roughly 200 × 254.5 KB, about 50 MB, plus the one shared 224 KB rollup. `sample()` takes about 9.11 ms per tick at 1000 finished jobs and about 12 Redis round trips per queue per tick, flat in job count; a subsampling cap above `maxLatencySamplesPerTick` keeps that bounded even at 10,000 jobs a tick.

Retention is enforced by Redis. Day-scoped keys expire on their own TTL; the daily totals hashes are trimmed to the window as each new day rolls in.

## Inspecting and clearing history

    import { MetricsHistoryAdmin } from '@worker-manager/metrics';

    const admin = new MetricsHistoryAdmin({ connection });        // add `prefix` if the recorder has one
    // or, for PostgreSQL storage: new MetricsHistoryAdmin({ store })

    await admin.stats();                          // bytes per tier and per queue, day range
    await admin.purge();                          // delete everything
    await admin.purge({ queue: 'mailer' });       // delete one queue
    await admin.purge({ before: '2026-06-01' });  // delete anything older than a day

On Redis both are `SCAN`-driven and confined to this package's namespace, so they never block Redis and never touch BullMQ's own keys. On a cluster they scan every master, since `SCAN` carries no key for the client to route by. Purging a single queue also subtracts it from the cross-queue rollup. Call `admin.disconnect()` when done.

`RedisMetricsHistoryProvider` and `PostgresMetricsHistoryProvider` expose the same two operations to the board, which turns them into a storage panel on the Metrics history page with a confirmation before anything is deleted.

## Scope

The shipped Worker Manager UI reads daily rollups. `getHistory` also supports hourly granularity for custom consumers (via the core's `/api/metrics/history` endpoint), though the built-in charts don't use it.
