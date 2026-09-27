# <img alt="Worker Manager" src="https://raw.githubusercontent.com/naldomadeira/worker-manager/main/packages/ui/src/static/images/logo.svg" width="35px" /> Worker Manager

A modern dashboard for [BullMQ](https://github.com/taskforcesh/bullmq) and [Bull](https://github.com/OptimalBits/bull) job queues, on **Redis or PostgreSQL**, plus a [pg-boss](https://github.com/timgit/pg-boss) engine, with **authentication built in**. Mount it in your NestJS, Express, Fastify or Next.js app, or run it standalone from the CLI or Docker.

> Worker Manager is a fork of the open-source bull-board project (MIT), rebuilt with a shadcn/ui + Tailwind CSS interface, first-class authentication and a richer NestJS module. Migrating means a scope rename, `@bull-board/*` → `@worker-manager/*`, plus the v2.0 product rename (`createBullBoard` → `createWorkerManagerBoard`, `BullBoardModule` → `WorkerManagerModule`, the `worker-manager` CLI binary and `WORKER_MANAGER_*` env vars); see the [v2.0.0 changelog](./CHANGELOG.md) for the full list.

<p align="center">
  <a href="https://www.npmjs.com/org/worker-manager">
    <img alt="npm downloads" src="https://img.shields.io/npm/dw/@worker-manager/api">
  </a>
  <a href="https://github.com/naldomadeira/worker-manager/blob/main/LICENSE">
    <img alt="licence" src="https://img.shields.io/github/license/naldomadeira/worker-manager">
  </a>
  <img alt="open issues" src="https://img.shields.io/github/issues/naldomadeira/worker-manager"/>
</p>

> [!TIP]
> **Using a coding agent?** Install the Worker Manager **agent skill** and ask for the dashboard in plain words ("add a queue dashboard behind Keycloak to this NestJS app"). It knows the engines (BullMQ on Redis or PostgreSQL, pg-boss), the nine server adapters, every auth strategy and the setup rules people get wrong by hand.
>
> **Claude Code**
> ```text
> /plugin marketplace add naldomadeira/worker-manager
> /plugin install worker-manager@worker-manager
> ```
> **Any agent with a skills folder** (one line)
> ```sh
> curl -fsSL https://naldomadeira.github.io/worker-manager/worker-manager-skill.zip -o /tmp/wm-skill.zip && unzip -o /tmp/wm-skill.zip -d ~/.claude/skills/
> ```
> Or [download the zip](https://naldomadeira.github.io/worker-manager/worker-manager-skill.zip). More in [Use it with an AI agent](#use-it-with-an-ai-agent).

<picture>
  <source
    media="(prefers-color-scheme: dark)"
    srcset="https://raw.githubusercontent.com/naldomadeira/worker-manager/main/website/docs/public/screenshots/dashboard-overview-dark.png"
  />
  <source
    media="(prefers-color-scheme: light)"
    srcset="https://raw.githubusercontent.com/naldomadeira/worker-manager/main/website/docs/public/screenshots/dashboard-overview.png"
  />
  <img
    alt="Worker Manager dashboard"
    src="https://raw.githubusercontent.com/naldomadeira/worker-manager/main/website/docs/public/screenshots/dashboard-overview.png"
  />
</picture>

<sub>Light and dark ship together, and this picks whichever you are reading in.</sub>

[What it does](#what-it-does) · [Try it](#try-it) · [Quick start](#quick-start) · [AI agents](#use-it-with-an-ai-agent) · [Authentication](#authentication) · [PostgreSQL](#postgresql) · [pg-boss](#pg-boss) · [Packages](#packages) · [Contributing](#contributing)

## What it does

Worker Manager shows your queues, jobs, schedulers and history in the browser, and lets you act on them: retry, promote, clean, pause, reschedule, send. It is a viewer that runs inside your server (or next to it), not a separate service.

**Engines and datastores.** A board runs one engine; mount two boards to see both.

| Engine | Datastore | Status |
|---|---|---|
| BullMQ `>= 5.56` and v6 | Redis (standalone, Sentinel, Cluster) | Stable |
| BullMQ v6 | PostgreSQL (`createPostgresBackend`) | Stable |
| Bull (and BullMQ Pro) | Redis | Stable |
| pg-boss `>= 12.24` (Node.js `>= 22.12`) | PostgreSQL | Stable since 2.4.0 |

**Authentication.** `@worker-manager/auth` protects the page, the API and the assets on every adapter, the NestJS module and the CLI:

- **Basic**: static users or a `validate(username, password)` callback, constant-time checks.
- **Keycloak / OpenID Connect**: authorization code flow with PKCE, AES-GCM encrypted session cookie with silent refresh, bearer tokens for scripts, `requiredRoles`.
- **Static token**: `Authorization: Bearer` or a header of your choice for scripts and agents, plus a built-in browser login form that trades the token for a `SameSite=Strict` session.
- **Custom**: your own `authenticate(req)`, for example a verified Cloudflare Access JWT or your app's API-key check.

**The dashboard.**

- KPI tiles, a status-filtered overview grouped by queue category, a collapsible sidebar and a `Ctrl/⌘ K` command palette.
- Job pages with data, logs, options, timeline and errors, plus hints for stalled, deduplicated and doomed jobs; reschedule delayed jobs and change priorities.
- Parent and child jobs as a pannable **flows graph**, across queues.
- **Schedulers** in a table and a day/week/month timeline, editable in place.
- **Metrics history** (opt-in `@worker-manager/metrics`, stored in Redis or PostgreSQL): 7/30/90 day throughput, a daily activity calendar, wait and run-time latency percentiles, queue age, and a storage panel.
- **Read-only mode**, per-request **visibility guard**, and access-control hooks per API call.
- **Whitelabel** theme tokens (shadcn contract), title, logo and environment badge; **12 languages**; light, dark and system themes; a phone layout.

**The pg-boss board.** Jobs in all six pg-boss states, cron and RRULE schedules, dead-letter origins, pg-boss's persisted warnings, a queue depth chart, bulk retry/cancel/resume/delete, job lookup by id from the command palette, and schema tolerance: a newer pg-boss schema is probed, not refused, and whatever it lacks is switched off and named. It never migrates, supervises or creates anything in your database.

**Integrations.** Nine server adapters (Express, Fastify, Koa, Hapi, NestJS, Hono, H3, Elysia, Bun), a NestJS module with platform auto-detection, async config and named boards, a Next.js recipe, the `worker-manager` CLI and the `ghcr.io/naldomadeira/worker-manager` Docker image.

## Try it

If you already have a Redis with queues in it, one command gets you the dashboard:

```sh
npx @worker-manager/cli -r redis://localhost:6379
```

Or as a container, no Node needed ([docs](https://naldomadeira.github.io/worker-manager/guide/docker)):

```sh
docker run --rm -p 127.0.0.1:3000:3000 ghcr.io/naldomadeira/worker-manager --redis redis://host.docker.internal:6379
```

`--postgres <url>` serves BullMQ v6 queues from PostgreSQL and `--pg-boss <url>` a pg-boss board. There's also a [live demo](https://naldomadeira.github.io/worker-manager/demo/), and a [pg-boss demo](https://naldomadeira.github.io/worker-manager/demo/pg-boss/).

## Quick start

### NestJS + BullMQ (Redis)

```sh
npm install @worker-manager/api @worker-manager/nestjs @worker-manager/express   # or @worker-manager/fastify
```

```ts
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { WorkerManagerModule } from '@worker-manager/nestjs';

@Module({
  imports: [
    BullModule.forRoot({ connection: { host: 'localhost', port: 6379 } }),
    BullModule.registerQueue({ name: 'emails' }),
    WorkerManagerModule.forRoot({
      route: '/queues', // Express or Fastify is detected, no adapter needed
      auth: {
        strategy: 'basic',
        users: [{ username: 'admin', password: process.env.BOARD_PASSWORD! }],
      },
    }),
    // Next to the queue's registerQueue; the queue is resolved from DI by name.
    WorkerManagerModule.forFeature({ name: 'emails', adapter: BullMQAdapter }),
  ],
})
export class AppModule {}
```

Open `http://localhost:3000/queues`. `forRootAsync` (with `useFactory`, `useClass` or `useExisting`), `readOnly`, `enabled`, `title`/`logo`/`theme`, Keycloak and token auth, named boards and PostgreSQL queues are in the [NestJS guide](https://naldomadeira.github.io/worker-manager/server-adapters/nestjs).

### NestJS + pg-boss

Needs Node.js 22.12+ and pg-boss 12.24+. Your app keeps starting pg-boss; the board reuses that instance.

```sh
npm install @worker-manager/api @worker-manager/nestjs @worker-manager/express @worker-manager/pg-boss
```

```ts
// boss.ts
import { PgBoss } from 'pg-boss';
export const boss = new PgBoss(process.env.DATABASE_URL!);

// main.ts
await boss.start();
const app = await NestFactory.create(AppModule);
await app.listen(3000); // http://localhost:3000/pg-boss

// app.module.ts
@Module({
  imports: [
    WorkerManagerModule.forRoot({
      route: '/pg-boss',
      engine: 'pg-boss',
      auth: { strategy: 'basic', users: [{ username: 'admin', password: process.env.BOARD_PASSWORD! }] },
      pgBoss: {
        instance: boss, // writes go through your instance
        connection: process.env.DATABASE_URL, // reads use a small pool with a real query timeout
      },
    }),
  ],
})
export class AppModule {}
```

Already have a BullMQ board? Keep it and give this one a `name: 'pgboss'`: two boards, two routes, one app. `pgBoss.useExisting` takes a provider token instead of `instance`. See the [NestJS pg-boss board](https://naldomadeira.github.io/worker-manager/server-adapters/nestjs#pg-boss-board) and the runnable [`examples/nestjs/pg-boss`](./examples/nestjs/pg-boss).

### Next.js (App Router)

There is no Next.js adapter; the Hono one runs in an optional catch-all Route Handler, `app/api/queues/[[...path]]/route.ts`:

```sh
npm install @worker-manager/api @worker-manager/hono hono @hono/node-server bullmq
```

```ts
import { serveStatic } from '@hono/node-server/serve-static';
import { createWorkerManagerBoard } from '@worker-manager/api';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { HonoAdapter } from '@worker-manager/hono';
import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import { queue } from '@/lib/queue';

export const runtime = 'nodejs'; // the UI is read from disk, so no edge runtime
export const dynamic = 'force-dynamic';

const basePath = '/api/queues';
const serverAdapter = new HonoAdapter(serveStatic);
serverAdapter.setBasePath(basePath);

createWorkerManagerBoard({ queues: [new BullMQAdapter(queue)], serverAdapter });

const app = new Hono();
app.route(basePath, serverAdapter.registerPlugin());

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
```

On Vercel, add `serverExternalPackages` and `outputFileTracingIncludes` for `@worker-manager/ui` to `next.config.js`, and run workers as a separate process. For pg-boss, swap `createWorkerManagerBoard` for `createPgBossBoard({ serverAdapter, pgBoss: { connection: process.env.DATABASE_URL } })` from `@worker-manager/pg-boss` (that variation is not one of the runnable examples). Put auth in front before deploying. See the [Next.js & Vercel recipe](https://naldomadeira.github.io/worker-manager/recipes/nextjs) and [`examples/nextjs/app-router`](./examples/nextjs/app-router).

### Express

```js
const express = require('express');
const { Queue } = require('bullmq');
const { createWorkerManagerBoard } = require('@worker-manager/api');
const { BullMQAdapter } = require('@worker-manager/api/bullMQAdapter');
const { ExpressAdapter } = require('@worker-manager/express');

const emailQueue = new Queue('emails', { connection: { host: 'localhost', port: 6379 } });

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues'); // must equal the mount path below

createWorkerManagerBoard({ queues: [new BullMQAdapter(emailQueue)], serverAdapter });

const app = express();
app.use('/admin/queues', serverAdapter.getRouter()); // add auth in front, see below
app.listen(3000);
```

Every other framework follows the same shape; see the [server adapters](https://naldomadeira.github.io/worker-manager/server-adapters/) and the [docs](https://naldomadeira.github.io/worker-manager/) for queue adapter options (read-only, retries, formatters, visibility guard), BullMQ Pro and UIConfig. See [supported versions](https://naldomadeira.github.io/worker-manager/queue-adapters/bullmq#supported-versions) for what CI tests.

## Use it with an AI agent

The **Worker Manager agent skill** teaches a coding agent the choices above (engine, server adapter, auth strategy) and the rules people get wrong by hand, with ready setups for NestJS, Express, Fastify and pg-boss. Install it any of three ways:

- **Claude Code plugin**: `/plugin marketplace add naldomadeira/worker-manager`, then `/plugin install worker-manager@worker-manager`.
- **Zip**: download [`worker-manager-skill.zip`](https://naldomadeira.github.io/worker-manager/worker-manager-skill.zip) and unzip it into your agent's skills folder.
- **One line**:

  ```sh
  curl -fsSL https://naldomadeira.github.io/worker-manager/worker-manager-skill.zip -o /tmp/wm-skill.zip && unzip -o /tmp/wm-skill.zip -d ~/.claude/skills/
  ```

  Use `-d .claude/skills/` instead to add it to one project. Other agents that read skill folders can use the same `worker-manager/` folder.

Then ask for it in plain words ("add a queue dashboard behind Keycloak to this NestJS app"). The skill lives in [`skills/worker-manager`](./skills/worker-manager); the [AI agent guide](https://naldomadeira.github.io/worker-manager/guide/ai-agent-setup) also has a copy-paste prompt and the `llms.txt` / OpenAPI files for agents.

## What you get

|   |   |
|---|---|
| [<img alt="Schedulers" src="https://raw.githubusercontent.com/naldomadeira/worker-manager/main/website/docs/public/screenshots/schedulers-page.png" width="420" />](https://naldomadeira.github.io/worker-manager/guide/exploring-the-dashboard)<br/>Every repeatable job across every queue, with its pattern or interval, when it next fires and when it last ran. Edit or remove one in place. | [<img alt="Historical metrics" src="https://raw.githubusercontent.com/naldomadeira/worker-manager/main/website/docs/public/screenshots/historical-metrics-page.png" width="420" />](https://naldomadeira.github.io/worker-manager/recipes/historical-metrics)<br/>Opt-in throughput and latency history over 90 days, per queue and board-wide. The storage panel tells you what keeping it costs. |
| [<img alt="Job flows" src="https://raw.githubusercontent.com/naldomadeira/worker-manager/main/website/docs/public/screenshots/flow-tree.png" width="420" />](https://naldomadeira.github.io/worker-manager/recipes/job-logs-and-flows)<br/>Parent and child jobs as one pannable graph, even when the children live in other queues, each with its own state and progress. Click a node to inspect it without leaving the page. Per-job logs alongside. | [<img alt="Whitelabel theming" src="https://raw.githubusercontent.com/naldomadeira/worker-manager/main/website/docs/public/screenshots/whitelabel-violet-dark.png" width="420" />](https://naldomadeira.github.io/worker-manager/recipes/whitelabel-theming)<br/>Design tokens named after the shadcn contract. Set `primary` and the focus ring, the sidebar and the selection states all follow it. |
| [<img alt="pg-boss overview" src="https://raw.githubusercontent.com/naldomadeira/worker-manager/main/website/docs/public/screenshots/pgboss-overview.png" width="420" />](https://naldomadeira.github.io/worker-manager/queue-adapters/pg-boss)<br/>The pg-boss board: pg-boss's cached counters as KPI tiles and one card per queue with its policy. | [<img alt="Daily activity" src="https://raw.githubusercontent.com/naldomadeira/worker-manager/main/website/docs/public/screenshots/metrics-activity.png" width="420" />](https://naldomadeira.github.io/worker-manager/guide/exploring-the-dashboard#metrics-history)<br/>Daily activity: completed jobs, failures or the failure rate as a calendar, with the peak day and the average per weekday. |

## Authentication

`@worker-manager/auth` is a framework-agnostic middleware. The NestJS module and the CLI use it for you; with any other adapter, mount it in front of the board:

```ts
import { createAuthMiddleware } from '@worker-manager/auth';

app.use(
  '/admin/queues',
  createAuthMiddleware(
    { strategy: 'basic', users: [{ username: 'ops', password: process.env.BOARD_PASSWORD! }] },
    { basePath: '/admin/queues' }
  ),
  serverAdapter.getRouter()
);
```

Four strategies, all with constant-time credential checks and the same `req.user`, `onAuthenticated` hook and `GET <base>/auth/me` endpoint:

| Strategy | For | |
|---|---|---|
| `basic` | A quick shared login | Static users or a `validate(username, password)` callback, HTTP Basic challenge. |
| `keycloak` | Single sign-on | OIDC with PKCE, an AES-GCM encrypted session cookie, silent refresh, bearer tokens for scripts and `requiredRoles`. |
| `token` | Internal boards and scripts | Static tokens (or `validate(token)`) in `Authorization: Bearer` or a header of your choice; browsers type the token once into a built-in login form and get a `SameSite=Strict` encrypted session cookie. |
| `custom` | Anything else | Your `authenticate(req)`, e.g. a verified Cloudflare Access JWT or your app's API-key check. |

```ts
WorkerManagerModule.forRoot({
  route: '/admin/queues',
  auth: {
    strategy: 'token',
    tokens: [process.env.BOARD_TOKEN!],
    header: 'X-Board-Token',
    cookie: { secret: process.env.BOARD_SESSION_SECRET! },
  },
});
```

See the [Basic auth](https://naldomadeira.github.io/worker-manager/recipes/basic-auth), [Keycloak](https://naldomadeira.github.io/worker-manager/recipes/keycloak-auth), [Token](https://naldomadeira.github.io/worker-manager/recipes/token-auth) and [Custom](https://naldomadeira.github.io/worker-manager/recipes/custom-auth) recipes.

## PostgreSQL

BullMQ v6 can store queues in PostgreSQL. Hand those queues to the board like any other; the stats panel reports the Postgres datastore instead of Redis:

```ts
import { Queue, createPostgresBackend } from 'bullmq';

const invoices = new Queue('invoices', { connection: { connectionString: process.env.POSTGRES_URL, migrate: true } }, createPostgresBackend);
createWorkerManagerBoard({ queues: [new BullMQAdapter(invoices)], serverAdapter });
```

The CLI discovers them for you: `npx @worker-manager/cli --postgres postgres://user:pass@host/db`. See the [PostgreSQL recipe](https://naldomadeira.github.io/worker-manager/recipes/postgres-backend).

## pg-boss

A board runs one engine. Besides BullMQ and Bull, there is a [pg-boss](https://github.com/timgit/pg-boss) engine, for pg-boss 12.24 and later on Node.js 22.12 and later. It reads the pg-boss tables with plain SQL and writes through the pg-boss API, and never migrates, supervises or creates anything in your database. It is stable since 2.4.0 and follows semver like the BullMQ engine: a breaking change to its screens' behaviour or to the `/api/pg-boss` HTTP contract only ships in a major.

```sh
npm install @worker-manager/pg-boss
```

```ts
import { createPgBossBoard } from '@worker-manager/pg-boss';

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/pg-boss');
createPgBossBoard({ serverAdapter, pgBoss: { instance: boss, connection: process.env.DATABASE_URL } });
app.use('/pg-boss', serverAdapter.getRouter());
```

The NestJS module mounts it as a named board next to a BullMQ one (`engine: 'pg-boss'`), and the CLI serves it with `--pg-boss <url>`. See the [pg-boss docs](https://naldomadeira.github.io/worker-manager/queue-adapters/pg-boss), or the [pg-boss demo](https://naldomadeira.github.io/worker-manager/demo/pg-boss/).

## Playground

```sh
yarn install && yarn build
yarn playground:infra          # Redis, PostgreSQL and Keycloak in Docker
cp playground/.env.example playground/.env
yarn playground                # http://localhost:3100/queues
yarn workspace @worker-manager/playground smoke
```

Switch `WM_AUTH` between `none`, `basic` and `keycloak` in `playground/.env`. See the [playground guide](https://naldomadeira.github.io/worker-manager/guide/playground).

## Historical metrics

BullMQ keeps only a short ring buffer of per-minute metrics, so the throughput chart can't look back further than an hour or so. The optional `@worker-manager/metrics` package snapshots those metrics into long-retention buckets in Redis or PostgreSQL and feeds them back to the board, which adds a Metrics history page (throughput, daily activity, latency, storage) and 7/30/90 day ranges on every queue chart. It is entirely opt-in: without it the core stays stateless and writes nothing.

```sh
npm install @worker-manager/metrics
```

The CLI and the Docker image carry the package already, so `--history` turns the same thing on with nothing to install:

```sh
npx @worker-manager/cli -r redis://localhost:6379 --history
```

See the [historical metrics recipe](https://naldomadeira.github.io/worker-manager/recipes/historical-metrics) for the recorder setup and storage sizing, or try it on the [live demo](https://naldomadeira.github.io/worker-manager/demo/).

## Packages

| Name                                                                     | Version                                                  | Downloads                                                                         |
| ------------------------------------------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [@worker-manager/api](https://www.npmjs.com/package/@worker-manager/api)         | ![npm](https://img.shields.io/npm/v/@worker-manager/api)     | <img alt="npm downloads" src="https://img.shields.io/npm/dw/@worker-manager/api">     |
| [@worker-manager/ui](https://www.npmjs.com/package/@worker-manager/ui)           | ![npm](https://img.shields.io/npm/v/@worker-manager/ui)      | <img alt="npm downloads" src="https://img.shields.io/npm/dw/@worker-manager/ui">      |
| [@worker-manager/auth](https://www.npmjs.com/package/@worker-manager/auth)           | ![npm](https://img.shields.io/npm/v/@worker-manager/auth)      | <img alt="npm downloads" src="https://img.shields.io/npm/dw/@worker-manager/auth">      |
| [@worker-manager/pg-boss](https://www.npmjs.com/package/@worker-manager/pg-boss) | ![npm](https://img.shields.io/npm/v/@worker-manager/pg-boss) | <img alt="npm downloads" src="https://img.shields.io/npm/dw/@worker-manager/pg-boss"> |
| [@worker-manager/metrics](https://www.npmjs.com/package/@worker-manager/metrics) | ![npm](https://img.shields.io/npm/v/@worker-manager/metrics) | <img alt="npm downloads" src="https://img.shields.io/npm/dw/@worker-manager/metrics"> |
| [@worker-manager/cli](https://www.npmjs.com/package/@worker-manager/cli)         | ![npm](https://img.shields.io/npm/v/@worker-manager/cli)     | <img alt="npm downloads" src="https://img.shields.io/npm/dw/@worker-manager/cli">     |
| [@worker-manager/express](https://www.npmjs.com/package/@worker-manager/express) | ![npm](https://img.shields.io/npm/v/@worker-manager/express) | <img alt="npm downloads" src="https://img.shields.io/npm/dw/@worker-manager/express"> |
| [@worker-manager/fastify](https://www.npmjs.com/package/@worker-manager/fastify) | ![npm](https://img.shields.io/npm/v/@worker-manager/fastify) | <img alt="npm downloads" src="https://img.shields.io/npm/dw/@worker-manager/fastify"> |
| [@worker-manager/koa](https://www.npmjs.com/package/@worker-manager/koa)         | ![npm](https://img.shields.io/npm/v/@worker-manager/koa)     | <img alt="npm downloads" src="https://img.shields.io/npm/dw/@worker-manager/koa">     |
| [@worker-manager/hapi](https://www.npmjs.com/package/@worker-manager/hapi)       | ![npm](https://img.shields.io/npm/v/@worker-manager/hapi)    | <img alt="npm downloads" src="https://img.shields.io/npm/dw/@worker-manager/hapi">    |
| [@worker-manager/nestjs](https://www.npmjs.com/package/@worker-manager/nestjs)   | ![npm](https://img.shields.io/npm/v/@worker-manager/nestjs)  | <img alt="npm downloads" src="https://img.shields.io/npm/dw/@worker-manager/nestjs">  |
| [@worker-manager/hono](https://www.npmjs.com/package/@worker-manager/hono)       | ![npm](https://img.shields.io/npm/v/@worker-manager/hono)    | <img alt="npm downloads" src="https://img.shields.io/npm/dw/@worker-manager/hono">    |
| [@worker-manager/h3](https://www.npmjs.com/package/@worker-manager/h3)           | ![npm](https://img.shields.io/npm/v/@worker-manager/h3)      | <img alt="npm downloads" src="https://img.shields.io/npm/dw/@worker-manager/h3">      |
| [@worker-manager/elysia](https://www.npmjs.com/package/@worker-manager/elysia)   | ![npm](https://img.shields.io/npm/v/@worker-manager/elysia)  | <img alt="npm downloads" src="https://img.shields.io/npm/dw/@worker-manager/elysia">  |
| [@worker-manager/bun](https://www.npmjs.com/package/@worker-manager/bun)         | ![npm](https://img.shields.io/npm/v/@worker-manager/bun)     | <img alt="npm downloads" src="https://img.shields.io/npm/dw/@worker-manager/bun">     |

## Contributing

Issues and PRs welcome. Check the [issues page](https://github.com/naldomadeira/worker-manager/issues) before opening a new one. When reporting a bug, include versions (Node, Redis or PostgreSQL, Bull/BullMQ, Worker Manager) and a minimal reproduction.

To develop locally:

```sh
git clone git@github.com:naldomadeira/worker-manager.git
cd worker-manager
yarn && yarn dev:docker && yarn build && yarn dev
```

This starts Redis, builds the packages, and opens the dev server at `http://localhost:3000/ui`. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the monorepo layout, running tests and examples, and adding a new server adapter.

## License

[MIT](https://github.com/naldomadeira/worker-manager/blob/main/LICENSE).
