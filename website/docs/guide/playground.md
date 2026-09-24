# Playground

The repository ships a playground, a small NestJS app in `playground/` that exercises the whole
stack before you wire the board into your own service. It exists to validate changes to the
library itself, and to show a complete, working setup you can copy from.

It brings up:

- **Redis** for six classic BullMQ queues (`notifications.*`, `payments.*`, `reports.generate`,
  `orders.pipeline`), with flows and two job schedulers.
- **PostgreSQL** for two BullMQ v6 queues stored in Postgres (`pg.invoices`, `pg.data-exports`).
- **Keycloak 26** with a pre-imported realm, a confidential client, and two users.
- **Synthetic traffic**: workers with random latency, progress, logs and failures, so every view
  of the board has something in it.

## Run it

```sh
yarn install && yarn build            # the playground links the local packages
yarn playground:infra                 # docker compose: redis :6390, postgres :5440, keycloak :8090
cp playground/.env.example playground/.env
yarn playground                       # http://localhost:3100/queues
```

Pick the auth mode with `WM_AUTH` in `playground/.env`:

| `WM_AUTH`  | How you get in                                                                  |
| ---------- | ------------------------------------------------------------------------------- |
| `none`     | Open access.                                                                    |
| `basic`    | Browser prompt, `admin` / `admin` (`WM_BASIC_USER`, `WM_BASIC_PASSWORD`).       |
| `keycloak` | Redirect to Keycloak. `admin` / `admin` has the `wm-admin` role and gets in; `viewer` / `viewer` is signed in but gets 403. |

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

It exits non-zero on the first failed check, so it can run in CI after `docker compose up --wait`.

## How it is wired

The whole integration is one module import. The adapter is detected from the running Nest app,
queues are registered at the root, and auth is a plain option:

```ts
BullBoardModule.forRoot({
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

See `playground/src/app.module.ts` for the switch between the three modes and
`playground/src/queues/` for the Redis and PostgreSQL queue setup.
