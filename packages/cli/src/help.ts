export const HELP = `
worker-manager - run the Worker Manager dashboard against Redis, PostgreSQL and/or pg-boss

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

If Redis is unreachable at startup, Worker Manager still opens: it serves a
diagnostic page explaining why, keeps retrying every 3 seconds, and switches
to the real dashboard on its own once Redis answers. That only covers
startup: once the dashboard is live it stays live, even if Redis goes away
later. The diagnostic page does not come back; API requests just stop
returning until Redis is reachable again, and Ctrl-C still works.
Pass --no-retry to get the old behaviour back instead: print the error and
exit 1 immediately, without opening a port.

--history turns on historical metrics: the dashboard gains a range selector
per queue and a cross-queue Metrics history page, and this process records
throughput, latency and queue age into Redis under the worker-manager:metrics:
namespace once a minute. --read-only stops the recording but keeps serving
whatever another process has recorded.

--cluster connects to a Redis Cluster, taking a comma-separated list of
startup nodes. Only BullMQ queues are served: Bull 3 builds keys without a
hash tag, so on a cluster its commands fail, and such queues are skipped with
a warning rather than shown broken. --history works, storing everything under
one hash slot so its rollup script stays legal.

--sentinel connects through Redis Sentinel instead of a URL, and the two are
mutually exclusive. ioredis resolves the current master through the sentinels
listed and follows a failover on its own, so queue reads, the Bull subscriber
and --history recording all move with it. The credential flags above apply to
sentinel and cluster mode only; with a Redis URL, put credentials in the URL
itself.

--postgres serves queues from BullMQ v6's PostgreSQL backend, discovering
their names from its tables (or taking --queues). With no Redis source set
(no --redis, --sentinel, --cluster or config file entry) the board serves
PostgreSQL only and never connects to Redis; otherwise it serves both.
--history records into Redis when there is one; on a PostgreSQL-only board
it records into PostgreSQL instead, in the --postgres-schema schema.

--pg-boss serves an experimental board over a pg-boss schema. With no Redis
or --postgres source it is the only board and takes the root; otherwise the
BullMQ board keeps the root, the pg-boss board is served under --pg-boss-path,
and each links to the other from the header. --read-only and the auth flags
cover both. Nothing is migrated or created in the pg-boss schema: when the
database is on a different pg-boss schema version than the one bundled here,
writes turn off with the reason logged at startup, and reads keep working
within the supported range. --history keeps the pg-boss board's history in
the worker_manager schema of the same database. Needs Node.js 22.12 or later.

--keycloak-url replaces Basic auth with a Keycloak login: browsers are sent
through the OIDC authorization code flow (PKCE), API clients may send an
Authorization: Bearer access token. The redirect URI to register in Keycloak
is <public url>/auth/callback.

Environment variables mirror every flag, for example WORKER_MANAGER_REDIS_URL,
WORKER_MANAGER_SENTINELS, WORKER_MANAGER_SENTINEL_NAME, WORKER_MANAGER_CLUSTER_NODES,
WORKER_MANAGER_PORT, WORKER_MANAGER_READ_ONLY, WORKER_MANAGER_KEYCLOAK_URL,
WORKER_MANAGER_KEYCLOAK_REALM, WORKER_MANAGER_KEYCLOAK_CLIENT_ID,
WORKER_MANAGER_KEYCLOAK_CLIENT_SECRET, WORKER_MANAGER_KEYCLOAK_ROLES,
WORKER_MANAGER_PUBLIC_URL, WORKER_MANAGER_SESSION_SECRET, WORKER_MANAGER_POSTGRES_URL,
WORKER_MANAGER_POSTGRES_SCHEMA, WORKER_MANAGER_PGBOSS_URL, WORKER_MANAGER_PGBOSS_SCHEMA,
WORKER_MANAGER_PGBOSS_QUEUES, WORKER_MANAGER_PGBOSS_PATH.

Examples:
  worker-manager
  worker-manager -r redis://localhost:6379 -p 4000
  worker-manager --prefix tenant-a,tenant-b --read-only
  worker-manager --user admin --password secret --host 0.0.0.0
  worker-manager --sentinel s1:26379,s2:26379 --sentinel-name mymaster
  worker-manager --cluster n1:7000,n2:7000,n3:7000
  worker-manager --postgres postgres://bullmq:bullmq@localhost:5432/bullmq
  worker-manager --pg-boss postgres://app:secret@localhost:5432/app
  worker-manager -r redis://localhost:6379 --pg-boss postgres://localhost/app
  worker-manager --keycloak-url https://sso.example.com --keycloak-realm ops \\
    --keycloak-client-id board --keycloak-client-secret $SECRET \\
    --keycloak-roles wm-admin --public-url https://ops.example.com
`;
