# Multiple dashboards in one app

You might want separate dashboards for different queue groups. One per team, or one read-only and one read-write.

From [`examples/express/multiple-boards`](https://github.com/naldomadeira/worker-manager/tree/main/examples/express/multiple-boards).

```js
const serverAdapter1 = new ExpressAdapter();
const serverAdapter2 = new ExpressAdapter();

createWorkerManagerBoard({
  queues: [new BullMQAdapter(queueA)],
  serverAdapter: serverAdapter1,
});

createWorkerManagerBoard({
  queues: [new BullMQAdapter(queueB)],
  serverAdapter: serverAdapter2,
});

serverAdapter1.setBasePath('/instance1');
serverAdapter2.setBasePath('/instance2');

app.use('/instance1', serverAdapter1.getRouter());
app.use('/instance2', serverAdapter2.getRouter());
```

Each adapter is independent. Pass a different UIConfig per instance (`boardTitle`, `boardLogo`, `environment` badge) to make them visually distinct.

## BullMQ and pg-boss side by side

A board runs one engine, so an app with BullMQ and [pg-boss](/queue-adapters/pg-boss) queues (experimental) mounts two boards. Give each one a header link to the other with `miscLinks`:

```ts
import { createWorkerManagerBoard } from '@worker-manager/api';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { ExpressAdapter } from '@worker-manager/express';
import { createPgBossBoard } from '@worker-manager/pg-boss';

const miscLinks = [
  { text: 'BullMQ', url: '/queues/' },
  { text: 'pg-boss', url: '/pg-boss/' },
];

const bullmqAdapter = new ExpressAdapter().setBasePath('/queues');
createWorkerManagerBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter: bullmqAdapter,
  options: { uiConfig: { miscLinks } },
});

const pgBossAdapter = new ExpressAdapter().setBasePath('/pg-boss');
const pgBossBoard = createPgBossBoard({
  serverAdapter: pgBossAdapter,
  pgBoss: { instance: boss, connection: process.env.DATABASE_URL, schema: 'pgboss' },
  options: { uiConfig: { miscLinks } },
});

app.use('/queues', bullmqAdapter.getRouter());
app.use('/pg-boss', pgBossAdapter.getRouter());
```

Mount them side by side, not one inside the other (`/queues` and `/queues/pg-boss`): on Express the outer router would also answer the inner board's paths. The same goes for the other two ways to do it:

- **NestJS.** Keep the BullMQ board as it is and add a named board with `engine: 'pg-boss'`: `WorkerManagerModule.forRootAsync({ name: 'pgboss', useFactory: (boss) => ({ route: '/pg-boss', engine: 'pg-boss', pgBoss: { instance: boss } }), inject: ['PG_BOSS'] })`. Each named board has its own `route`, `auth` and session cookie. See [several boards](/server-adapters/nestjs#several-boards) and [the pg-boss board](/server-adapters/nestjs#pg-boss-board-experimental).
- **CLI and Docker.** Give the CLI a BullMQ source and `--pg-boss <url>`: BullMQ is served at the root and pg-boss under `/pg-boss/` (`--pg-boss-path`), behind one login, and each board's header links to the other. See [next to a BullMQ board](/guide/cli#next-to-a-bullmq-board).

The two boards can share one [historical metrics](/recipes/historical-metrics#pg-boss-queues) store: pg-boss queues are recorded under a `pgboss:<schema>:` prefix, so neither board's totals count the other's jobs.

## When to use this instead of a visibility guard

- Different auth strategies per dashboard. Use multiple dashboards.
- Same auth, per-tenant queue visibility. Use [per-tenant visibility](/recipes/per-tenant-visibility) instead.
- Different `readOnlyMode` policies per audience. Multiple dashboards, each with different queue-adapter options.
- Queues on different engines (BullMQ and pg-boss). Multiple dashboards, always: one board runs one engine.
