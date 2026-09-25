# pg-boss (experimental)

::: warning Experimental
The pg-boss engine is experimental. Its screens and its `/api/pg-boss` HTTP contract may still change in a minor release, until it is declared stable.
:::

[pg-boss](https://github.com/timgit/pg-boss) is a job queue that lives entirely in PostgreSQL. `@worker-manager/pg-boss` mounts a whole board over one pg-boss schema: the same shell, sidebar, command palette, themes and auth as a BullMQ board, with pages built around what pg-boss actually stores. It lists queues with their policy and cached counters, shows jobs in all six pg-boss states, and lets you retry, cancel, resume, delete and send jobs and edit schedules.

A board runs one engine. BullMQ and pg-boss queues never share a board. If your app has both, mount [two boards side by side](/recipes/multiple-dashboards#bullmq-and-pg-boss-side-by-side).

![The pg-boss overview: KPI tiles from pg-boss's cached counters, and one card per queue with its policy](/screenshots/pgboss-overview.png)

<a href="/worker-manager/demo/pg-boss/" target="_blank" rel="noopener">Open the pg-boss demo</a> to click around it. The header's links menu switches between the BullMQ and pg-boss boards.

## When to use it

- Your jobs are in pg-boss and you want a board for them next to, or instead of, the official `@pg-boss/dashboard`, with the auth, server adapters, NestJS module and CLI Worker Manager already has.
- You run BullMQ and pg-boss in the same system and want both behind the same login, with the same look.

If your queues are BullMQ v6 queues stored in PostgreSQL, you don't need this: that is still the BullMQ engine. See [PostgreSQL backend](/recipes/postgres-backend).

## Requirements

| | Supported |
|---|---|
| pg-boss | `^12.24.0` |
| pg-boss schema version | 35 to 42 (35 is pg-boss 12.24.0, 42 is 12.33.0 and 12.34.0) |
| Node.js | 22.12 or later, pg-boss's own floor. The rest of Worker Manager stays on Node.js 20. |
| PostgreSQL | Whatever your pg-boss supports. CockroachDB, YugabyteDB and PGlite are not tested. |

pg-boss 11 and older use a different schema and are not supported. Schedule previews (the next runs column, and the preview in the schedule editor) and RRULE schedules need pg-boss 12.31 or later. On 12.24 to 12.30 the schedules page still lists and edits cron schedules, with no next runs.

## Install

```sh
npm install @worker-manager/pg-boss @worker-manager/express
```

`@worker-manager/pg-boss` depends on `pg` and takes `@worker-manager/api` and `pg-boss` as peers. `pg-boss` is an optional peer: it is only loaded when the board has no instance of yours to use, to write and to preview schedules (see [connection modes](#connection-modes)).

## Mount it

The board mounts on any Worker Manager server adapter. With Express:

```ts
import express from 'express';
import { PgBoss } from 'pg-boss';
import { ExpressAdapter } from '@worker-manager/express';
import { createPgBossBoard } from '@worker-manager/pg-boss';

const boss = new PgBoss(process.env.DATABASE_URL!);
await boss.start(); // your app's instance, started by your app as usual

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/pg-boss');

const board = createPgBossBoard({
  serverAdapter,
  pgBoss: {
    instance: boss, // writes go through your instance
    connection: process.env.DATABASE_URL, // reads go through a small pool of the board's own
    schema: 'pgboss',
    delimiter: '.', // groups `emails.welcome` under `emails` in the sidebar
  },
  options: { readOnly: false },
});

const app = express();
app.use('/pg-boss', serverAdapter.getRouter());
app.listen(3000);

// On shutdown: closes the board's own pool. Your instance and your pools stay yours.
await board.close();
```

The same thing, elsewhere:

- **NestJS**: `WorkerManagerModule.forRoot({ name: 'pgboss', engine: 'pg-boss', pgBoss: { ... } })`. See [the NestJS pg-boss board](/server-adapters/nestjs#pg-boss-board-experimental).
- **CLI**: `npx @worker-manager/cli --pg-boss postgres://app:secret@localhost:5432/app`, on its own or next to a BullMQ board. See [the CLI's pg-boss section](/guide/cli#pg-boss).
- **Docker**: `WORKER_MANAGER_PGBOSS_URL`. See [Run with Docker](/guide/docker).
- **Any other framework**: swap `ExpressAdapter` for the [server adapter](/server-adapters/) you use. Nothing else changes.

`createPgBossBoard` returns `{ engine, close() }`. `engine` is what [`pgBossMetricsSources`](/recipes/historical-metrics#pg-boss-queues) records history from.

### Options

`pgBoss`:

| Option | Default | Description |
|---|---|---|
| `instance` | | Your app's `PgBoss`, already started. Writes go through it. |
| `connection` | | A connection string, a `pg` pool config, or a `pg.Pool` of yours (borrowed, never closed). Reads go through it. |
| `schema` | `'pgboss'` | The schema pg-boss was installed in. One board reads one schema; use a board per schema. |
| `queues` | every queue | An allowlist of names, or a predicate. Any other queue answers 404, in the UI and in the API. |
| `includeInternalQueues` | `false` | Show pg-boss's own `__pgboss__*` queues. |
| `delimiter` | none | Groups queue names in the sidebar, for example `'.'`. |
| `queryTimeoutMs` | `5000` | `statement_timeout` of every read. See [query timeout](#query-timeout). |
| `countCap` | `10000` | The live per-state counts stop here and show `10k+`. |
| `visibilityGuard` | | `(request, queueName) => boolean \| Promise<boolean>`, asked per request. A hidden queue answers 404, like a missing one. |

`options` takes the usual [board options](/configuration/ui-config) (`uiConfig`, `historyProvider`, `handlerHooks`, `validateResponses`, `uiBasePath`) plus `readOnly`.

## Connection modes

Pass `instance`, `connection`, or both:

| You pass | Reads | Writes |
|---|---|---|
| `instance` and `connection` (recommended) | A pool of the board's own (3 connections, `application_name` `worker-manager`), with a real server-side `statement_timeout`. A `pg.Pool` of yours is borrowed instead, with the timeout set per read-only transaction. | Your instance. |
| `instance` only | Your instance's database. The timeout can only be enforced on the client side. | Your instance. |
| `connection` only | As in the first row. | A pg-boss instance the board builds per command and **never starts**, and only while the database is on exactly the schema version the installed pg-boss writes. Otherwise the board stays readable and says why writes are off. |

In the last mode the board needs `pg-boss` installed next to it, which is also where schedule previews come from when there is no instance. Without it, or with a pg-boss whose schema version differs from the database's (your app is on an older or newer pg-boss), the board is read-only and shows the reason in a banner: "The database is on pg-boss schema 41, but the pg-boss available here writes schema 42."

## We never migrate or alter your database

pg-boss's `start()` migrates the schema by default, and with `migrate: false` it still demands an exact version match and starts maintenance timers. The board never calls it. What it does and does not do:

- It never calls `start()`, `stop()`, `supervise()` or a migration, and never creates a schema, table or index. The one pg-boss instance it can build itself is never started, so no timer runs and nothing is monitored or scheduled from the board's process.
- Reads are plain `SELECT`s against the pg-boss tables. It does not call `getQueueStats()`, which can `UPDATE` the queue table when its cache is stale.
- Writes go through pg-boss's public API (`send`, `retry`, `cancel`, `resume`, `deleteJob`, `deleteQueuedJobs`, `deleteStoredJobs`, `schedule`, `unschedule`), so pg-boss's own rules for singletons, dead letters and flows hold. There is no SQL `UPDATE` of its tables.
- At startup a version guard reads the schema version. Outside 35 to 42, or with no pg-boss installed in that schema, the board reads nothing and says so on every page. The indexes below are recommendations for you to create; the board never creates them.

## What the board shows

The queue page has one tab per pg-boss state, in pg-boss's own order: `created`, `retry`, `active`, `completed`, `cancelled`, `failed`. Two conditions that are not states show as badges on a job: **deferred** (a `created` job whose `startAfter` is still in the future) and **blocked** (a flow dependent still waiting on the jobs it depends on).

![A pg-boss queue page: one tab per state with live counts, and a keyset page of jobs](/screenshots/pgboss-queue.png)

The job list pages by keyset, newest first, with Previous and Next rather than numbered pages. Search by exact job id, or filter by singleton key.

A job page has its data, its output (the result on a completed job, the error on a failed one), its options, a timeline, its dependencies (what it waits on and what waits on it, as two lists of links) and, for a job pg-boss moved to a dead letter queue, the job it came from.

![A failed pg-boss job with its error output and its timeline](/screenshots/pgboss-job.png)

Actions follow the job's state:

| State | Actions |
|---|---|
| `created` | Cancel, delete, duplicate |
| `retry` | Cancel, delete |
| `active` | Cancel. The confirmation warns that this does not stop a handler already running in another process: the job is marked cancelled, and the worker's later `complete()` changes nothing. Delete is refused with 409. |
| `completed` | Delete, duplicate |
| `cancelled` | Resume, delete |
| `failed` | Retry, delete, duplicate |

Per queue, the actions menu has **Send job** (data, priority, start after, singleton key, retry limit, delay and backoff, expiry), **Retry all failed**, **Delete queued jobs** (everything that has not started) and **Delete finished jobs** (completed, cancelled and failed). The HTTP API also takes up to 100 job ids at once for retry, cancel, resume and delete. A job that changed state in the meantime answers 409 instead of being touched.

The schedules page lists every cron and RRULE schedule with its time zone, its next runs (worked out on the server by pg-boss's `previewSchedule()`), the last job it sent, and actions to create, edit, remove or run one now. Running one now sends a job with the schedule's data and options, which is exactly what pg-boss's timekeeper does when it fires.

![The pg-boss schedules page with cron and RRULE schedules and their next runs](/screenshots/pgboss-schedules.png)

The header's datastore panel shows the PostgreSQL server, the pg-boss schema and its version, the supported range, and whether the board can write.

## What does not exist here

These are BullMQ ideas pg-boss does not have, so the board does not pretend to offer them:

- **Pause and resume a queue.** pg-boss has no paused queue.
- **Job logs and progress.** pg-boss stores neither.
- **Workers.** pg-boss does not register its workers anywhere the board could read.
- **Rate limits and global concurrency.** Not pg-boss features. Its policies (`singleton`, `stately`, `exclusive`, `key_strict_fifo`, `short`) are shown as they are.
- **Promote, and editing a job's data, delay or priority.** pg-boss has no promote; its `update()` is not wired into the board yet.
- **Flows as a graph.** pg-boss flows are a DAG, shown as lists of dependencies and dependents.
- **Creating, updating or deleting queues**, and redriving a dead letter queue. A queue's life cycle belongs to your app's code.
- **Searching job data.** Search is by id and by singleton key.

The board-wide capabilities are listed per library in the [overview table](/queue-adapters/#capabilities).

## Freshness of the counters

The overview, the sidebar and the queue cards read the counters pg-boss caches in its `queue` table (`queued`, `deferred`, `ready`, `active`, `failed`, `total`). Those are only written by the `supervise` loop of some pg-boss instance, every `monitorIntervalSeconds` (60 seconds by default). So:

- The overview shows when the counters were written ("Counters from 25 seconds ago").
- Older than five minutes, a banner says no instance running `supervise` has refreshed them since. With no pg-boss instance supervising at all, they stay at zero, and the banner says the queues were never monitored.
- The tabs on a queue page do not use the cache. They count each state live, capped at `countCap` (`10k+` above it), and only on the queue you have open.

If the cards look frozen while jobs are clearly moving, check that at least one instance of your app runs pg-boss with `supervise` on (the default).

## Query timeout

Every read runs under a `statement_timeout` of `queryTimeoutMs` (5 seconds by default). A read that runs out answers `ERRORS.PGBOSS_QUERY_TIMEOUT` and the page suggests filtering by id or singleton key. A count that runs out shows `?` on its tab while the list keeps working.

The timeout is only enforced by the server when the board reads through a `connection`. PostgreSQL arms `statement_timeout` when a statement starts, so it cannot be set from inside the single statement a pg-boss instance's `executeSql` runs. With `instance` alone, the board stops waiting after `queryTimeoutMs` and answers the timeout, but the query keeps running on the server until it finishes. Pass a `connection` for reads whenever you can.

## Recommended indexes

pg-boss's own indexes are built for fetching work, not for browsing it. Two optional indexes make the board and its history cheap on large queues. The board never creates them, and pg-boss's schema drift check lists them under `extraIndexes` without failing (its reindex tooling treats them like its own).

### Job lists

Listing `completed`, `failed` or `cancelled` jobs of a queue has no index to follow: PostgreSQL reads every row of the queue in that state and sorts it. With 5 million jobs in the shared `job_common` table, the first page of `completed` took 3.4 seconds in our benchmark; with this index it takes under a millisecond, and the six live counts drop from 2.5 to 1.0 seconds:

```sql
CREATE INDEX CONCURRENTLY wm_job_list ON pgboss.job_common (name, state, created_on DESC, id DESC);
```

A queue created with `partition: true` has a table of its own, which needs the same index:

```sql
SELECT name, table_name FROM pgboss.queue WHERE partition;

CREATE INDEX CONCURRENTLY wm_job_list_<table> ON pgboss.<table_name> (name, state, created_on DESC, id DESC);
```

Without it everything still works; only those lists are slower, and a very large one runs into the [query timeout](#query-timeout) cleanly.

### History

[Historical metrics](/recipes/historical-metrics#pg-boss-queues) count finished jobs by the minute of `completed_on`, which needs an index on `(name, completed_on)`. This is the statement `pgBossMetricsIndexDdl()` returns, and the one the recorder prints when it finds no such index:

```sql
CREATE INDEX wm_job_completed_on ON pgboss.job (name, completed_on);
```

On a busy database, build it without locking writes: the recipe has the `CONCURRENTLY` variant per partition. Until it exists, that queue's throughput and latency history stays off and the recorder says so once.

## A read-only PostgreSQL role

A read-only board only ever runs `SELECT`, so it can connect as a role that cannot change anything:

```sql
CREATE ROLE wm_reader LOGIN PASSWORD 'change-me';
GRANT USAGE ON SCHEMA pgboss TO wm_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA pgboss TO wm_reader;
-- pg-boss creates a table per partitioned queue later; grant those too, as the role that owns pgboss:
ALTER DEFAULT PRIVILEGES FOR ROLE app IN SCHEMA pgboss GRANT SELECT ON TABLES TO wm_reader;
```

```ts
createPgBossBoard({
  serverAdapter,
  pgBoss: { connection: 'postgres://wm_reader:change-me@db:5432/app', schema: 'pgboss' },
  options: { readOnly: true },
});
```

Pass no `instance` here: with `readOnly: true` nothing writes, and the board's mutation routes are not even registered, so a forged request gets a 404. The test suite runs the whole read surface as a role with nothing but `USAGE` and `SELECT`. See [Read-only mode](/recipes/read-only-mode#pg-boss-boards) for how `readOnly` behaves on a pg-boss board.

## Historical metrics

`@worker-manager/metrics` records throughput and latency history for pg-boss queues as well, from pg-boss's finished jobs. See [the pg-boss section of the historical metrics recipe](/recipes/historical-metrics#pg-boss-queues).

## HTTP API

A pg-boss board serves its own routes under `/api/pg-boss/*` (plus `/api/metrics/*` with a history provider), and none of the BullMQ `/api/queues` routes. They are listed under the `pg-boss` tag in the [HTTP API reference](/api/). Errors are translation keys, like everywhere else in the API. The contract may change in a minor release while the engine is experimental.
