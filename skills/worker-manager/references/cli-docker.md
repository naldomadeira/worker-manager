# CLI and Docker reference

Source of truth: [CLI guide](https://naldomadeira.github.io/worker-manager/guide/cli),
[Docker guide](https://naldomadeira.github.io/worker-manager/guide/docker). Full flag list:
`npx @worker-manager/cli --help`.

Reach for these when there is no Node app to embed the board in, the workers are written in another
language (python-bullmq, Go, ...), or the user only wants to look at a queue. For a board inside the
user's own app, mount a server adapter instead.

## CLI (`@worker-manager/cli`, binary `worker-manager`, Node 20+)

```sh
npx @worker-manager/cli -r redis://localhost:6379                        # discovers Bull/BullMQ queues under prefix "bull"
npx @worker-manager/cli --postgres postgres://u:p@localhost:5432/bullmq    # BullMQ v6 queues in PostgreSQL
npx @worker-manager/cli --pg-boss postgres://u:p@localhost:5432/app        # pg-boss board (Node 22.12+)
npx @worker-manager/cli -r redis://localhost:6379 --pg-boss postgres://...  # BullMQ at /, pg-boss at /pg-boss/
```

| Need | Flags |
|---|---|
| Listen | `-p/--port` (3000), `--host` (127.0.0.1; `0.0.0.0` to expose), `--base-path`, `--no-open` |
| Discovery | `--prefix a,b`, `--queues a,b`, `--scan-interval <s>` |
| Redis topologies | `--sentinel h:p,... --sentinel-name <n>`, `--cluster h:p,...`, `--redis-username`, `--redis-password`, `--redis-db` |
| PostgreSQL / pg-boss | `--postgres-schema` (bullmq), `--pg-boss-schema` (pgboss), `--pg-boss-queues`, `--pg-boss-path` |
| Safety | `--read-only`, `--no-retry` (exit 1 when Redis is unreachable) |
| Basic auth | `--user <name> --password <pass>` |
| Keycloak | `--keycloak-url --keycloak-realm --keycloak-client-id [--keycloak-client-secret] [--keycloak-roles a,b] [--keycloak-bearer-only] [--public-url]` |
| Token | `--token t1,t2 [--token-header X-Board-Token] --session-secret <s>` |
| UI / history | `--board-title`, `--history`, `--history-retention-days` |
| Config file | `--config <file>`; otherwise `worker-manager.config.{mjs,js,cjs,json}` in the cwd |

Every flag has a `WORKER_MANAGER_*` env var, e.g. `WORKER_MANAGER_REDIS_URL`, `WORKER_MANAGER_USER`,
`WORKER_MANAGER_PASSWORD`, `WORKER_MANAGER_READ_ONLY`, `WORKER_MANAGER_TOKENS`,
`WORKER_MANAGER_SESSION_SECRET`, `WORKER_MANAGER_KEYCLOAK_URL`, `WORKER_MANAGER_POSTGRES_URL`,
`WORKER_MANAGER_PGBOSS_URL`, `WORKER_MANAGER_PGBOSS_SCHEMA`. Precedence: flags, env vars, config file.

Config file (`uiConfig` is the same object as in code; `queues` object form sets per-queue adapter options):

```js
// worker-manager.config.js
module.exports = {
  redis: 'redis://localhost:6379',
  prefix: ['bull', 'tenant-a'],
  uiConfig: { boardTitle: 'Ops Dashboard' },
  queues: { 'payment-webhooks': { readOnlyMode: true } },
  pgBoss: { host: 'db', user: 'app', password: process.env.PGPASSWORD, database: 'app', schema: 'pgboss' },
};
```

Scripts and agents can call the JSON API the UI uses:
`curl -s http://127.0.0.1:3000/api/queues | jq '.queues[] | {name, counts}'` (add the auth header
when auth is on).

## Docker (`ghcr.io/naldomadeira/worker-manager`)

The image is the CLI on `node:22-alpine` (so `--pg-boss` works), running as `node`, with
`WORKER_MANAGER_HOST=0.0.0.0`, `WORKER_MANAGER_OPEN=false` and a `HEALTHCHECK`. Anything after the
image name is a CLI flag. Pin the tag (`:latest`, a major, or an exact version) in production.

```sh
docker run --rm -p 127.0.0.1:3000:3000 \
  -e WORKER_MANAGER_USER=admin -e WORKER_MANAGER_PASSWORD="$BOARD_PASSWORD" \
  ghcr.io/naldomadeira/worker-manager --redis redis://host.docker.internal:6379
```

```yaml
services:
  worker-manager:
    image: ghcr.io/naldomadeira/worker-manager
    command: --redis redis://redis:6379 --history
    environment:
      WORKER_MANAGER_USER: ${WORKER_MANAGER_USER}
      WORKER_MANAGER_PASSWORD: ${WORKER_MANAGER_PASSWORD}
      # WORKER_MANAGER_PGBOSS_URL: postgres://app:secret@db:5432/app
    ports:
      - '127.0.0.1:3000:3000'
    depends_on: [redis]
```

On plain Docker Engine, reach a host Redis with `--add-host host.docker.internal:host-gateway`. A
config file mounted in `/app` is picked up without `--config`.
