# Hapi

[Hapi](https://hapi.dev/). `@worker-manager/hapi` registers as a Hapi plugin.

## Install

```sh
npm install @worker-manager/api @worker-manager/hapi
```

```ts
import { createWorkerManagerBoard } from '@worker-manager/api';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { HapiAdapter } from '@worker-manager/hapi';
import { Queue } from 'bullmq';
import Hapi from '@hapi/hapi';

const queue = new Queue('my-queue', {
  connection: { host: 'localhost', port: 6379 },
});

const app = Hapi.server({ port: 3000, host: 'localhost' });

const serverAdapter = new HapiAdapter();

createWorkerManagerBoard({
  queues: [new BullMQAdapter(queue)],
  serverAdapter,
});

serverAdapter.setBasePath('/ui');
await app.register(serverAdapter.registerPlugin(), {
  routes: { prefix: '/ui' },
});

await app.start();
```

`registerPlugin()` wires up Hapi's view and static-file plugins internally, you don't need `@hapi/inert` or `@hapi/vision`. The `routes.prefix` must match the base path.

## Full runnable examples

- Simple setup: [`examples/hapi/basic`](https://github.com/naldomadeira/worker-manager/tree/main/examples/hapi/basic)
- With basic auth: [`examples/hapi/auth`](https://github.com/naldomadeira/worker-manager/tree/main/examples/hapi/auth)

## Next steps

- [UIConfig](/configuration/ui-config): title, logo, locale, polling.
- [Read-only mode](/recipes/read-only-mode): disable destructive actions.
- [Visibility guard](/recipes/visibility-guard): scope visible queues per request.
- [Formatters](/recipes/formatters): rewrite job fields for the UI.
