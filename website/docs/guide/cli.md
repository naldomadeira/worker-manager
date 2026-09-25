# Standalone CLI

Sometimes you don't want to wire Worker Manager into an app at all, you just want to look at a Redis instance (or a PostgreSQL database holding BullMQ v6 queues). `@worker-manager/cli` does that: point it at a Redis URL and it finds the Bull and BullMQ queues stored there, then serves the same dashboard UI you'd get from any server adapter. See [PostgreSQL queues](#postgresql-queues) for the database side.

```sh
npx @worker-manager/cli -r redis://localhost:6379
```

It needs Node.js 20 or newer. That starts the dashboard on `http://127.0.0.1:3000` and opens it in a browser. This is a tool for local development, evaluating Worker Manager before wiring it into your app, or looking at a queue on infrastructure you've tunnelled to. It is not a replacement for mounting the adapter in your own server: there's no framework-level auth to inherit (though it has [Basic](#basic-auth) and [Keycloak](#keycloak-auth) auth built in), and every option has to be passed on the command line, an env var, or a config file instead of code.

## Discovery

On startup the CLI scans Redis for keys matching `<prefix>:<queue-name>:meta` (BullMQ) and `<prefix>:<queue-name>:id` (Bull) under each configured prefix, and builds a real `Queue` instance for every queue it finds. The default prefix is `bull`, which is what Bull and BullMQ both use unless you've changed it yourself. If your queues use a different prefix, pass `--prefix`.

By default it rescans every 10 seconds, so a queue created after the dashboard started still shows up without a restart. Pass `--scan-interval 0` to scan once at startup and stop.

If you'd rather skip discovery entirely, `--queues` takes an explicit, comma separated list of queue names to serve. The CLI still has to work out whether each one is Bull or BullMQ, but it no longer scans Redis for anything else under the prefix.

## When Redis isn't reachable

The dashboard still opens even if Redis is down or the URL is wrong. Instead of a dead terminal, `npx @worker-manager/cli` serves a diagnostic page at the same URL, explaining what it tried to connect to, the underlying error, and the likely cause: Redis isn't running, the port is wrong (6379 is the default), it's in a container whose port isn't published, it needs credentials, or it needs TLS and therefore a `rediss://` URL. A `--user`/`--password` you've set still guards this page: the URL it names is never served to a request without the right credentials.

The process stays alive and keeps retrying every 3 seconds. The page polls its own status and reloads on its own the moment Redis answers, switching to the real dashboard with no restart and no second command.

That healing only applies before the first successful connection. Once the dashboard is live, it stays live for the rest of the process, even if Redis goes away later: the diagnostic page does not come back, and the dashboard's own API requests simply stop returning until Redis is reachable again. Ctrl-C still works during that window; the CLI's shutdown is bounded so it never hangs waiting on a dead connection.

A second, rarer page shows up if the CLI reaches Redis but something after that fails for a reason that has nothing to do with connectivity, such as an ACL-restricted user that can authenticate but not run `SCAN`. That page names the real error too, but does not promise a retry, since reconnecting again would not fix it; restart the CLI once the underlying problem is addressed.

For scripts and CI, retrying forever is the wrong default: they want a non-zero exit code, not a process that waits indefinitely. Pass `--no-retry` and the CLI prints the error and exits 1 as soon as the first connection attempt fails, without ever opening a port.

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
      --cluster <list>    Comma separated cluster host:port list, port [6379]
      --redis-username <name>
                          Username for the Redis nodes behind the sentinels
                          or in the cluster
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
      --pg-boss <url>     Serve a pg-boss board (experimental, Node >= 22.12)
                          (postgres://user:pass@host:5432/db)
      --pg-boss-schema <name>
                          Schema pg-boss was installed in        [pgboss]
      --pg-boss-queues <list>
                          Comma separated pg-boss queues to show [all]
      --pg-boss-path <path>
                          Where the pg-boss board is served next to a
                          BullMQ board                           [/pg-boss]
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

## Environment variables

Every flag has an environment variable equivalent, so you can configure the CLI in a container or a systemd unit without a command line to edit:

| Flag | Environment variable |
|---|---|
| `--redis` | `WORKER_MANAGER_REDIS_URL` |
| `--sentinel` | `WORKER_MANAGER_SENTINELS` |
| `--sentinel-name` | `WORKER_MANAGER_SENTINEL_NAME` |
| `--sentinel-password` | `WORKER_MANAGER_SENTINEL_PASSWORD` |
| `--cluster` | `WORKER_MANAGER_CLUSTER_NODES` |
| `--redis-username` | `WORKER_MANAGER_REDIS_USERNAME` |
| `--redis-password` | `WORKER_MANAGER_REDIS_PASSWORD` |
| `--redis-db` | `WORKER_MANAGER_REDIS_DB` |
| `--port` | `WORKER_MANAGER_PORT` |
| `--host` | `WORKER_MANAGER_HOST` |
| `--prefix` | `WORKER_MANAGER_PREFIX` |
| `--queues` | `WORKER_MANAGER_QUEUES` |
| `--scan-interval` | `WORKER_MANAGER_SCAN_INTERVAL` |
| `--base-path` | `WORKER_MANAGER_BASE_PATH` |
| `--read-only` | `WORKER_MANAGER_READ_ONLY` |
| `--user` | `WORKER_MANAGER_USER` |
| `--password` | `WORKER_MANAGER_PASSWORD` |
| `--keycloak-url` | `WORKER_MANAGER_KEYCLOAK_URL` |
| `--keycloak-realm` | `WORKER_MANAGER_KEYCLOAK_REALM` |
| `--keycloak-client-id` | `WORKER_MANAGER_KEYCLOAK_CLIENT_ID` |
| `--keycloak-client-secret` | `WORKER_MANAGER_KEYCLOAK_CLIENT_SECRET` |
| `--keycloak-roles` | `WORKER_MANAGER_KEYCLOAK_ROLES` |
| `--keycloak-bearer-only` | `WORKER_MANAGER_KEYCLOAK_BEARER_ONLY` |
| `--public-url` | `WORKER_MANAGER_PUBLIC_URL` |
| `--session-secret` | `WORKER_MANAGER_SESSION_SECRET` |
| `--postgres` | `WORKER_MANAGER_POSTGRES_URL` |
| `--postgres-schema` | `WORKER_MANAGER_POSTGRES_SCHEMA` |
| `--pg-boss` | `WORKER_MANAGER_PGBOSS_URL` |
| `--pg-boss-schema` | `WORKER_MANAGER_PGBOSS_SCHEMA` |
| `--pg-boss-queues` | `WORKER_MANAGER_PGBOSS_QUEUES` |
| `--pg-boss-path` | `WORKER_MANAGER_PGBOSS_PATH` |
| `--board-title` | `WORKER_MANAGER_BOARD_TITLE` |
| `--history` | `WORKER_MANAGER_HISTORY` |
| `--history-retention-days` | `WORKER_MANAGER_HISTORY_RETENTION_DAYS` |
| `--no-open` | `WORKER_MANAGER_OPEN` (set to `false` to skip the browser; `--no-open` always wins) |
| `--no-retry` | `WORKER_MANAGER_NO_RETRY` |
| `--browser` | `WORKER_MANAGER_BROWSER`, then `BROWSER` |
| `--config` | `WORKER_MANAGER_CONFIG` |

Settings resolve in this order: a command line flag wins, then the matching environment variable, then the config file, then the built-in default. That applies field by field, so you can set a Redis URL in the environment and still override just the port with a flag on one particular run.

`--browser` picks the command used to open the dashboard. Three things can name it, and they win in this order: `--browser` on the command line, then `WORKER_MANAGER_BROWSER`, then a plain exported `$BROWSER`. `WORKER_MANAGER_BROWSER` exists so you can set one for the CLI without touching `$BROWSER` globally. With none of them set, the CLI falls back to the platform opener: `open` on macOS, `start` on Windows, `xdg-open` elsewhere.

A `browser` key in the config file sits below all three, because the config file is the last step in the resolution order above. That is worth knowing: an exported `$BROWSER` left over from another tool silently overrides a `browser` you set in the config file.

A command with arguments works too, for example `--browser 'open -a Safari'`. The value is split on whitespace and the URL is appended as the last argument, and it never goes through a shell, on any platform, Windows included.

Because the split is on whitespace, a single path that contains spaces does not survive it. The common macOS form `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, and CRA's `BROWSER="google chrome"`, both break: every word after the first is treated as an argument to a command that does not exist at that path. It does not quietly fall back to the platform opener either. It fails to spawn, exactly as naming any other uninstalled command would, and the CLI prints "Could not open a browser automatically" and leaves you to open the URL yourself.

`--no-open` skips opening a browser at all, whatever `--browser` or `$BROWSER` say.

## Config file

For anything more than a couple of flags, use a config file. Without `--config`, the CLI looks for `worker-manager.config.mjs`, `.js`, `.cjs`, or `.json` in the current directory, in that order. `.cjs` and `.json` are always read as CommonJS/JSON; a plain `.js` file is read as CommonJS first and retried as ESM if that fails, so either `module.exports` or `export default` works there.

```js
// worker-manager.config.js
module.exports = {
  redis: 'redis://localhost:6379',
  prefix: ['bull', 'tenant-a'],
  scanInterval: 15,
  uiConfig: {
    boardTitle: 'Ops Dashboard',
    hideDocsLink: true,
  },
  queues: {
    'payment-webhooks': { readOnlyMode: true },
  },
};
```

`redis` takes a connection URL as above, or a full [ioredis options object](https://github.com/redis/ioredis#connect-to-redis) when a URL can't express the connection, which is what [Redis Sentinel](#redis-sentinel) needs.

`uiConfig` is the same object you'd pass to `createWorkerManagerBoard({ options: { uiConfig } })` in code, see the [UIConfig reference](/configuration/ui-config) for the full set of fields. Board-wide title, logo, locale, and so on all live there, not at the top level of the config file.

`queues` is dual purpose: an array (`queues: ['emails', 'webhooks']`) is equivalent to `--queues`, a comma-free explicit list that skips discovery. An object, as above, instead sets per-queue [`QueueAdapterOptions`](/queue-adapters/bullmq) overrides keyed by queue name, the same options you'd pass to `new BullMQAdapter(queue, options)` directly. A queue's own `readOnlyMode: true` always wins even when the board as a whole isn't read-only, but it can't turn read-only mode back off for a single queue once `--read-only` is set globally. A field can't do both jobs in the same file: pick the array form to restrict which queues are served, or the object form to configure the ones discovery finds.

## Redis Sentinel

A Sentinel deployment has no fixed master address, so there is no single URL to point `--redis` at. `--sentinel` takes the sentinel nodes instead and lets ioredis work out which Redis is currently the master:

```sh
npx @worker-manager/cli --sentinel s1.internal:26379,s2.internal:26379 --sentinel-name mymaster
```

Each entry is a `host` or `host:port`, with the port defaulting to 26379. An IPv6 literal is all colons, so it needs brackets to carry a port: `[2001:db8::1]:26379`. Without them the whole entry is read as a host and gets the default port. `--sentinel-name` is the master group name from your sentinel configuration, the same string you would pass as `name` to ioredis, and it is required: sentinels can monitor more than one group, so there is nothing sensible to guess.

`--sentinel` and `--redis` are mutually exclusive. Setting both is an error rather than a quiet precedence rule, so a leftover `WORKER_MANAGER_REDIS_URL` in a container's environment cannot silently send the dashboard to the wrong Redis.

The CLI holds one ioredis connection and hands it to everything else it builds, so failover handling is not a separate feature: the queue instances, Bull's second subscriber connection, and the `--history` recorder all follow the master through a failover because they share that connection. During the failover window the dashboard's own API requests fail the way they do for any dropped connection, and recover once ioredis has re-resolved the master.

### Credentials

A Redis URL carries its own credentials. Sentinel mode has no URL, so they get their own flags:

| Flag | Applies to |
|---|---|
| `--redis-username` | The Redis nodes behind the sentinels |
| `--redis-password` | The Redis nodes behind the sentinels |
| `--redis-db` | The Redis nodes behind the sentinels |
| `--sentinel-password` | The sentinel nodes themselves |

`--sentinel-password` is separate because sentinel nodes usually have a password of their own, distinct from the one guarding the data nodes.

These four are rejected alongside a Redis URL rather than merged into it. ioredis treats an explicitly passed option as a default and lets the URL win, so a `--redis-password` next to a URL that already carries one would be silently discarded. Refusing the combination outright is clearer than a flag that sometimes takes effect. With a URL, put the credentials in the URL.

### Everything else

The flags cover the common deployment. For anything past it, the config file's `redis` key also accepts a full [ioredis options object](https://github.com/redis/ioredis#connect-to-redis), passed through to the client untouched:

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
    tls: {},
  },
};
```

That is the way to reach TLS to the sentinel nodes, `natMap` for a NAT-ed cluster, `preferredSlaves`, or a custom `sentinelRetryStrategy`. The object form is not limited to Sentinel: a plain `{ host, port, tls }` works too, wherever a URL is awkward. Credential flags still apply on top of an object, so a password can stay in the environment instead of the file.

## Redis Cluster

`--cluster` takes a comma-separated list of startup nodes and connects through them, the way `--redis` and `--sentinel` do for their topologies. ioredis discovers the rest of the cluster from any node that answers, so listing two or three is enough:

```sh
npx @worker-manager/cli --cluster n1:7000,n2:7000,n3:7000 --prefix '{bull}'
```

`--redis-username` and `--redis-password` apply here as they do in sentinel mode. `--redis-db` does not: a cluster only has database 0, and passing it is an error rather than a silent no-op.

Your queues need the hash-tagged prefix BullMQ already asks for in cluster mode, so one queue's keys stay in one slot:

```ts
new Queue('mailer', { connection, prefix: '{bull}' });
```

Point `--prefix` at the same string, braces included. Discovery scans every master rather than one, since `SCAN` carries no key for the client to route by.

Only BullMQ queues are served. Bull 3 builds its keys without a hash tag and its Lua touches several at once, so on a cluster every command it issues is a `CROSSSLOT` away from failing; such a queue is skipped with a warning naming it, rather than shown on the board with every action broken. BullMQ queues on the same cluster are unaffected.

The Redis stats panel reports the cluster as a whole, summing memory and client counts across the masters. [`--history`](#historical-metrics) works, storing everything under a single hash slot so its rollup script stays legal. The [historical metrics recipe](/recipes/historical-metrics#redis-cluster) covers what that means for the key layout.

## Basic auth

`--user` and `--password` add HTTP basic auth in front of the dashboard. Both are required together:

```sh
npx @worker-manager/cli -r redis://localhost:6379 --user admin --password secret --host 0.0.0.0
```

This is enough for a queue you've tunnelled to or a small internal box. It is not the layered, session-aware auth described in [Add basic auth](/recipes/basic-auth), which covers login flows and framework-integrated auth for an app you're embedding the dashboard into.

## Keycloak auth

Instead of Basic auth, the CLI can put a Keycloak (OpenID Connect) login in front of the dashboard, through [`@worker-manager/auth`](/recipes/keycloak-auth):

```sh
npx @worker-manager/cli -r redis://localhost:6379 --host 0.0.0.0 \
  --keycloak-url https://sso.example.com --keycloak-realm ops \
  --keycloak-client-id worker-manager --keycloak-client-secret "$KEYCLOAK_SECRET" \
  --keycloak-roles wm-admin \
  --public-url https://queues.example.com --session-secret "$SESSION_SECRET"
```

Browsers are redirected to the Keycloak login page (authorization code flow with PKCE) and come back with an encrypted, `HttpOnly` session cookie that is refreshed silently while the refresh token lasts. Scripts can skip the browser and send `Authorization: Bearer <access token>` instead; `--keycloak-bearer-only` turns the login page off entirely. A user without one of `--keycloak-roles` (realm roles or client roles) gets a 403.

Register `<public url>/auth/callback` as a valid redirect URI on the Keycloak client and `<public url>/` as a valid post logout redirect URI. Without `--public-url` the URL is derived from the request's `Host` and `X-Forwarded-*` headers. Set `--session-secret` whenever more than one CLI process serves the same board, or sessions will not survive a restart. `--user`/`--password` and `--keycloak-url` are mutually exclusive.

In a config file, the same settings live under `keycloak`, with the option names of [`@worker-manager/auth`](/recipes/keycloak-auth):

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

## pg-boss

::: warning Experimental
The pg-boss board is experimental: its `/api/pg-boss` HTTP contract may still change in a minor release.
:::

`--pg-boss` serves a board over a [pg-boss](https://github.com/timgit/pg-boss) schema: its queues, jobs in every state, and schedules.
See [the pg-boss engine](/queue-adapters/pg-boss) for what the board shows, the recommended indexes and a read-only database role.

```sh
npx @worker-manager/cli --pg-boss postgres://app:secret@localhost:5432/app
```

It needs Node.js 22.12 or newer, because pg-boss does. On an older Node.js, `--pg-boss` stops at startup with a message saying so, while every other mode of the CLI keeps running on Node.js 20. The [Docker image](/guide/docker) is on Node.js 22 already. The CLI bundles its own pg-boss 12 and reads and writes through it; your app does not need to share a version with it.

| Flag | Default | What it does |
|---|---|---|
| `--pg-boss <url>` | | The PostgreSQL database pg-boss lives in |
| `--pg-boss-schema <name>` | `pgboss` | The schema pg-boss was installed in |
| `--pg-boss-queues <a,b>` | every queue | Show only these queues. Any other queue answers 404, in the UI and in the API |
| `--pg-boss-path <path>` | `/pg-boss` | Where the pg-boss board is served when a BullMQ board has the root |

Nothing is migrated, supervised or created in that database. The board reads the pg-boss tables with plain SQL, inside a supported range of pg-boss schema versions, and writes (retry, cancel, resume, delete, send, schedules) through the pg-boss API. Writes need the database to be on exactly the schema version the bundled pg-boss writes. If it is on another one, because your app is on an older or newer pg-boss, the board turns writes off, reads keep working, and the reason is logged at startup and shown in the UI:

```text
Worker Manager listening on http://127.0.0.1:3000
pg-boss: postgres://app:***@localhost:5432/app (schema pgboss, version 41)
pg-boss writes are disabled: the database is on pg-boss schema version 41, but the pg-boss bundled with this CLI writes version 42. Reading keeps working.
```

A schema pg-boss was never installed in, or one outside the supported range, is logged the same way, and the board says so instead of showing queues.

### Next to a BullMQ board

With only `--pg-boss`, the pg-boss board is the whole dashboard and sits at the root (or at `--base-path`). Add a BullMQ source (`--redis`, `--sentinel`, `--cluster`, `--postgres`, or their environment and config file equivalents) and you get two boards from one process: BullMQ at the root, pg-boss under `--pg-boss-path`. Each board's header links to the other.

```sh
npx @worker-manager/cli \
  --redis redis://localhost:6379 \
  --pg-boss postgres://app:secret@localhost:5432/app \
  --user admin --password secret
```

| URL | Board |
|---|---|
| `http://127.0.0.1:3000/` | BullMQ, from Redis |
| `http://127.0.0.1:3000/pg-boss/` | pg-boss |

The two boards share everything that is not about the queues:

- **Auth.** Basic or Keycloak auth is mounted once, at the root, so it covers both boards. There is one login, and with Keycloak one redirect URI (`<public url>/auth/callback`).
- **`--read-only`** applies to both. On the pg-boss board the write routes are not mounted at all.
- **`--base-path`** prefixes both: `--base-path /ops` puts BullMQ at `/ops/` and pg-boss at `/ops/pg-boss/`.
- **Outages stay separate.** The pg-boss board is served ahead of the Redis gate, so it keeps working while Redis is unreachable, and an unreachable pg-boss database is a warning, not a failed start, when BullMQ is there too. On its own, `--pg-boss` fails startup when the database does not answer, like a PostgreSQL-only board.

`--pg-boss-path` cannot be `/` or a path the BullMQ board answers itself (`/api`, `/static`, `/auth`, `/queue`, `/job-schedulers`). The links between the boards are added after any `miscLinks` in your `uiConfig`, which both boards share, title included.

`--history` gives the pg-boss board its own history, kept in the same database as pg-boss but in a separate schema, `worker_manager` (tables `worker_manager_metrics_*`), and never inside the pg-boss schema. Its queues are recorded as `pgboss:<schema>:<queue>`, so they cannot collide with BullMQ queues of the same name. The BullMQ board keeps its history where it always has. Completed and failed counts need an index on the pg-boss `job` table; the CLI warns at startup when there isn't one, and the [historical metrics recipe](/recipes/historical-metrics) has the DDL. `--read-only` stops the recording and serves what is already there.

In a config file, `pgBoss` takes the URL, or a [node-postgres pool config](https://node-postgres.com/apis/pool) plus `schema`, `queues` and `path`:

```js
module.exports = {
  redis: 'redis://localhost:6379',
  pgBoss: {
    host: 'db',
    user: 'app',
    password: process.env.PGPASSWORD,
    database: 'app',
    schema: 'pgboss',
    queues: ['emails', 'invoices'],
    path: '/pg-boss',
  },
};
```

A URL from `--pg-boss` or `WORKER_MANAGER_PGBOSS_URL` replaces the config file's connection but keeps its `schema`, `queues` and `path` unless those are overridden too.

## Historical metrics

BullMQ's own metrics are a per-minute ring buffer capped at `maxDataPoints`, so the throughput chart can't look back further than that buffer reaches. `--history` turns on the long-retention path from the [historical metrics recipe](/recipes/historical-metrics) without wiring `@worker-manager/metrics` into an app of your own:

```sh
npx @worker-manager/cli -r redis://localhost:6379 --history
```

That registers `RedisMetricsHistoryProvider` on the Redis connection the dashboard already holds, so every queue chart gains a 60m / 7d / 30d / 90d range selector and a cross-queue "Metrics history" page shows up in the sidebar. It flips `showMetrics` on too, because the range selector lives inside the per-queue chart and that chart doesn't render without it.

It also writes. A `MetricsRecorder` runs in the CLI process and once a minute copies each queue's completed and failed counters into long-retention buckets, then samples wait time, run time and the age of the oldest waiting job. The recorder follows discovery rather than a fixed list: a queue that shows up between rescans starts recording on the next tick, and one that disappears stops. No restart either way.

`--history-retention-days` sets how long history is kept, 90 days by default. It moves the hourly and daily windows only and leaves minute-level detail at 7 days, since that tier holds essentially all the bytes. Per-tier retention, the key namespace, the snapshot interval and turning latency sampling off go in the config file under a `history` key:

```js
// worker-manager.config.js
module.exports = {
  redis: 'redis://localhost:6379',
  history: {
    enabled: true,
    prefix: 'worker-manager:metrics',
    retention: { minutes: 7, hours: 90, days: 90 },
    latency: false,
    snapshotIntervalMs: 60000,
  },
};
```

### What it writes

Recording writes to the same Redis your queues live in, under the `worker-manager:metrics:` namespace, and never touches a key Bull or BullMQ owns. Set `history.prefix` in the config file to move that namespace, which is what keeps two boards on one Redis from sharing a history. Redis TTLs enforce retention, so there's nothing to prune by hand. [Storage footprint](/recipes/historical-metrics#storage-footprint) has the measured numbers; the short version is roughly 1.1 MB per queue for the counters at the default retention plus about 250 KB for latency, and an idle queue costs nothing.

`--read-only` stops the writing and keeps the reading, so the board serves whatever another process has recorded. That's what you want when your workers already run a `MetricsRecorder` of their own and the CLI is only there to look at the result. The config file can ask for the opposite with `history: { record: true }` alongside `--read-only`, for a board that mustn't touch your queues but does own its history.

Running several instances with `--history` at once is safe. The minute upsert applies a delta against the value already stored rather than adding to it, so a minute recorded twice still counts once, and latency sampling takes a short per-queue lease, so only one process scans a given queue on a given tick.

### When the charts stay empty

Completed and failed history is copied out of BullMQ's own metrics buffer, which stays empty unless your workers were built with metrics enabled:

```ts
new Worker(name, processor, {
  connection,
  metrics: { maxDataPoints: MetricsTime.ONE_WEEK },
});
```

The CLI warns about this at startup when no discovered queue has any metrics data, because otherwise a queue whose workers never enabled metrics looks exactly like an idle one. Latency and queue age need nothing from your workers, since they're read from sorted sets BullMQ maintains anyway. One exception there: a queue using `removeOnComplete: true` has its jobs deleted before the next tick can read them, so it never accumulates latency data.

This is BullMQ only. Bull v3 has no native metrics to snapshot, and BullMQ v6 queues backed by PostgreSQL aren't discoverable from the CLI in the first place.

## Docker

The CLI also ships as an image, `ghcr.io/naldomadeira/worker-manager`, so a container next to your Redis needs no Node on the host and doesn't re-resolve the package from npm every time it starts:

```sh
docker run --rm -p 127.0.0.1:3000:3000 \
  -e WORKER_MANAGER_USER=admin -e WORKER_MANAGER_PASSWORD=secret \
  ghcr.io/naldomadeira/worker-manager --redis redis://host.docker.internal:6379
```

The entrypoint is the CLI, so every flag and variable on this page works there too. [Run with Docker](/guide/docker) covers the tags, a Compose file, mounting a config file, and putting it behind a reverse proxy.

## Queues written by something other than Node

BullMQ has an official [Python package](https://python-bullmq.readthedocs.io/), and gets written to from Go, Ruby, and other languages over the raw Redis protocol, since the job format is just a set of Redis keys, not a Node API. Those teams have never had a way to use Worker Manager, because every server adapter assumes a Node HTTP app to mount into. The CLI doesn't have that assumption: it scans Redis for the same keys regardless of what wrote them, and builds a `Queue` instance the same way whether the producer was `bullmq` or `python-bullmq`.

The caveat is the same one that applies everywhere else in worker-manager: the dashboard can only show what Bull and BullMQ store in Redis. A producer that doesn't write jobs in the format either library expects may show up incompletely, or not render some fields at all.

## Driving it from a script or an agent

The CLI serves the same JSON API the UI itself calls, so a shell script or an agent debugging a stuck job can query it instead of reading Redis keys by hand or writing a throwaway script:

```sh
npx @worker-manager/cli -r redis://localhost:6379 --port 3000 --no-open &
curl -s http://127.0.0.1:3000/api/queues | jq '.queues[] | {name, counts, isPaused}'
```

```json
{
  "name": "Emails.Transactional.PasswordReset",
  "counts": {
    "active": 0,
    "completed": 500,
    "delayed": 6,
    "failed": 171,
    "paused": 0,
    "prioritized": 0,
    "waiting": 0,
    "waiting-children": 0
  },
  "isPaused": false
}
```

`--no-open` skips the browser launch, which matters in a script or a headless agent session where there's nothing to open a browser on. `--port` pins the port so the caller knows where to send the request instead of parsing it out of stdout.

## What it doesn't do yet

Bull 3 queues aren't servable on a Redis Cluster, since Bull builds its keys without a hash tag. They're skipped with a warning; BullMQ queues on the same cluster work normally.

`--prefix` also doesn't take wildcards. A queue's Redis key and its name can both contain colons, so there's no reliable way to guess where a wildcard prefix ends and the queue name begins. List the prefixes you need explicitly instead, for example `--prefix bull,tenant-a,tenant-b`.
