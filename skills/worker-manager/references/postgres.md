# BullMQ v6 on PostgreSQL reference

Source of truth: <https://naldomadeira.github.io/worker-manager/recipes/postgres-backend>.

This is the **BullMQ engine**, not pg-boss. BullMQ v6 stores queues in PostgreSQL when the queue is
created with `createPostgresBackend`; the board reads it through the same `BullMQAdapter`.
Supported BullMQ range: `^5.56.0 || ^6.0.0`.

## Setup

```sh
npm install bullmq@^6 pg   # ioredis is optional in v6, not needed for Postgres-only apps
```

```ts
import { Queue, createPostgresBackend } from 'bullmq';
import { createWorkerManagerBoard } from '@worker-manager/api';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';

const connection = {
  connectionString: process.env.POSTGRES_URL!,
  schema: 'bullmq', // optional, the default
  migrate: true, // BullMQ >= 6.3: create/upgrade its schema on first connect
};

const invoices = new Queue('invoices', { connection }, createPostgresBackend);

createWorkerManagerBoard({ queues: [new BullMQAdapter(invoices)], serverAdapter });
```

- BullMQ **6.3+** refuses an unmigrated database with `SchemaMigrationRequiredError: PostgreSQL
  schema "bullmq" is not initialized`. Use `migrate: true` (object connection form) or run the
  migrations as a deploy step. 6.0 to 6.2 migrate on `waitUntilReady()` and have no `migrate` option.
- Workers need the same connection and the same `createPostgresBackend` as their queue.
- The throughput chart (`uiConfig.showMetrics`) needs worker metrics:
  `new Worker(name, fn, { connection, metrics: { maxDataPoints: MetricsTime.ONE_WEEK } }, createPostgresBackend)`.
- NestJS: `@nestjs/bullmq` cannot pass the backend factory; register the instance with
  `queues: [{ queue: invoices, adapter: BullMQAdapter }]` or `forFeature({ queue, adapter })`.
  If Redis queues must stay on BullMQ v5, alias v6 for the Postgres ones (`"bullmq-v6": "npm:bullmq@^6"`).

## What changes on the board

Everything (lists, add, retry, clean, pause, promote, flows, schedulers) behaves as on Redis. The
datastore panel reports Postgres stats instead of Redis memory. v6 has no `paused` state: paused
jobs show under Waiting and the Paused tab disappears (intended).

## Mixing backends

One board can hold Redis and PostgreSQL queues; the datastore panel describes the first queue:

```ts
createWorkerManagerBoard({
  queues: [
    new BullMQAdapter(new Queue('emails', { connection: pgConnection }, createPostgresBackend)),
    new BullMQAdapter(new Queue('reports', { connection: { host: 'localhost', port: 6379 } })),
  ],
  serverAdapter,
});
```

History for such boards can be stored in PostgreSQL too: see [metrics.md](metrics.md).
CLI: `npx @worker-manager/cli --postgres postgres://user:pass@host:5432/db [--postgres-schema bullmq]`.
