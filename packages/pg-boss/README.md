# @worker-manager/pg-boss

**Experimental.** A [pg-boss](https://github.com/timgit/pg-boss) engine for Worker Manager. It
mounts a whole board over one pg-boss schema, on any Worker Manager server adapter: its own
`/api/pg-boss/*` routes, the metrics history routes when a `historyProvider` is set, and the
dashboard entry page. A board runs one engine; it never mixes BullMQ and pg-boss queues.

The engine is experimental: its screens and the `/api/pg-boss` HTTP contract may still change in
a minor release, until it is declared stable. Full documentation:
<https://naldomadeira.github.io/worker-manager/queue-adapters/pg-boss>.

## Requirements

- Node.js 22.12 or later (pg-boss's own floor).
- pg-boss `^12.24.0`, on a database whose pg-boss schema version is between 35 (12.24.0) and 42
  (12.33.0 and 12.34.0). Schedule previews and RRULE schedules need pg-boss 12.31 or later.

## Install

```sh
npm install @worker-manager/pg-boss
```

`@worker-manager/api` is a peer. `pg-boss` is an optional peer: it is only loaded when the board
has no instance of yours, to write and to preview schedules.

## Usage

```ts
import { ExpressAdapter } from '@worker-manager/express';
import { createPgBossBoard } from '@worker-manager/pg-boss';

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/pg-boss');

const { close } = createPgBossBoard({
  serverAdapter,
  pgBoss: {
    instance: boss, // your started PgBoss, used for writes
    connection: process.env.DATABASE_URL, // used for reads, with a server-side timeout
    schema: 'pgboss',
  },
  options: { readOnly: false },
});

app.use('/pg-boss', serverAdapter.getRouter());
```

`pgBoss` accepts:

| Option | Default | |
|---|---|---|
| `instance` | | The app's started `PgBoss`. Writes go through it. |
| `connection` | | A connection string, a `pg` pool config, or a `pg.Pool` of yours (borrowed, never closed). Reads go through it. |
| `schema` | `pgboss` | |
| `queues` | all | An allowlist of names, or a predicate. Anything else answers 404. |
| `includeInternalQueues` | `false` | Show pg-boss's own `__pgboss__*` queues. |
| `delimiter` | none | Groups queue names in the sidebar. |
| `queryTimeoutMs` | `5000` | `statement_timeout` of every read. |
| `countCap` | `10000` | Per-state counts stop here and report `capped`. |
| `visibilityGuard` | | `(request, queueName) => boolean` per request. A hidden queue answers 404. |

Pass `connection` with or without `instance`:

- **`instance` and `connection`** (recommended): reads through a small pool of the board's own
  with a real `statement_timeout`, writes through your instance.
- **`instance` only**: both go through your instance. PostgreSQL cannot time out a single
  statement from inside it, so a slow read is abandoned by the board but keeps running.
- **`connection` only**: writes go through a pg-boss instance that is **never started**, and
  only while the database is on the exact schema version the installed pg-boss writes.
  Otherwise the board stays readable and reports why writes are off.

The same board is available as a named NestJS board (`WorkerManagerModule.forRoot({ name,
engine: 'pg-boss', pgBoss })`) and from the CLI (`--pg-boss <url>`); see the docs.

## What it never does

It never calls `start()`, `stop()`, `supervise()` or a migration on your database, and it
never creates a schema, table or index. The one pg-boss instance it builds itself is never
started. Reads are plain `SELECT`s, so a role with `USAGE` on the schema and `SELECT` on its
tables is enough for a read-only board.

The counters on the queue list are pg-boss's cached ones, only as fresh as the last `supervise`
run by any instance of your app. The queue page counts each state live, capped.

## Recommended indexes

Listing `completed`, `failed` or `cancelled` jobs of a large shared queue has no index to
follow. With 5 million jobs in `job_common` the first page takes seconds; with this index it
takes under a millisecond. pg-boss's drift check reports it as an extra index and is otherwise
unaffected. Create it yourself, the board never will (a queue with `partition: true` needs the
same index on its own table):

```sql
CREATE INDEX CONCURRENTLY wm_job_list ON pgboss.job_common (name, state, created_on DESC, id DESC);
```

## Metrics sources

`@worker-manager/metrics` can record throughput and latency history for pg-boss queues.
`pgBossMetricsSources(board.engine)` (or `pgBossMetricsSources({ connection, schema })`, which
opens a reader of its own) gives a `MetricsRecorder` one source per queue, counting finished jobs
by the minute of `completed_on`. Queues record under `pgBossMetricsNamespace(schema)`
(`pgboss:<schema>:`), and `namespacedHistoryProvider(provider, sources.namespace)` is the pg-boss
board's view of the store, so a BullMQ board can share it. The counters need an index on
`(name, completed_on)`; without one a queue's counters stay off and `onWarning` says so once.
`pgBossMetricsIndexDdl(schema)` returns the statement:

```sql
CREATE INDEX wm_job_completed_on ON pgboss.job (name, completed_on);
```

`readPgBossQueueDepth(engine, queue, { from, to, bucketSeconds, aggregate })` folds pg-boss's
own `queue_stats` snapshots into buckets, for queues with `persistQueueStats`. See the
historical metrics recipe in the docs for the recorder setup and the non-blocking index variant.

## License

MIT. Parts of the SQL are adapted from `@pg-boss/dashboard` (MIT); see `LICENSE`.
