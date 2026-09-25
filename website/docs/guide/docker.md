---
description: Run the Worker Manager dashboard in a container with the official ghcr.io/naldomadeira/worker-manager image. Docker Compose, environment variables, config files and basic auth.
---

# Run with Docker

`ghcr.io/naldomadeira/worker-manager` is the official image: the [standalone CLI](/guide/cli) with a Node runtime wrapped around it. The dashboard runs as its own container next to your Redis, so there's nothing to install on the host and no app to mount an adapter into. That's usually what you want when the workers live in a repo you aren't editing, or when nothing in the stack is Node in the first place.

```sh
docker run --rm -p 127.0.0.1:3000:3000 \
  -e WORKER_MANAGER_USER=admin -e WORKER_MANAGER_PASSWORD=secret \
  ghcr.io/naldomadeira/worker-manager --redis redis://host.docker.internal:6379
```

That serves the dashboard on `http://127.0.0.1:3000` with every Bull and BullMQ queue it finds under the `bull` key prefix. `host.docker.internal` is how a container reaches a Redis running on the host: Docker Desktop provides it, and on plain Docker Engine you add `--add-host host.docker.internal:host-gateway`.

## What's in the image

`node:22-alpine` and the published `@worker-manager/cli`, nothing else. About 63 MB, built for `linux/amd64` and `linux/arm64`, running as the unprivileged `node` user.

The entrypoint is the CLI itself, so anything after the image name is a flag exactly as the [CLI guide](/guide/cli#options) documents it, and every `WORKER_MANAGER_*` variable behaves the same way. There's no image-specific configuration to learn. Two CLI defaults come preset, because they're the two that make no sense in a container:

| Variable | Image default | Why |
|---|---|---|
| `WORKER_MANAGER_HOST` | `0.0.0.0` | The CLI default `127.0.0.1` only accepts connections from inside the container |
| `WORKER_MANAGER_OPEN` | `false` | There's no browser in there to open |

Both are ordinary environment variables, so `--host` or your own `-e WORKER_MANAGER_HOST` still wins.

There's also a `HEALTHCHECK` polling the dashboard on its own port, so `depends_on: { worker-manager: { condition: service_healthy } }` works for anything that should start behind it. Basic auth doesn't get in its way, since a 401 still proves the server is answering.

## Tags

| Tag | Points at |
|---|---|
| `latest` | The newest release |
| `9` | The newest release in that major |
| `9.5.0` | That exact release, forever |

Pin the exact version if you'd rather nothing moved under you, or the major for patches without surprises. The [package page](https://github.com/naldomadeira/worker-manager/pkgs/container/worker-manager) lists every tag that exists.

## Docker Compose

Next to a Redis of your own:

```yaml
services:
  redis:
    image: redis:latest
    ports:
      - '6379:6379'

  worker-manager:
    image: ghcr.io/naldomadeira/worker-manager:9
    command: --redis redis://redis:6379
    environment:
      WORKER_MANAGER_USER: ${WORKER_MANAGER_USER}
      WORKER_MANAGER_PASSWORD: ${WORKER_MANAGER_PASSWORD}
    ports:
      - '127.0.0.1:3000:3000'
    depends_on:
      - redis
```

None of that is Compose specific. It's an ordinary container listening on 3000, so any orchestrator runs it the same way.

## Configuring it

Flags after the image name, `WORKER_MANAGER_*` variables and a config file all work, and they resolve in that order. The CLI guide has the [full table](/guide/cli#environment-variables); these are the ones that come up in a container:

```sh
docker run --rm -p 127.0.0.1:3000:3000 \
  -e WORKER_MANAGER_REDIS_URL=redis://redis:6379 \
  -e WORKER_MANAGER_PREFIX=bull,tenant-a \
  -e WORKER_MANAGER_READ_ONLY=true \
  -e WORKER_MANAGER_BOARD_TITLE='Ops Dashboard' \
  ghcr.io/naldomadeira/worker-manager
```

For anything longer, mount a [config file](/guide/cli#config-file). The working directory is `/app`, which is where the CLI looks, so a file mounted there is picked up without a `--config` flag as long as uid 1000 can read it:

```yaml
    volumes:
      - ./worker-manager.config.js:/app/worker-manager.config.js:ro
```

[Historical metrics](/recipes/historical-metrics) work here too, since the image carries `@worker-manager/metrics` as part of the CLI. `--history`, or `WORKER_MANAGER_HISTORY=true`, registers the history provider and starts recording throughput and latency into your Redis once a minute:

```yaml
  worker-manager:
    image: ghcr.io/naldomadeira/worker-manager:9
    command: --redis redis://redis:6379 --history --history-retention-days 90
```

The container is a normal recorder, so it keeps writing for as long as it runs and stops when you stop it. Two of them against one Redis is safe, and `--read-only` keeps the charts while writing nothing. The [CLI guide](/guide/cli#historical-metrics) covers the config file keys and what leaves the charts empty.

[Redis Sentinel](/guide/cli#redis-sentinel) needs no URL, which is the point: the master address is not fixed, so the container is given the sentinel nodes and the master group name instead.

```yaml
  worker-manager:
    image: ghcr.io/naldomadeira/worker-manager:9
    environment:
      WORKER_MANAGER_SENTINELS: sentinel-1:26379,sentinel-2:26379,sentinel-3:26379
      WORKER_MANAGER_SENTINEL_NAME: mymaster
      WORKER_MANAGER_SENTINEL_PASSWORD: ${SENTINEL_PASSWORD}
      WORKER_MANAGER_REDIS_PASSWORD: ${REDIS_PASSWORD}
```

Leave `WORKER_MANAGER_REDIS_URL` unset there. Setting both is an error, so an old URL left behind in a compose file or an env file stops the container rather than quietly winning.

A [pg-boss](/guide/cli#pg-boss) board (experimental) takes a PostgreSQL URL. The image runs Node.js 22, which is what pg-boss needs, and bundles its own pg-boss 12. With nothing else set it is the only board:

```sh
docker run --rm -p 127.0.0.1:3000:3000 \
  -e WORKER_MANAGER_USER=admin -e WORKER_MANAGER_PASSWORD=secret \
  -e WORKER_MANAGER_PGBOSS_URL=postgres://app:secret@db:5432/app \
  ghcr.io/naldomadeira/worker-manager
```

Next to a Redis, BullMQ keeps the root and pg-boss moves to `/pg-boss/` (or `WORKER_MANAGER_PGBOSS_PATH`), behind the same login and linked from each board's header:

```yaml
  worker-manager:
    image: ghcr.io/naldomadeira/worker-manager:9
    environment:
      WORKER_MANAGER_REDIS_URL: redis://redis:6379
      WORKER_MANAGER_PGBOSS_URL: postgres://app:${PGPASSWORD}@db:5432/app
      WORKER_MANAGER_PGBOSS_SCHEMA: pgboss
      WORKER_MANAGER_USER: ${WORKER_MANAGER_USER}
      WORKER_MANAGER_PASSWORD: ${WORKER_MANAGER_PASSWORD}
```

The container never migrates or creates anything in the pg-boss schema. If your app is on a pg-boss whose schema version differs from the one in the image, the board stays readable, turns writes off and logs why at startup.

Serving the dashboard under a path prefix, which is what a reverse proxy routing on the path needs, is `--base-path`:

```sh
docker run --rm -p 127.0.0.1:3000:3000 \
  ghcr.io/naldomadeira/worker-manager --redis redis://redis:6379 --base-path /queues
```

## Keeping it private

The container listens on every interface inside itself, so `WORKER_MANAGER_USER` and `WORKER_MANAGER_PASSWORD` (or `--user` and `--password`) aren't optional here, and the port mapping above publishes to `127.0.0.1` on the host rather than everywhere. The CLI warns at startup when it's bound to a non-loopback host with no auth set, since that's an unauthenticated dashboard with delete-job and obliterate-queue on it, reachable from anywhere that can route to the host. If all you need is visibility, `--read-only` turns off every destructive action.

Basic auth over plain HTTP still sends the credentials in the clear. Publishing the port beyond the host, whether that's a routable address, a cloud security group or a proxy without TLS, wants an SSH tunnel or TLS termination in front of it either way.

## Building it yourself

The `Dockerfile` at the root of the repo is the one that produces the published image, and the CLI version is a build argument:

```sh
docker build --build-arg WORKER_MANAGER_VERSION=9.5.0 -t worker-manager .
```

Worth doing if you need a different base image or an internal registry.

## Without an image

The CLI also runs from npm inside a stock Node container. That re-resolves the package on every start, so it pins nothing and needs egress to the registry:

```yaml
  worker-manager:
    image: node:22-alpine
    command: npx -y @worker-manager/cli --redis redis://redis:6379 --host 0.0.0.0 --no-open
    environment:
      WORKER_MANAGER_USER: ${WORKER_MANAGER_USER}
      WORKER_MANAGER_PASSWORD: ${WORKER_MANAGER_PASSWORD}
    ports:
      - '127.0.0.1:3000:3000'
    depends_on:
      - redis
```

`--host 0.0.0.0` and `--no-open` are spelled out here, since only the Worker Manager image presets them.
