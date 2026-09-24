export const HELP = `
bull-board - run the bull-board dashboard against Redis and/or PostgreSQL

Usage:
  bull-board [options]
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

If Redis is unreachable at startup, bull-board still opens: it serves a
diagnostic page explaining why, keeps retrying every 3 seconds, and switches
to the real dashboard on its own once Redis answers. That only covers
startup: once the dashboard is live it stays live, even if Redis goes away
later. The diagnostic page does not come back; API requests just stop
returning until Redis is reachable again, and Ctrl-C still works.
Pass --no-retry to get the old behaviour back instead: print the error and
exit 1 immediately, without opening a port.

--history turns on historical metrics: the dashboard gains a range selector
per queue and a cross-queue Metrics history page, and this process records
throughput, latency and queue age into Redis under the bull-board:metrics:
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
--history needs Redis and is ignored on a PostgreSQL-only board.

--keycloak-url replaces Basic auth with a Keycloak login: browsers are sent
through the OIDC authorization code flow (PKCE), API clients may send an
Authorization: Bearer access token. The redirect URI to register in Keycloak
is <public url>/auth/callback.

Environment variables mirror every flag, for example BULL_BOARD_REDIS_URL,
BULL_BOARD_SENTINELS, BULL_BOARD_SENTINEL_NAME, BULL_BOARD_CLUSTER_NODES,
BULL_BOARD_PORT, BULL_BOARD_READ_ONLY, BULL_BOARD_KEYCLOAK_URL,
BULL_BOARD_KEYCLOAK_REALM, BULL_BOARD_KEYCLOAK_CLIENT_ID,
BULL_BOARD_KEYCLOAK_CLIENT_SECRET, BULL_BOARD_KEYCLOAK_ROLES,
BULL_BOARD_PUBLIC_URL, BULL_BOARD_SESSION_SECRET, BULL_BOARD_POSTGRES_URL,
BULL_BOARD_POSTGRES_SCHEMA.

Examples:
  bull-board
  bull-board -r redis://localhost:6379 -p 4000
  bull-board --prefix tenant-a,tenant-b --read-only
  bull-board --user admin --password secret --host 0.0.0.0
  bull-board --sentinel s1:26379,s2:26379 --sentinel-name mymaster
  bull-board --cluster n1:7000,n2:7000,n3:7000
  bull-board --postgres postgres://bullmq:bullmq@localhost:5432/bullmq
  bull-board --keycloak-url https://sso.example.com --keycloak-realm ops \\
    --keycloak-client-id board --keycloak-client-secret $SECRET \\
    --keycloak-roles wm-admin --public-url https://ops.example.com
`;
