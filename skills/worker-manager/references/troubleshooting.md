# Troubleshooting and other adapters

Source of truth: <https://naldomadeira.github.io/worker-manager/recipes/troubleshooting>.

## Symptoms

| Symptom | Cause and fix |
|---|---|
| HTML loads, `/static/...` and `/api/...` 404 | `setBasePath` differs from the mount path. Make them the same string. |
| Same, only behind a proxy | Base path must be the path the **browser** sees. If the proxy strips the prefix, stop stripping or set the base path to the stripped value. |
| Counts right, every list empty, behind nginx | Proxy drops the query string (`proxy_pass` with a variable). Use `location ^~ /queues/ { proxy_pass http://app/queues/; }` or append `$is_args$args`. |
| `Cannot find module '@worker-manager/ui/package.json'` | Bundler (Next.js, esbuild, ncc, pruned Docker image) did not ship the UI. Set `options.uiBasePath` and/or include `node_modules/@worker-manager/ui/dist/**` (see Next.js below). |
| 500 on the root | Usually the missing-UI case above. A blank page with no failed request: the app's CSP blocks the board's scripts. |
| Destructive action returns 405 | Read-only mode (`readOnlyMode: true` / NestJS `readOnly`). Intended. |
| pg-boss write returns 409 `ERRORS.PGBOSS_WRITES_DISABLED` | Board cannot write safely (schema version mismatch with a `connection`-only board, or untested schema). Pass the app's `instance`, align pg-boss versions, or `allowUntestedSchema: true`. |
| pg-boss mutation route 404 | Board is `readOnly: true`; the routes are not registered. |
| pg-boss overview counters frozen | No app instance runs pg-boss `supervise` (the default). |
| `SchemaMigrationRequiredError` (BullMQ 6.3+ on Postgres) | Add `migrate: true` to the object connection or run BullMQ migrations. |
| Paused tab gone on BullMQ v6 | v6 has no paused state; jobs show under Waiting. Intended. |
| Retry/clean errors after an upgrade | Bull/BullMQ version mismatch between workers and the board; pin one version. |
| Count higher than the list, "Retry all" skips ids | Redis evicted job hashes: set `maxmemory-policy noeviction`. |
| NestJS: `could not pick a server adapter for the "unknown" HTTP platform` | Pre-2.2.0 in tests; upgrade, or pass `adapter` explicitly. |
| Jest (CommonJS): `Must use import to load ES Module` from `content-disposition` | `@fastify/static` 10.1.4+ pulls ESM-only `content-disposition@3`. Dedupe to `@fastify/static@9`, or transform that package with ts-jest (recipe has the config). |
| Fastify 4 version mismatch from `fastify-plugin` | The adapter needs Fastify 5. |
| Two NestJS/Express boards answer each other's paths | Nested routes (`/queues` and `/queues/ops`). Use sibling routes. |
| Keycloak redirect mismatch | Register `<publicUrl>/auth/callback` (per board) and set `publicUrl` behind proxies. |
| `pg-boss` board fails at startup on Node 20 | pg-boss needs Node 22.12+. |

## Next.js / Vercel

No Next.js adapter: use Hono in an App Router optional catch-all route,
`app/api/queues/[[...path]]/route.ts` (mirrors `examples/nextjs/app-router`):

```ts
import { serveStatic } from '@hono/node-server/serve-static';
import { createWorkerManagerBoard } from '@worker-manager/api';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { HonoAdapter } from '@worker-manager/hono';
import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import { queue } from '@/lib/queue';

export const runtime = 'nodejs'; // the UI is read from disk: no edge runtime
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

`next.config.js` (Next 15+; in 13/14 these live under `experimental`):

```js
module.exports = {
  serverExternalPackages: ['@worker-manager/api', '@worker-manager/ui', '@worker-manager/hono', 'bullmq'],
  outputFileTracingIncludes: { '/api/queues/*': ['./node_modules/@worker-manager/ui/dist/**/*'] },
  // monorepo: outputFileTracingRoot: require('path').join(__dirname, '../../'),
};
```

Keep the `Queue` on `globalThis` in dev to avoid leaking connections across hot reloads. Workers
cannot run in serverless functions: run them as a separate process. Pages Router: an Express
router in `pages/api/queues/[[...path]].ts` with `export const config = { api: { bodyParser: false, externalResolver: true } }`.
Protect the route (e.g. Next middleware, or wrap with `createAuthMiddleware(...).handle`) before deploying.

## Other server adapters (mount calls)

All take `setBasePath(path)` before mounting, except Elysia.

| Package | Mount |
|---|---|
| `@worker-manager/express` | `app.use(base, serverAdapter.getRouter())` |
| `@worker-manager/fastify` | `app.register(serverAdapter.registerPlugin(), { prefix: base })` |
| `@worker-manager/koa` | `app.use(serverAdapter.registerPlugin())` |
| `@worker-manager/hapi` | `await server.register(serverAdapter.registerPlugin(), { routes: { prefix: base } })` |
| `@worker-manager/hono` | `new HonoAdapter(serveStatic)`; `app.route(base, serverAdapter.registerPlugin())` |
| `@worker-manager/h3` | `app.use(serverAdapter.registerHandlers())` (h3 1.15+ or 2.x) |
| `@worker-manager/elysia` | `new ElysiaAdapter({ prefix, basePath })`; `app.use(await serverAdapter.registerPlugin())` |
| `@worker-manager/bun` | `Bun.serve({ routes: { ...serverAdapter.getRoutes(), ...yours } })` |

Per-adapter pages: <https://naldomadeira.github.io/worker-manager/server-adapters/>.
