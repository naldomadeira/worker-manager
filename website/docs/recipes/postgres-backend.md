# PostgreSQL backend

BullMQ v6 can store queues in PostgreSQL instead of Redis. Worker Manager reads those queues the same way it reads Redis ones, so there is nothing extra to configure on the board.

## Setup

Install `pg` alongside BullMQ v6, then pass `createPostgresBackend` as the third argument to `Queue`:

```js
const express = require('express');
const { Queue, createPostgresBackend } = require('bullmq');
const { createBullBoard } = require('@worker-manager/api');
const { BullMQAdapter } = require('@worker-manager/api/bullMQAdapter');
const { ExpressAdapter } = require('@worker-manager/express');

const connection = 'postgres://user:password@localhost:5432/bullmq';

const emails = new Queue('emails', { connection }, createPostgresBackend);

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [new BullMQAdapter(emails)],
  serverAdapter,
});

const app = express();
app.use('/admin/queues', serverAdapter.getRouter());
app.listen(3000);
```

::: warning A fresh database needs its schema
BullMQ refuses to start against a database it has not migrated, with
`SchemaMigrationRequiredError: PostgreSQL schema "bullmq" is not initialized`. Either run its
migrations once as a deploy step, or let the connection apply them on first connect. That
takes the object form of the connection, which is also where a custom `schema` goes:

```js
const connection = {
  connectionString: 'postgres://user:password@localhost:5432/bullmq',
  schema: 'bullmq', // optional, the default
  migrate: true,
};
```

Workers need the same connection and the same `createPostgresBackend` factory as their queue.
:::

::: tip The throughput chart needs worker metrics
`uiConfig.showMetrics` charts BullMQ's own per-minute metrics, which workers only collect when
asked: `new Worker(name, processor, { connection, metrics: { maxDataPoints: MetricsTime.ONE_WEEK } }, createPostgresBackend)`.
:::

That is the whole difference: the third argument on `Queue`. `BullMQAdapter` takes the queue as it always has.

::: tip
`ioredis` is an optional peer dependency of BullMQ v6, so a Postgres-only app does not need it installed.
:::

## What the dashboard shows

Job listing, counts, adding, retrying, cleaning, pausing, promoting, flows and the schedulers view all behave exactly as they do on Redis.

One panel is Redis-specific and adapts:

**Datastore details** reports what Postgres can answer, and retitles itself:

| | |
|---|---|
| Version | 17.10 |
| Up time | 3 days |
| Connected clients | 6 |
| Blocked clients | 0 |
| Port | 5432 |

Memory usage, peak memory, fragmentation ratio and replication mode are left out rather than filled with a number that means something else. `pg_database_size` measures disk, not memory.

## Mixing backends

A single board can hold Redis-backed and Postgres-backed queues at once. Each queue answers for itself:

```js
createBullBoard({
  queues: [
    new BullMQAdapter(new Queue('emails', { connection: pgConnection }, createPostgresBackend)),
    new BullMQAdapter(new Queue('reports', { connection: { host: 'localhost', port: 6379 } })),
  ],
  serverAdapter,
});
```

The datastore details panel describes the first registered queue, so put the one you care about first if you mix them.

## Historical metrics

[`@worker-manager/metrics`](/recipes/historical-metrics) records PostgreSQL-backed queues like Redis ones: counters from the queue's metrics, latency and queue age from BullMQ's `job` table. Its history can live in PostgreSQL too, so a board with no Redis at all still gets the 7, 30 and 90 day charts and the storage panel:

```js
const {
  MetricsRecorder,
  PostgresMetricsHistoryProvider,
  PostgresMetricsStore,
} = require('@worker-manager/metrics');

const store = new PostgresMetricsStore({ connection, schema: 'bullmq', migrate: true });
const recorder = new MetricsRecorder({ queues: [new BullMQAdapter(emails)], store });
recorder.start();

createBullBoard({
  queues: [new BullMQAdapter(emails)],
  serverAdapter,
  options: {
    uiConfig: { showMetrics: true },
    historyProvider: new PostgresMetricsHistoryProvider({ store }),
  },
});
```

The tables are prefixed `bull_board_metrics_` and sit next to BullMQ's in the same schema here; see [PostgreSQL storage](/recipes/historical-metrics#postgresql-storage) for the schema, migrations and sizing. With the CLI, `--postgres ... --history` does the same with no code.
