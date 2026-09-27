# pg-boss reference

Source of truth: <https://naldomadeira.github.io/worker-manager/queue-adapters/pg-boss>.
The engine is **stable** since 2.4.0 and follows semver like the BullMQ engine: a breaking change to
its screens or the `/api/pg-boss` HTTP contract only ships in a major. Do not call it experimental.

## Requirements

- `pg-boss` `^12.24.0` (schema version 35+; 35 to 42 tested). pg-boss 11 and older: not supported.
- Node.js **22.12+** (pg-boss's own floor). The rest of Worker Manager runs on Node 20.
- `npm install @worker-manager/pg-boss @worker-manager/<framework>` (`@worker-manager/api` is a peer;
  `pg` is a dependency; `pg-boss` is an optional peer, loaded only when the board has no instance).
- Schedule previews and RRULE schedules need pg-boss 12.31+.

## Mount

```ts
import { PgBoss } from 'pg-boss';
import { ExpressAdapter } from '@worker-manager/express';
import { createPgBossBoard } from '@worker-manager/pg-boss';

const boss = new PgBoss(process.env.DATABASE_URL!);
await boss.start(); // the app's instance, started by the app

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/pg-boss');

const board = createPgBossBoard({
  serverAdapter,
  pgBoss: {
    instance: boss, // writes go through it
    connection: process.env.DATABASE_URL, // reads: the board's own 3-connection pool with statement_timeout
    schema: 'pgboss',
    delimiter: '.', // groups `emails.welcome` under `emails`
  },
  options: { readOnly: false, uiConfig: { boardTitle: 'Jobs' } },
});

app.use('/pg-boss', serverAdapter.getRouter());
// shutdown: await board.close()  (closes only the board's own pool)
```

`createPgBossBoard({ serverAdapter, pgBoss, options })` returns `{ engine, close() }`. `options` takes
the usual board options (`uiConfig`, `historyProvider`, `handlerHooks`, `validateResponses`,
`uiBasePath`) plus `readOnly`. Any server adapter works (Fastify:
`app.register(serverAdapter.registerPlugin(), { prefix: '/pg-boss' })`). NestJS:
`engine: 'pg-boss'` (see [nestjs.md](nestjs.md)). CLI: `--pg-boss <url>`.

## `pgBoss` options

| Option | Default | |
|---|---|---|
| `instance` | | The app's started `PgBoss`. Preferred for writes. |
| `connection` | | Connection string, `pg` pool config, or a `pg.Pool` of the app's (borrowed, never closed). |
| `schema` | `'pgboss'` | One board reads one schema. |
| `queues` | all | Allowlist of names or a predicate; others answer 404. |
| `includeInternalQueues` | `false` | Show `__pgboss__*` queues. |
| `delimiter` | none | Sidebar grouping. |
| `queryTimeoutMs` | `5000` | `statement_timeout` of every read. |
| `countCap` | `10000` | Live per-state counts cap (`10k+`). |
| `visibilityGuard` | | `(request, queueName) => boolean \| Promise<boolean>`. |
| `allowUntestedSchema` | `false` | Allow writes on a schema newer than the tested max (reads work either way). |

## Connection modes

| Passed | Reads | Writes |
|---|---|---|
| `instance` + `connection` (recommended) | board's pool, server-side timeout | the app's instance |
| `instance` only | the instance; timeout only client side | the app's instance |
| `connection` only | board's pool | a pg-boss instance that is **never started**, only while the DB schema version equals the installed pg-boss's; otherwise read-only with a banner |

## What it never does

It never calls `start()`, `stop()`, `supervise()` or a migration, and never creates a schema,
table or index. Reads are plain `SELECT`s; writes use pg-boss's public API (`send`, `retry`,
`cancel`, `resume`, `deleteJob`, `schedule`, ...). Never add code that migrates the user's pg-boss
schema on the board's behalf.

## Read-only board with a read-only role

```sql
CREATE ROLE wm_reader LOGIN PASSWORD 'change-me';
GRANT USAGE ON SCHEMA pgboss TO wm_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA pgboss TO wm_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE app IN SCHEMA pgboss GRANT SELECT ON TABLES TO wm_reader;
```

```ts
createPgBossBoard({
  serverAdapter,
  pgBoss: { connection: process.env.PGBOSS_READER_URL, schema: 'pgboss' },
  options: { readOnly: true }, // mutation routes are not registered (404)
});
```

## Recommended indexes (the user creates them; the board never does)

```sql
-- job lists of completed/failed/cancelled on large queues
CREATE INDEX CONCURRENTLY wm_job_list ON pgboss.job_common (name, state, created_on DESC, id DESC);
-- historical metrics (pgBossMetricsIndexDdl(schema) returns this)
CREATE INDEX wm_job_completed_on ON pgboss.job (name, completed_on);
```

Queues created with `partition: true` need the same index on their own table
(`SELECT name, table_name FROM pgboss.queue WHERE partition;`).

## Behaviour to explain to users

- Six states per queue: `created`, `retry`, `active`, `completed`, `cancelled`, `failed`; badges for
  deferred and blocked jobs. Schedules page (cron and RRULE), dead-letter origin on jobs, warnings page
  (needs `persistWarnings: true`), queue-depth chart (needs `persistQueueStats` and a supervising
  instance), bulk retry/cancel/resume/delete, job lookup by id in the command palette.
- Overview counters are pg-boss's cached ones, refreshed only by some instance running `supervise`
  (default on). Frozen cards: check that one app instance supervises.
- Newer schema than tested: still read by probing columns; missing features switch off and a banner
  names them; writes off unless `allowUntestedSchema: true`.
- Not available (pg-boss lacks them): pausing queues, job logs/progress, workers list, rate limits,
  promote, queue create/delete.
- Errors: `ERRORS.PGBOSS_WRITES_DISABLED` (409, reason in banner), `ERRORS.PGBOSS_SCHEMA_UNTESTED`,
  `ERRORS.PGBOSS_QUERY_TIMEOUT` (filter by id or singleton key, add the index).

## Next to BullMQ

Two boards, sibling paths, header links via `uiConfig.miscLinks`:

```ts
const miscLinks = [{ text: 'BullMQ', url: '/queues/' }, { text: 'pg-boss', url: '/pg-boss/' }];
createWorkerManagerBoard({ queues, serverAdapter: bullmqAdapter, options: { uiConfig: { miscLinks } } });
createPgBossBoard({ serverAdapter: pgBossAdapter, pgBoss: { instance: boss, connection }, options: { uiConfig: { miscLinks } } });
```
