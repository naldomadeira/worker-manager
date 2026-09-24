# @worker-manager/cli

Run the [Worker Manager](https://github.com/naldomadeira/worker-manager) dashboard against a Redis instance or a PostgreSQL database holding BullMQ v6 queues, no app to wire it into.

```sh
npx @worker-manager/cli -r redis://localhost:6379
```

That opens `http://127.0.0.1:3000` with the dashboard for every Bull and BullMQ queue it finds under the `bull` key prefix.

![Worker Manager dashboard](https://raw.githubusercontent.com/naldomadeira/worker-manager/main/website/docs/public/screenshots/dashboard-overview.png)

## When you'd reach for this

- The workers live in a repo or a container you are not editing, and you want to watch jobs move without adding a route to an app you would then have to remember to remove.
- Your producers are not Node. BullMQ has an official Python package and gets written to over the raw protocol from other languages. Those teams have no app to embed the dashboard into.
- You want to look at a queue on staging or production through a tunnel, without deploying anything.
- You are evaluating Worker Manager and would rather see your own queues than wire up an integration first.

This is not a replacement for mounting an adapter in your own server: there's no auto-login, no framework-level auth to inherit, and every option has to be passed on the command line, an env var, or a config file instead of code.

## Options

```
Usage:
  worker-manager [options]
  npx @worker-manager/cli [options]

Options:
  -r, --redis <url>       Redis connection URL          [redis://localhost:6379]
      --sentinel <list>   Comma separated sentinel host:port list, port [26379]
      --sentinel-name <n> Redis master group name, required with --sentinel
      --sentinel-password <pass>
                          Password for the sentinel nodes themselves
      --redis-username <name>
                          Username for the Redis nodes behind the sentinels
      --redis-password <pass>
                          Password for the Redis nodes behind the sentinels
      --redis-db <n>      Database to select behind the sentinels
  -p, --port <port>       Port to listen on             [3000]
      --host <address>    Interface to bind             [127.0.0.1]
      --prefix <list>     Comma separated key prefixes  [bull]
      --queues <list>     Use these queue names instead of discovering
      --scan-interval <s> Seconds between rescans, 0 to scan once  [10]
      --base-path <path>  Serve the dashboard under a path prefix
      --read-only         Disable every destructive action
      --user <name>       Basic auth user (requires --password)
      --password <pass>   Basic auth password (requires --user)
      --keycloak-url <url>
                          Log in through Keycloak (OIDC) instead, e.g.
                          https://sso.example.com
      --keycloak-realm <realm>
                          Keycloak realm, required with --keycloak-url
      --keycloak-client-id <id>
                          Client id, required with --keycloak-url
      --keycloak-client-secret <secret>
                          Client secret, for confidential clients
      --keycloak-roles <list>
                          Comma separated realm/client roles, any grants access
      --keycloak-bearer-only
                          Accept only Authorization: Bearer tokens, no login page
      --public-url <url>  External URL of the board, base path included, used
                          for the OIDC redirect URI     [derived from the request]
      --session-secret <s>
                          Key the session cookie is encrypted with
                                                        [--keycloak-client-secret]
      --postgres <url>    Also serve BullMQ v6 queues stored in PostgreSQL
                          (postgres://user:pass@host:5432/db)
      --postgres-schema <name>
                          Schema the BullMQ tables live in       [bullmq]
      --board-title <s>   Dashboard title
      --history           Record and serve long-retention metrics history
      --history-retention-days <n>
                          Days of history to keep            [90]
      --config <file>     Path to a config file
      --browser <command> Command to open the browser with     [$BROWSER]
      --no-open           Do not open a browser
      --no-retry          Exit if Redis is unreachable instead of retrying
  -h, --help              Show this help
  -v, --version           Show the version
```

Every flag also has an environment variable equivalent (`WORKER_MANAGER_REDIS_URL`, `WORKER_MANAGER_PORT`, `WORKER_MANAGER_READ_ONLY`, `WORKER_MANAGER_KEYCLOAK_URL`, `WORKER_MANAGER_POSTGRES_URL`, and so on), and a `worker-manager.config.{mjs,js,cjs,json}` file for anything that doesn't fit on a command line. Flags win over environment variables, which win over the config file, which wins over the built-in default.

If Redis is unreachable when the CLI starts, it still opens: it serves a diagnostic page explaining why (the URL it dialled, the underlying error, and the likely causes), keeps retrying every 3 seconds, and switches to the real dashboard on its own the moment Redis answers, no restart needed. That only covers startup, though: once the dashboard is live it stays live, even if Redis later goes away. The diagnostic page does not come back; API requests just stop returning until Redis is reachable again, and Ctrl-C still works. Pass `--no-retry` for the old behaviour instead: print the error and exit 1 immediately, without ever opening a port, which is what a script or CI checking the exit code wants.

```js
// worker-manager.config.js
module.exports = {
  redis: 'redis://localhost:6379',
  prefix: ['bull', 'tenant-a'],
  uiConfig: {
    boardTitle: 'Ops Dashboard',
  },
  queues: {
    'payment-webhooks': { readOnlyMode: true },
  },
};
```

## Keycloak auth

Instead of Basic auth, the CLI can put a Keycloak (OpenID Connect) login in front of the dashboard, through [`@worker-manager/auth`](https://www.npmjs.com/package/@worker-manager/auth):

```sh
npx @worker-manager/cli -r redis://localhost:6379 --host 0.0.0.0 \
  --keycloak-url https://sso.example.com --keycloak-realm ops \
  --keycloak-client-id worker-manager --keycloak-client-secret "$KEYCLOAK_SECRET" \
  --keycloak-roles wm-admin \
  --public-url https://queues.example.com --session-secret "$SESSION_SECRET"
```

Browsers are redirected to the Keycloak login page (authorization code flow with PKCE) and come back with an encrypted, `HttpOnly` session cookie that is refreshed silently while the refresh token lasts. Scripts can skip the browser and send `Authorization: Bearer <access token>` instead; `--keycloak-bearer-only` turns the login page off entirely. A user without one of `--keycloak-roles` (realm roles or client roles) gets a 403.

Register `<public url>/auth/callback` as a valid redirect URI on the Keycloak client and `<public url>/` as a valid post logout redirect URI. Without `--public-url` the URL is derived from the request's `Host` and `X-Forwarded-*` headers. Set `--session-secret` whenever more than one CLI process serves the same board, or sessions will not survive a restart. `--user`/`--password` and `--keycloak-url` are mutually exclusive.

In a config file, the same settings live under `keycloak`, with the option names of [`@worker-manager/auth`](https://www.npmjs.com/package/@worker-manager/auth):

```js
module.exports = {
  keycloak: {
    url: 'https://sso.example.com',
    realm: 'ops',
    clientId: 'worker-manager',
    clientSecret: process.env.KEYCLOAK_SECRET,
    requiredRoles: ['wm-admin'],
    cookie: { secret: process.env.SESSION_SECRET },
  },
};
```

## PostgreSQL queues

BullMQ v6 can store queues in PostgreSQL. `--postgres` serves them:

```sh
npx @worker-manager/cli --postgres postgres://bullmq:bullmq@localhost:5432/bullmq
```

Queue names are discovered from the tables of BullMQ's PostgreSQL schema (`bullmq` by default, `--postgres-schema` to change it), on the same `--scan-interval` as Redis discovery, or taken from `--queues`. The CLI bundles its own BullMQ v6 and `pg` for this, whatever BullMQ version your workers run.

With no Redis source configured (no `--redis`, `--sentinel`, `--cluster`, their environment variables, or a `redis` entry in the config file), the board serves PostgreSQL only and never connects to Redis. With one, it serves both on the same board; a PostgreSQL outage then keeps the last known PostgreSQL queues on the board instead of taking the Redis ones down. `--history` records into Redis when there is one; on a PostgreSQL-only board it records into PostgreSQL instead, in `worker_manager_metrics_*` tables in the `--postgres-schema` schema, which it creates on start unless the board is `--read-only`. A read-only board serves what another process recorded.

In a config file, `postgres` takes the URL, or a [node-postgres pool config](https://node-postgres.com/apis/pool) with an optional `schema`:

```js
module.exports = {
  postgres: { host: 'db', user: 'bullmq', password: process.env.PGPASSWORD, database: 'jobs', schema: 'bullmq' },
};
```

## Redis Sentinel

`--sentinel` connects through Redis Sentinel rather than to one instance directly, for a deployment where the master address is not fixed:

```sh
npx @worker-manager/cli --sentinel s1.internal:26379,s2.internal:26379 --sentinel-name mymaster
```

A port is optional per entry and defaults to 26379. `--sentinel-name` is the master group name from your sentinel configuration and is required. `--sentinel` and `--redis` are mutually exclusive, and passing both is an error rather than a silent preference for one.

ioredis resolves the current master through the sentinels listed and follows a failover on its own, so the whole dashboard moves with it: queue reads, the Bull subscriber, and `--history` recording all share the one connection.

Credentials in sentinel mode come from their own flags, since there is no URL to carry them. `--redis-username`, `--redis-password` and `--redis-db` apply to the Redis nodes behind the sentinels, while `--sentinel-password` authenticates to the sentinel nodes themselves, which commonly have a different password. Passing any of them alongside a Redis URL is an error, because ioredis would take the URL's own credentials and ignore them.

For anything beyond that, including TLS to the sentinel nodes, the config file's `redis` key accepts a full [ioredis options object](https://github.com/redis/ioredis#connect-to-redis) and is passed through untouched:

```js
// worker-manager.config.js
module.exports = {
  redis: {
    sentinels: [
      { host: 's1.internal', port: 26379 },
      { host: 's2.internal', port: 26379 },
    ],
    name: 'mymaster',
    sentinelPassword: process.env.SENTINEL_PASSWORD,
    enableTLSForSentinelMode: true,
  },
};
```

## Historical metrics

`--history` turns on the long-retention metrics that otherwise need `@worker-manager/metrics` wired into an app of your own:

```sh
npx @worker-manager/cli -r redis://localhost:6379 --history
```

Every queue chart gains a 60m / 7d / 30d / 90d range selector, and a cross-queue Metrics history page shows up in the sidebar. The CLI process does the recording itself, copying throughput, wait time, run time and queue age into Redis once a minute under the `worker-manager:metrics:` namespace, never over a key Bull or BullMQ owns. Recording follows discovery, so a queue that appears between rescans is picked up on the next tick.

`--history-retention-days` sets the window, 90 days by default. Per-tier retention, the snapshot interval and `latency: false` go in the config file under a `history` key. `--read-only` keeps the reading and stops the writing, for a board that only displays what another process records.

Completed and failed history comes out of BullMQ's own metrics buffer, so it stays empty unless your workers were built with `metrics: { maxDataPoints: MetricsTime.ONE_WEEK }`; the CLI warns at startup when no discovered queue has any. Latency and queue age need nothing from your workers. See the [historical metrics recipe](https://naldomadeira.github.io/worker-manager/recipes/historical-metrics) for storage sizing and what the charts show.

## Docker

```sh
docker run --rm -p 127.0.0.1:3000:3000 \
  -e WORKER_MANAGER_USER=admin -e WORKER_MANAGER_PASSWORD=secret \
  ghcr.io/naldomadeira/worker-manager --redis redis://host.docker.internal:6379
```

`ghcr.io/naldomadeira/worker-manager` is this package as an image, built for amd64 and arm64 on every release and tagged with the exact version, the major, and `latest`. The entrypoint is the CLI, so flags and `WORKER_MANAGER_*` variables work exactly as they do above. The only things the image decides for you are `WORKER_MANAGER_HOST=0.0.0.0` and `WORKER_MANAGER_OPEN=false`, the two defaults that make no sense in a container, and you can override both. [Run with Docker](https://naldomadeira.github.io/worker-manager/guide/docker) covers Compose, tags and mounting a config file.

Discovery only reads Redis, so BullMQ v6 queues backed by PostgreSQL aren't found here; use a server adapter in your own app for those. `--prefix` doesn't take wildcards either, list the prefixes you need explicitly.

See the [CLI guide](https://naldomadeira.github.io/worker-manager/guide/cli) for the full flag and environment variable reference and the basic auth walkthrough.
