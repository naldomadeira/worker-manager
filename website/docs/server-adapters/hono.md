# Hono

[Hono](https://hono.dev/). `@worker-manager/hono` gives you a Hono sub-app.

## Install

```sh
npm install @worker-manager/api @worker-manager/hono @hono/node-server
```

`@hono/node-server` is only for Node.js. On Bun, Deno, or Workers bring your own serve function, see the [Hono docs](https://hono.dev/docs/getting-started/basic).

```ts
import { createWorkerManagerBoard } from '@worker-manager/api';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { HonoAdapter } from '@worker-manager/hono';
import { Queue } from 'bullmq';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';

const queue = new Queue('my-queue', {
  connection: { host: 'localhost', port: 6379 },
});

const app = new Hono();

const serverAdapter = new HonoAdapter(serveStatic);

createWorkerManagerBoard({
  queues: [new BullMQAdapter(queue)],
  serverAdapter,
});

const basePath = '/ui';
serverAdapter.setBasePath(basePath);
app.route(basePath, serverAdapter.registerPlugin());

serve({ fetch: app.fetch, port: 3000 });
```

`serve` and `serveStatic` depend on the runtime, check the example for Node, Bun, Deno variants. `HonoAdapter` takes the runtime's `serveStatic` helper in the constructor so it can serve the bundled UI assets.

## Full runnable example

- Simple setup: [`examples/more/hono`](https://github.com/naldomadeira/worker-manager/tree/main/examples/more/hono)

## Next steps

- [UIConfig](/configuration/ui-config): title, logo, locale, polling.
- [Read-only mode](/recipes/read-only-mode): disable destructive actions.
- [Visibility guard](/recipes/visibility-guard): scope visible queues per request.
- [Formatters](/recipes/formatters): rewrite job fields for the UI.
