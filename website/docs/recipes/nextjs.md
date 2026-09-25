# Next.js & Vercel

There is no dedicated Next.js adapter. Worker Manager runs inside a Next.js API
route using an existing adapter. Two runnable examples:

- [`examples/nextjs/app-router`](https://github.com/naldomadeira/worker-manager/tree/main/examples/nextjs/app-router): App Router, `@worker-manager/hono` adapter.
- [`examples/nextjs/pages-router`](https://github.com/naldomadeira/worker-manager/tree/main/examples/nextjs/pages-router): Pages Router, `@worker-manager/express` adapter.

Both deploy to Vercel. The mounting differs by router; the Vercel-specific
config is identical and is the part most people miss.

## App Router (Hono)

A single optional catch-all Route Handler at
`app/api/queues/[[...path]]/route.ts`:

```ts
import { createWorkerManagerBoard } from '@worker-manager/api';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { HonoAdapter } from '@worker-manager/hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import { queue } from '@/lib/queue';

export const runtime = 'nodejs';
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

## Pages Router (Express)

A single optional catch-all API route at `pages/api/queues/[[...path]].ts` that
delegates to an Express router. Disable `bodyParser` and enable
`externalResolver` so Express owns the response:

```ts
import { createWorkerManagerBoard } from '@worker-manager/api';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { ExpressAdapter } from '@worker-manager/express';
import express from 'express';
import { queue } from '../../../lib/queue';

const basePath = '/api/queues';
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath(basePath);

createWorkerManagerBoard({ queues: [new BullMQAdapter(queue)], serverAdapter });

const app = express();
app.use(basePath, serverAdapter.getRouter());

export const config = { api: { bodyParser: false, externalResolver: true } };

export default function handler(req, res) {
  return app(req, res);
}
```

## The Vercel fix (both routers)

`@worker-manager/api` finds the UI's compiled assets with
`eval(require.resolve('@worker-manager/ui/package.json'))`. The `eval` deliberately
hides the require from bundlers, and that includes Next.js's static file tracer
([`@vercel/nft`](https://github.com/vercel/nft)). On Vercel the UI files are
never copied into the function, so you get:

```
Error: Cannot find module '@worker-manager/ui/package.json'
```

Fix it in `next.config.js`:

```js
/** @type {import('next').NextConfig} */
module.exports = {
  // Resolve @worker-manager/* and bullmq from node_modules at runtime, not from the bundle.
  serverExternalPackages: ['@worker-manager/api', '@worker-manager/ui', 'bullmq'],

  // Force the compiled UI into the serverless function (the tracer can't see the eval).
  outputFileTracingIncludes: {
    '/api/queues/*': ['./node_modules/@worker-manager/ui/dist/**/*'],
  },
};
```

::: warning Monorepo
If `node_modules` is hoisted to a workspace root (e.g. `apps/web` in a Turborepo),
add `outputFileTracingRoot: path.join(__dirname, '../../')` so the included paths
resolve from the right place.
:::

`serverExternalPackages` and `outputFileTracingIncludes` are stable top-level
options in **Next.js 15+** (in 13/14 they lived under `experimental`).

### Alternative: `uiBasePath`

Instead of the trace config you can tell Worker Manager where the UI lives directly,
skipping the `eval(require.resolve(...))` entirely:

```ts
createWorkerManagerBoard({
  queues,
  serverAdapter,
  options: { uiBasePath: 'node_modules/@worker-manager/ui' },
});
```

You still need `outputFileTracingIncludes` so the files are actually deployed,
this only changes how the path is resolved, not whether the files are present.

## Workers

BullMQ workers are long-running and **cannot** run inside serverless functions.
Next.js (the dashboard and any job-producing routes) deploys to Vercel; the
worker runs as a separate always-on process: a container, a VM, or a dedicated
worker service. Both examples ship a standalone `worker.ts` for local
processing.
