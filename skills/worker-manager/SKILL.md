---
name: worker-manager
description: Adds, configures and troubleshoots Worker Manager (@worker-manager/*), a web dashboard for job queues, in a Node.js app. Use when a user wants a queue dashboard, queue UI or job monitoring for BullMQ or Bull on Redis, BullMQ v6 on PostgreSQL, or pg-boss; when mounting it in NestJS, Express, Fastify, Koa, Hapi, Hono, H3, Elysia, Bun or Next.js; when protecting it with auth (Basic, Keycloak/OIDC, token, custom); for read-only boards, historical metrics, the worker-manager CLI or Docker image; or when migrating from bull-board (@bull-board/*).
license: MIT
metadata:
  version: 2.4.0
  docs: https://naldomadeira.github.io/worker-manager/
---

# Worker Manager

Worker Manager mounts a dashboard for job queues inside an existing server, or runs it standalone
(CLI, Docker). This skill is a map, written against v2.4.0. The docs are the source of truth for
exact option names: when a detail is not here, fetch
<https://naldomadeira.github.io/worker-manager/llms-full.txt> (whole docs in one file) or
<https://naldomadeira.github.io/worker-manager/llms.txt> (index) before writing code.

## Workflow

1. **Survey the app**: HTTP framework (from `package.json` and the bootstrap file), queue library
   (`bullmq`, `bull`, `@nestjs/bullmq`, `@nestjs/bull`, `pg-boss`), where queues and connections
   are created, and what auth the app already has. Done when you can name one engine, one server
   adapter and one auth strategy from the decision tree below.
2. **Install** only the packages that choice needs (table below).
3. **Mount** the board with the matching snippet, reusing the app's queue instances and connections.
4. **Protect** it: built-in `auth`, or the app's existing auth middleware in front of the board.
5. **Verify**: start the app, open `<mount path>/`, and confirm the page, `<mount path>/api/...` and
   `<mount path>/static/...` all load (no 404s) and that an unauthenticated request gets 401.
6. **Report** the diff, the URL, and which credentials or env vars the user must set.

## Decision tree

**Engine** (one engine per board):

| The app's jobs live in | Engine | Queue adapter / board |
|---|---|---|
| BullMQ on Redis | BullMQ | `new BullMQAdapter(queue)` from `@worker-manager/api/bullMQAdapter` |
| Bull (v4) on Redis | BullMQ | `new BullAdapter(queue)` from `@worker-manager/api/bullAdapter` |
| BullMQ Pro | BullMQ | `BullMQProAdapter` from `@worker-manager/api/bullMQProAdapter` |
| BullMQ v6 in PostgreSQL (`createPostgresBackend`) | BullMQ | `BullMQAdapter`, same as Redis. See [references/postgres.md](references/postgres.md) |
| pg-boss (PostgreSQL) | pg-boss (stable since 2.4.0) | `createPgBossBoard` / NestJS `engine: 'pg-boss'`. See [references/pg-boss.md](references/pg-boss.md) |
| BullMQ **and** pg-boss | both | Two boards on sibling paths (`/queues`, `/pg-boss`) |

**Server adapter**: NestJS uses `@worker-manager/nestjs` (it picks Express or Fastify itself);
otherwise `@worker-manager/{express,fastify,koa,hapi,hono,h3,elysia,bun}`. Next.js has no adapter
of its own: use Hono in an App Router catch-all route (see [references/troubleshooting.md](references/troubleshooting.md#nextjs--vercel)).
No app to embed in, or the workers are not Node: the CLI or Docker image
([references/cli-docker.md](references/cli-docker.md)).

**Auth** ([references/auth.md](references/auth.md)):

| Situation | Strategy |
|---|---|
| Quick shared login | `basic` |
| Company SSO on Keycloak / OIDC | `keycloak` (PKCE, session cookie, bearer tokens, `requiredRoles`) |
| Internal board, scripts, agents | `token` (Bearer or custom header, plus a browser login form with `cookie`) |
| App already has auth (JWT, API keys, Cloudflare Access) | `custom` with `authenticate(req)` |

**Read-only**: BullMQ queues take `readOnlyMode: true` per queue adapter (NestJS: `readOnly: true`
for all); a pg-boss board takes `options.readOnly: true` for the whole board.

**History**: long-retention charts need `@worker-manager/metrics` (beta): a `MetricsRecorder` in an
always-on process plus a `historyProvider` on the board, stored in Redis or PostgreSQL
([references/metrics.md](references/metrics.md)).

## Golden rules

- **Base path equals mount path.** `setBasePath('/admin/queues')` and `app.use('/admin/queues', ...)`
  must be the same string, or every asset and API call 404s. Behind a proxy, use the path the
  browser sees. On NestJS `route` is relative to the global prefix and the module handles this.
- **Never expose the board unauthenticated.** Configure `auth` or put the app's own auth in front.
  When there is none, add a TODO and tell the user. Read secrets from env vars; invent no
  credentials and hardcode no passwords.
- **Reuse the app's queues and connections.** Wrap the existing `Queue` instances (NestJS:
  `forFeature({ name })` resolves them from DI). Create no new queues or Redis clients for the board.
- **BullMQ ≥ 6.3 on PostgreSQL needs its schema**: pass the object connection
  `{ connectionString, migrate: true }` (or run BullMQ's migrations as a deploy step), or it throws
  `SchemaMigrationRequiredError`.
- **pg-boss needs Node.js ≥ 22.12 and pg-boss ≥ 12.24**, plus `@worker-manager/pg-boss`. The
  engine is stable (since 2.4.0) and follows semver like the BullMQ engine.
- **One engine per board.** BullMQ and pg-boss never share a board; mount two, side by side
  (`/queues` and `/pg-boss`), never one nested inside the other.
- **The board never migrates the user's pg-boss schema.** It never calls `start()`, `supervise()`
  or a migration and creates no table or index. Starting pg-boss stays the app's job.
- **Use only documented options.** Package names are `@worker-manager/*`, the factory is
  `createWorkerManagerBoard`, the Nest module is `WorkerManagerModule`. When migrating from
  bull-board, rename `@bull-board/*`, `createBullBoard` and `BullBoardModule` accordingly.

## Install

| Case | Packages |
|---|---|
| NestJS + BullMQ/Bull | `@worker-manager/api @worker-manager/nestjs` + `@worker-manager/express` or `@worker-manager/fastify` |
| NestJS + pg-boss | the NestJS row + `@worker-manager/pg-boss` |
| Other framework | `@worker-manager/api @worker-manager/<framework>` |
| Auth outside NestJS | `+ @worker-manager/auth` (NestJS bundles it) |
| pg-boss outside NestJS | `@worker-manager/pg-boss @worker-manager/<framework>` |
| History charts | `+ @worker-manager/metrics` (`+ pg` for PostgreSQL storage) |

## NestJS + BullMQ on Redis

```ts
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { WorkerManagerModule } from '@worker-manager/nestjs';

@Module({
  imports: [
    BullModule.forRoot({ connection: { host: 'localhost', port: 6379 } }),
    BullModule.registerQueue({ name: 'emails' }),
    WorkerManagerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        route: '/queues', // Express or Fastify is detected
        readOnly: config.get('NODE_ENV') === 'production',
        auth: {
          strategy: 'basic',
          users: [{ username: 'ops', password: config.getOrThrow('BOARD_PASSWORD') }],
        },
      }),
    }),
    // In the module that registers the queue; resolves it from DI by name.
    WorkerManagerModule.forFeature({ name: 'emails', adapter: BullMQAdapter }),
  ],
})
export class AppModule {}
```

## NestJS + pg-boss

The app starts its own pg-boss and exposes it as a provider; the board reuses it. Add this next to
an existing BullMQ board as a **named** board, or drop `name` if pg-boss is the only engine.

```ts
WorkerManagerModule.forRoot({
  name: 'pgboss',
  route: '/pg-boss',
  engine: 'pg-boss',
  auth: { strategy: 'basic', users: [{ username: 'ops', password: process.env.BOARD_PASSWORD! }] },
  pgBoss: {
    useExisting: 'PG_BOSS', // token of the app's started PgBoss; or `instance: boss`
    connection: process.env.DATABASE_URL, // reads with a real server-side timeout
    schema: 'pgboss',
  },
}),
```

Named boards, `forRootAsync` with `name`, `@InjectWorkerManager(name)` and every option:
[references/nestjs.md](references/nestjs.md).

## Express / Fastify + BullMQ

```ts
import { createWorkerManagerBoard } from '@worker-manager/api';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { createAuthMiddleware } from '@worker-manager/auth';
import { ExpressAdapter } from '@worker-manager/express';

const basePath = '/admin/queues';
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath(basePath);
createWorkerManagerBoard({ queues: [new BullMQAdapter(emailQueue)], serverAdapter });

const auth = createAuthMiddleware(
  { strategy: 'token', tokens: [process.env.BOARD_TOKEN!], cookie: { secret: process.env.BOARD_SESSION_SECRET! } },
  { basePath }
);
app.use(basePath, auth, serverAdapter.getRouter());
```

Fastify (5 only) swaps the last line for the board plugin wrapped in the auth plugin:

```ts
import { createFastifyAuthPlugin } from '@worker-manager/auth';
import { FastifyAdapter } from '@worker-manager/fastify';

const serverAdapter = new FastifyAdapter();
serverAdapter.setBasePath(basePath);
createWorkerManagerBoard({ queues: [new BullMQAdapter(emailQueue)], serverAdapter });
await app.register(createFastifyAuthPlugin(serverAdapter.registerPlugin(), auth), { prefix: basePath });
```

## Express / Fastify + pg-boss

```ts
import { createPgBossBoard } from '@worker-manager/pg-boss';

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/pg-boss');
const board = createPgBossBoard({
  serverAdapter,
  pgBoss: { instance: boss, connection: process.env.DATABASE_URL, schema: 'pgboss' },
  options: { readOnly: false },
});
app.use('/pg-boss', auth, serverAdapter.getRouter()); // auth built with basePath '/pg-boss'
// on shutdown: await board.close(); the app's boss and pools stay the app's
```

## References

Load the one the task needs:

- [references/nestjs.md](references/nestjs.md): every `forRoot`/`forFeature` option, async config, named boards, pg-boss and PostgreSQL boards in Nest, testing.
- [references/auth.md](references/auth.md): the four strategies' options, per-framework wiring, Keycloak client setup, endpoints, access-control hooks.
- [references/pg-boss.md](references/pg-boss.md): connection modes, options, schema versions, indexes, read-only role.
- [references/postgres.md](references/postgres.md): BullMQ v6 on PostgreSQL, migrations, mixing backends.
- [references/metrics.md](references/metrics.md): recorder and history provider on Redis or PostgreSQL, pg-boss history.
- [references/cli-docker.md](references/cli-docker.md): `npx @worker-manager/cli` and the Docker image, flags and env vars.
- [references/troubleshooting.md](references/troubleshooting.md): 404s, proxies, Next.js/Vercel, Jest ESM, 405/409 errors, the other adapters' mount calls.

Live docs: <https://naldomadeira.github.io/worker-manager/> · HTTP API: <https://naldomadeira.github.io/worker-manager/openapi.json>
