# Worker Manager playground

A NestJS app that validates the library end to end: BullMQ queues on Redis and on PostgreSQL,
Basic and Keycloak auth, and live synthetic traffic. Full guide:
[website/docs/guide/playground.md](../website/docs/guide/playground.md).

```sh
# from the repo root
yarn install && yarn build
yarn playground:infra                    # redis :6390, postgres :5440, keycloak :8090
cp playground/.env.example playground/.env
yarn playground                          # http://localhost:3100/queues
yarn workspace @worker-manager/playground smoke   # asserts the auth mode in .env
```

| `WM_AUTH`  | Credentials                                                                |
| ---------- | -------------------------------------------------------------------------- |
| `none`     | none                                                                       |
| `basic`    | `admin` / `admin`                                                          |
| `keycloak` | `admin` / `admin` (role `wm-admin`), `viewer` / `viewer` (gets 403)        |

Keycloak admin console: http://localhost:8090 (`admin` / `admin`). The realm lives in
`keycloak/worker-manager-realm.json` and is imported on every start.

`yarn workspace @worker-manager/playground infra:down` stops the stack and drops its volumes.
