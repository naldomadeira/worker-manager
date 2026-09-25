# Worker Manager playground

A NestJS app that validates the library end to end: BullMQ queues on Redis and on PostgreSQL,
a second board over a pg-boss schema, Basic and Keycloak auth, and live synthetic traffic. Full guide:
[website/docs/guide/playground.md](../website/docs/guide/playground.md).

```sh
# from the repo root
yarn install && yarn build
yarn playground:infra                    # redis :6390, postgres :5440, keycloak :8090
cp playground/.env.example playground/.env
yarn playground                          # http://localhost:3100/queues and /pg-boss
yarn workspace @worker-manager/playground smoke   # asserts the auth mode in .env
```

| `WM_AUTH`  | Credentials                                                                |
| ---------- | -------------------------------------------------------------------------- |
| `none`     | none                                                                       |
| `basic`    | `admin` / `admin`                                                          |
| `keycloak` | `admin` / `admin` (role `wm-admin`), `viewer` / `viewer` (gets 403)        |

Both boards use the same `WM_AUTH` mode and the same credentials. Under Keycloak each board keeps
its own session: the pg-boss board's cookie is `wm_session_pgboss`, the BullMQ board's is
`wm_session`.

| Variable      | Default                      | Effect                                                                                             |
| ------------- | ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `WM_PGBOSS`   | `true` when `POSTGRES_URL` is set | Mounts the pg-boss board at `/pg-boss` (schema `pgboss`, installed with `migrate: true`) and its traffic |
| `WM_READONLY` | `false`                      | Both boards read-only; the pg-boss mutation routes are not registered and answer 404               |
| `WM_TRAFFIC`  | `true`                       | Workers and producers on both engines                                                              |

pg-boss queues: `mail.send` (standard, 3 retries with backoff), `reports.nightly` (singleton),
`billing.sync` (stately, keyed per customer), `payments.capture` (1 retry, then dead-letters into
`payments.dead-letter`, which has no worker so its jobs stay visible). Schedules: a cron on
`reports.nightly` (`*/2 * * * *`) and an RRULE on `mail.send` (`FREQ=MINUTELY;INTERVAL=3`).

Keycloak admin console: http://localhost:8090 (`admin` / `admin`). The realm lives in
`keycloak/worker-manager-realm.json` and is imported on every start.

`yarn workspace @worker-manager/playground infra:down` stops the stack and drops its volumes.
