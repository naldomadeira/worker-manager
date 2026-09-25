# Read-only mode

> Applies to: all adapters, and [pg-boss boards](#pg-boss-boards) (experimental).

Read-only mode disables every destructive action on a queue. No retries, no removals, no queue operations (pause, resume, empty, clean, obliterate), no adding jobs. Use it to share the dashboard with stakeholders, support, or shared dev environments without risking anything.

## Enable per queue

```ts
import { createWorkerManagerBoard } from '@worker-manager/api';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';

createWorkerManagerBoard({
  queues: [
    new BullMQAdapter(emailQueue, { readOnlyMode: true }),
  ],
  serverAdapter,
});
```

The flag is per queue adapter, so one board can mix read-only and writable queues.

## What gets disabled

With `readOnlyMode: true`, the API endpoint for any write action on that queue returns **HTTP 405 Method Not Allowed**, and the matching buttons are hidden in the UI.

| Action | Disabled in read-only mode |
| --- | --- |
| Add job | Yes |
| Retry job (single) | Yes |
| Retry all | Yes |
| Promote job (single) | Yes |
| Promote all | Yes |
| Remove job (single) | Yes |
| Clean bulk (completed / failed / waiting) | Yes |
| Empty queue | Yes |
| Obliterate queue | Yes |
| Pause / resume queue | Yes |
| Set global concurrency | Yes |
| Set rate limit, and release one a worker tripped | Yes |
| Reschedule a delayed job / change a prioritized job's priority | Yes |
| Edit or remove a job scheduler | Yes |
| Remove a parent's unprocessed children | Yes |
| Update job data | Yes |
| View queue, job, logs, flow | No, still accessible |
| Pause-all / resume-all | Read-only queues are silently skipped, others proceed |

## Disabling retries only

`allowRetries` is independent. On a **writable** queue, `allowRetries: false` hides the retry buttons in the UI while leaving every other action in place:

```ts
new BullMQAdapter(emailQueue, { allowRetries: false });
```

Defaults to `true` on writable queues. When `readOnlyMode: true`, `allowRetries` is forced to `false`, the option is ignored since retries are themselves a destructive action.

To keep failed-job retries but hide the retry button on **completed** jobs, use `allowCompletedRetries: false` (BullMQ only):

```ts
new BullMQAdapter(emailQueue, { allowCompletedRetries: false });
```

It only takes effect while `allowRetries` is `true`. On `BullAdapter` it's always off, because Bull can't retry completed jobs.

::: warning
`allowRetries: false` only hides the retry buttons, it doesn't block the retry API endpoint. Anyone who knows the URL can still trigger a retry. Use `readOnlyMode: true` for real enforcement.
:::

## pg-boss boards

A [pg-boss board](/queue-adapters/pg-boss) has no queue adapters, so read-only mode is set on the whole board:

```ts
createPgBossBoard({
  serverAdapter,
  pgBoss: { connection: process.env.PGBOSS_READER_URL, schema: 'pgboss' },
  options: { readOnly: true },
});
```

(`readOnly: true` on a NestJS board with `engine: 'pg-boss'`, and `--read-only` on the CLI, do the same.)

It is stricter than a BullMQ queue's `readOnlyMode`: the mutation routes (send, retry, cancel, resume, delete, the bulk and per-queue commands, and schedule edits) are never registered, so a forged request gets **404**, not 405, and cannot tell that the route exists. The UI hides every control that changes something. Reading, including the schedule preview, keeps working.

Separately from `readOnly`, a pg-boss board turns writes off by itself when it cannot write safely, for instance when it only has a `connection` and the database is on a different pg-boss schema version from the pg-boss installed next to it. The routes are there then, but answer **409** `ERRORS.PGBOSS_WRITES_DISABLED` with the reason, and the UI shows it in a banner.

### A read-only PostgreSQL role

A read-only pg-boss board runs nothing but `SELECT`, so it can connect as a role that cannot write at all, which makes the guarantee hold at the database too:

```sql
CREATE ROLE wm_reader LOGIN PASSWORD 'change-me';
GRANT USAGE ON SCHEMA pgboss TO wm_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA pgboss TO wm_reader;
-- Tables pg-boss creates later (one per partitioned queue); run as the role that owns pgboss:
ALTER DEFAULT PRIVILEGES FOR ROLE app IN SCHEMA pgboss GRANT SELECT ON TABLES TO wm_reader;
```

Connect with that role through `connection` and pass no `instance`. See [the pg-boss page](/queue-adapters/pg-boss#a-read-only-postgresql-role).

## Source of truth

See `QueueAdapterOptions` in [`packages/api/typings/app.d.ts`](https://github.com/naldomadeira/worker-manager/blob/main/packages/api/typings/app.d.ts), the flag resolution in [`packages/api/src/queueAdapters/base.ts`](https://github.com/naldomadeira/worker-manager/blob/main/packages/api/src/queueAdapters/base.ts), and the 405 enforcement in [`packages/api/src/providers/queue.ts`](https://github.com/naldomadeira/worker-manager/blob/main/packages/api/src/providers/queue.ts).
