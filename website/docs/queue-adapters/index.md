# Queue engines

A board runs one **engine**. The BullMQ engine is the default and has been there all along: it drives Bull, BullMQ and BullMQ Pro queues through queue adapters, on Redis or on PostgreSQL. The pg-boss engine is new and experimental: it mounts a board over a pg-boss schema, with pages of its own. The shell around them (sidebar, command palette, themes, auth, server adapters, NestJS module, CLI) is the same.

| Queue system | Engine | Entry point | Docs |
|-------------|--------|-------------|------|
| Bull | BullMQ | `BullAdapter` | [Bull →](/queue-adapters/bull) |
| BullMQ (Redis, or PostgreSQL on v6) | BullMQ | `BullMQAdapter` | [BullMQ →](/queue-adapters/bullmq) |
| BullMQ Pro | BullMQ | `BullMQProAdapter` | [BullMQ Pro →](/queue-adapters/bullmq-pro) |
| pg-boss (experimental) | pg-boss | `createPgBossBoard` | [pg-boss →](/queue-adapters/pg-boss) |

The rest of this page is about the BullMQ engine's queue adapters, which `@worker-manager/api` ships with; third-party queue systems can add their own. The pg-boss engine takes no queue adapters: it lists the queues of its schema itself. See [its page](/queue-adapters/pg-boss).

`BullMQProAdapter` extends `BullMQAdapter` to handle [Pro groups](https://docs.bullmq.io/bullmq-pro/introduction). All `BullMQAdapter` options work the same way on it.

`BullMQAdapter` covers BullMQ v5 and v6, including [v6 queues stored in PostgreSQL](/recipes/postgres-backend). See [supported versions](/queue-adapters/bullmq#supported-versions) for the two differences you can see in the UI.

## Capabilities

What the board offers depends on what the library behind a queue can do. Each BullMQ-engine queue reports it in `capabilities` on `GET /api/queues` (from the adapter's `getCapabilities()`), and the UI shows a control only when its capability is on, rather than switching on the library name. A pg-boss board reports its own set in `capabilities` on `GET /api/pg-boss/info`.

| | Bull | BullMQ on Redis | BullMQ on PostgreSQL | BullMQ Pro | pg-boss |
|---|---|---|---|---|---|
| Pause and resume a queue | Yes | Yes | Yes | Yes | No |
| Paused tab | Yes | v5 only | No | Like the BullMQ it runs on | No |
| Job logs | Yes | Yes | Yes | Yes | No |
| Job progress | Yes | Yes | Yes | Yes | No |
| Flows | No | Graph | Graph | Graph | Dependency lists |
| Promote a delayed job | Yes | Yes | Yes | Yes | No |
| Edit a job's data | Yes | Yes | Yes | Yes | No |
| Change a job's priority | No | Yes | Yes | Yes | No |
| Remove a parent's unprocessed children | No | Yes | Yes | Yes | No |
| Retry a failed job | Yes | Yes | Yes | Yes | Yes |
| Retry a completed job | No | Yes | Yes | Yes | No |
| Cancel and resume a job | No | No | No | No | Yes |
| Global concurrency | No | Yes | Yes | Yes | No |
| Configured rate limit | No | When the queue has `setGlobalRateLimit` | When the queue has `setGlobalRateLimit` | When the queue has `setGlobalRateLimit` | No |
| Workers panel | Yes | Yes | Yes, from `pg_stat_activity` | Yes | No |
| Throughput chart (the library's own metrics) | Yes | Yes | Yes | Yes | No |
| [Historical metrics](/recipes/historical-metrics) | No | Yes | Yes | Yes | Yes |
| Schedules | Repeatable jobs, remove only | Job schedulers (`every`, cron): edit, run now, remove | Job schedulers: edit, run now, remove | Job schedulers: edit, run now, remove | Cron and RRULE: create, edit, run now, remove |
| Datastore panel | Redis `INFO` | Redis `INFO` | PostgreSQL | Redis `INFO` | PostgreSQL and the pg-boss schema |
| Groups | No | No | No | Yes | No |

A few notes on the table:

- **Paused tab.** BullMQ v6 dropped the paused job state, on Redis and on PostgreSQL alike: a paused queue's jobs are stored as `waiting`. The queue still shows its paused banner and the buttons still work.
- **Rescheduling a delayed job** is offered on every BullMQ-engine queue. Bull cannot do it and answers the request with `ERRORS.JOB_EDIT_NOT_SUPPORTED`.
- **Workers panel.** Turned off everywhere by `showWorkers: false`.
- **pg-boss** has states BullMQ does not (`retry`, `cancelled`) and none of pause, logs, progress, workers or rate limits. See [what does not exist there](/queue-adapters/pg-boss#what-does-not-exist-here).

## Shared options

All BullMQ-engine adapters accept the same optional options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `readOnlyMode` | `boolean` | `false` | Hides all queue and job actions. |
| `allowRetries` | `boolean` | `true` | Shows or hides the retry buttons on **failed** jobs. Forced to `false` when `readOnlyMode` is `true`. |
| `allowCompletedRetries` | `boolean` | `true` | Shows or hides the retry button on **completed** jobs. Only takes effect when `allowRetries` is `true`. Always `false` on `BullAdapter` (Bull can't retry completed jobs). |
| `description` | `string` | `''` | Queue description text displayed in the UI. |
| `displayName` | `string` | `''` | Overrides the queue name shown in the UI. |
| `prefix` | `string` | `''` | Prepended to job names in the UI. |
| `delimiter` | `string` | `''` | Delimiter between the prefix and the job name. |
| `externalJobUrl` | `(job) => { href, displayText? }` | none | Links each job card to a page in your own app. See [External job URLs](/recipes/external-job-url). |
| `jobDataSchema` | `object` (JSON Schema) | none | Describes the shape of a job's `data`. Drives the **Add job** form: prefills the editor with a starting value and turns on schema-aware autocomplete and validation. See [Job data schema](#job-data-schema). |

## Job data schema

Pass a [JSON Schema](https://json-schema.org/) as `jobDataSchema` to teach the dashboard what a queue's job `data` looks like. The **Add job** form then does three things with it:

- **Prefills** the job data editor with a starting value: the schema's `default`, otherwise its first `examples` entry, otherwise a skeleton built from `properties` (each key seeded with its own `default` or a typed placeholder).
- **Autocompletes** the expected keys as you type, with any `description` shown on hover.
- **Validates** the JSON against the schema inline, flagging missing required fields, wrong types, and unknown keys before you submit.

```ts
new BullMQAdapter(resetPassword, {
  jobDataSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['userId', 'email'],
    properties: {
      userId: { type: 'string', description: 'Internal id of the user requesting the reset.' },
      email: { type: 'string', format: 'email', description: 'Address the reset link is sent to.' },
      locale: { type: 'string', description: 'BCP-47 locale for the email template.', default: 'en' },
    },
  },
});
```

![The Add job form prefilled from a queue's job data schema](/screenshots/add-job-schema.png)

The schema is documentation for the dashboard only. It is not enforced by Bull or BullMQ, so keep it in step with what your worker actually expects.

## Instance methods

All adapters expose `setFormatter` and `setVisibilityGuard`:

```ts
adapter.setFormatter('name', (job) => `#${job.name}`);
adapter.setFormatter('data', (data) => redact(data));
adapter.setFormatter('returnValue', (value) => redact(value));
adapter.setFormatter('progress', (progress) => `${Math.round(progress)}%`);

adapter.setVisibilityGuard((request) => {
  // return true to show this queue, false to hide it
  return request.headers['x-tenant-id'] === 'acme';
});
```

## Mixing adapters

You can mix Bull and BullMQ queues in the same board. pg-boss queues cannot join them: a pg-boss board is a board of its own, which can sit [next to this one](/recipes/multiple-dashboards#bullmq-and-pg-boss-side-by-side).

```ts
createWorkerManagerBoard({
  queues: [
    new BullAdapter(bullQueue),
    new BullMQAdapter(bullmqQueue),
    new BullMQProAdapter(bullmqProQueue),
  ],
  serverAdapter,
});
```
