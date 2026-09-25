# Playground

The repository ships a playground, a small NestJS app in `playground/` that exercises the whole
stack before you wire the board into your own service. It exists to validate changes to the
library itself, and to show a complete, working setup you can copy from.

It brings up:

- **Redis** for six classic BullMQ queues (`notifications.*`, `payments.*`, `reports.generate`,
  `orders.pipeline`), with flows and two job schedulers.
- **PostgreSQL** for two BullMQ v6 queues stored in Postgres (`pg.invoices`, `pg.data-exports`).
- **A second board over pg-boss** at `/pg-boss` (experimental), on a `pgboss` schema in the same
  PostgreSQL. See [the pg-boss board](#the-pg-boss-board).
- **Keycloak 26** with a pre-imported realm, a confidential client, and two users.
- **Synthetic traffic**: workers with random latency, progress, logs and failures, so every view
  of the board has something in it.

## Run it

```sh
yarn install && yarn build            # the playground links the local packages
yarn playground:infra                 # docker compose: redis :6390, postgres :5440, keycloak :8090
cp playground/.env.example playground/.env
yarn playground                       # http://localhost:3100/queues and /pg-boss
```

Pick the auth mode with `WM_AUTH` in `playground/.env`:

| `WM_AUTH`  | How you get in                                                                  |
| ---------- | ------------------------------------------------------------------------------- |
| `none`     | Open access.                                                                    |
| `basic`    | Browser prompt, `admin` / `admin` (`WM_BASIC_USER`, `WM_BASIC_PASSWORD`).       |
| `keycloak` | Redirect to Keycloak. `admin` / `admin` has the `wm-admin` role and gets in; `viewer` / `viewer` is signed in but gets 403. |

Both boards share the auth mode and the credentials above. Under Keycloak each board has a session
of its own: the named pg-boss board sets `wm_session_pgboss`, so signing in to one does not sign you
in to, or out of, the other.

Other switches in `playground/.env`:

| Variable      | Default                           | Effect                                                                                     |
| ------------- | --------------------------------- | ------------------------------------------------------------------------------------------ |
| `WM_PGBOSS`   | `true` when `POSTGRES_URL` is set | Mounts the pg-boss board and its traffic. `false`, or an empty `POSTGRES_URL`, leaves it out. |
| `WM_READONLY` | `false`                           | Both boards read-only. The pg-boss board then does not register its mutation routes.       |
| `WM_TRAFFIC`  | `true`                            | Workers and producers on both engines. `false` freezes the boards for inspection.          |

![Keycloak login in front of the board](/screenshots/keycloak-login.png)

## Validate it

With the app running, `yarn workspace @worker-manager/playground smoke` checks the board against
the mode it reports on `/health`:

- `basic`: 401 plus a `WWW-Authenticate` challenge without credentials, 401 with a wrong
  password, 200 with the right one, and `/auth/me` names the user.
- `keycloak`: navigations redirect to Keycloak with PKCE S256, the API answers
  `401 { error: { key: 'ERRORS.UNAUTHORIZED' } }` without a session, a `wm-admin` bearer token
  gets through, a user without the role gets `403 ERRORS.FORBIDDEN`, and `/auth/me` reports the
  Keycloak profile.
- Every mode: both Redis and PostgreSQL queues are listed.
- Every mode, when `/health` reports `pgBoss: true`: `/pg-boss` answers per the mode (HTML, 401
  or a 302 to Keycloak), `/pg-boss/api/pg-boss/queues` lists the four queues with their policies
  and the dead letter queue, `/pg-boss/api/pg-boss/info` reports `writable: true`, both schedules
  are listed, and a job goes through send, cancel, resume and delete. With `WM_READONLY=true`,
  `info` reports `readOnly: true` and the mutations answer 404.

It exits non-zero on the first failed check, so it can run in CI after `docker compose up --wait`.

## How it is wired

The whole integration is one module import. The adapter is detected from the running Nest app,
queues are registered at the root, and auth is a plain option:

```ts
WorkerManagerModule.forRoot({
  route: '/queues',
  auth: {
    strategy: 'keycloak',
    url: 'http://localhost:8090',
    realm: 'worker-manager',
    clientId: 'worker-manager-board',
    clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
    requiredRoles: ['wm-admin'],
    publicUrl: 'http://localhost:3100',
    cookie: { secret: process.env.WM_COOKIE_SECRET, secure: false },
  },
  title: 'Worker Manager Playground',
  uiConfig: { environment: { label: 'playground', color: '#6366f1' } },
  queues: allQueues.map((queue) => ({ queue, adapter: BullMQAdapter })),
});
```

## The pg-boss board

`playground/src/pgboss/` creates the app's own `PgBoss` with `migrate: true` on the playground's
PostgreSQL, schema `pgboss`, and starts it before the app listens. It creates five queues and two
schedules:

| Queue                  | Policy      | Behaviour                                                                  |
| ---------------------- | ----------- | -------------------------------------------------------------------------- |
| `mail.send`            | `standard`  | 3 retries with backoff; also gets deferred reminders (`startAfter: 60`)    |
| `reports.nightly`      | `singleton` | One active at a time, slow jobs; cron schedule `*/2 * * * *`               |
| `billing.sync`         | `stately`   | Keyed per customer, so most sends are dropped by pg-boss on purpose        |
| `payments.capture`     | `standard`  | 1 retry, then dead-letters into `payments.dead-letter`                     |
| `payments.dead-letter` | `standard`  | No worker, so what lands there stays visible                               |

`mail.send` also has an RRULE schedule, `FREQ=MINUTELY;INTERVAL=3`. Workers fail at random, so
the board shows `retry`, `failed` and dead-lettered jobs next to `completed` ones.

The board is a second, named `WorkerManagerModule.forRoot()`. It takes the started instance, plus
a `connection` so reads get a server-side `statement_timeout`:

```ts
WorkerManagerModule.forRoot({
  name: 'pgboss',
  route: '/pg-boss',
  engine: 'pg-boss',
  auth: boardAuth(),
  uiConfig: { miscLinks: [{ text: 'BullMQ board', url: '/queues' }] },
  pgBoss: { instance: pgBoss, connection: process.env.POSTGRES_URL, schema: 'pgboss', delimiter: '.' },
});
```

Each board has a `miscLinks` entry pointing at the other. See
[the NestJS pg-boss board](../server-adapters/nestjs.md#pg-boss-board-experimental) for every
option.

See `playground/src/app.module.ts` for the switch between the three modes and
`playground/src/queues/` for the Redis and PostgreSQL queue setup.
