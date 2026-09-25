# @worker-manager/pg-boss

**Experimental.** A [pg-boss](https://github.com/timgit/pg-boss) engine for Worker Manager. It
mounts a whole board over one pg-boss schema, on any Worker Manager server adapter: its own
`/api/pg-boss/*` routes, the metrics history routes when a `historyProvider` is set, and the
dashboard entry page. A board runs one engine; it never mixes BullMQ and pg-boss queues.

The `/api/pg-boss` contract may still change in a minor release. The package is not published
yet, and the dashboard pages for this engine are still to come.

## Requirements

- Node.js 22.12 or later (pg-boss's own floor).
- pg-boss 12.24.0 or later, on a database whose pg-boss schema is between 35 and 42.

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

## What it never does

It never calls `start()`, `stop()`, `supervise()` or a migration on your database, and it
never creates a schema, table or index. The one pg-boss instance it builds itself is never
started. Reads are plain `SELECT`s, so a role with `USAGE` on the schema and `SELECT` on its
tables is enough for a read-only board.

The counters on the queue list are pg-boss's cached ones, only as fresh as the last `supervise`
run by any instance of your app. The queue page counts each state live, capped.

## Recommended index

Listing `completed`, `failed` or `cancelled` jobs of a large shared queue has no index to
follow. With 5 million jobs in `job_common` the first page takes seconds; with this index it
takes under a millisecond. pg-boss's drift check reports it as an extra index and is otherwise
unaffected. Create it yourself, the board never will:

```sql
CREATE INDEX CONCURRENTLY wm_job_list ON pgboss.job_common (name, state, created_on DESC, id DESC);
```

## License

MIT. Parts of the SQL are adapted from `@pg-boss/dashboard` (MIT); see `LICENSE`.
