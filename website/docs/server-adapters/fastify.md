# Fastify

[Fastify](https://fastify.dev/). `@worker-manager/fastify` registers as a plugin.

## Install

```sh
npm install @worker-manager/api @worker-manager/fastify
```

::: warning Fastify 5 only
The adapter bundles `@fastify/static` and `@fastify/view`, both of which target `fastify@5`. Registering it on `fastify@4` throws a version mismatch from `fastify-plugin` before the dashboard ever serves a request. Upgrade Fastify, or mount the dashboard on a separate Express instance instead.
:::

```ts
import { createWorkerManagerBoard } from '@worker-manager/api';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { FastifyAdapter } from '@worker-manager/fastify';
import { Queue } from 'bullmq';
import Fastify from 'fastify';

const queue = new Queue('my-queue', {
  connection: { host: 'localhost', port: 6379 },
});

const app = Fastify();

const serverAdapter = new FastifyAdapter();

createWorkerManagerBoard({
  queues: [new BullMQAdapter(queue)],
  serverAdapter,
});

serverAdapter.setBasePath('/ui');
await app.register(serverAdapter.registerPlugin(), { prefix: '/ui' });

await app.listen({ host: '0.0.0.0', port: 3000 });
```

`FastifyAdapter` takes the base path from `setBasePath()` or the `prefix` option on `app.register()`. If you set both, they must match, otherwise asset URLs will 404.

::: tip
Top-level `await` in the example. Wrap the body in `async function main() { ... }; main()` if you're on plain CommonJS.
:::

## Full runnable examples

- Simple setup: [`examples/fastify/basic`](https://github.com/naldomadeira/worker-manager/tree/main/examples/fastify/basic)
- With basic auth: [`examples/fastify/auth`](https://github.com/naldomadeira/worker-manager/tree/main/examples/fastify/auth)
- With visibility guard: [`examples/fastify/visibility-guard`](https://github.com/naldomadeira/worker-manager/tree/main/examples/fastify/visibility-guard)

## Next steps

- [UIConfig](/configuration/ui-config): title, logo, locale, polling.
- [Read-only mode](/recipes/read-only-mode): disable destructive actions.
- [Visibility guard](/recipes/visibility-guard): scope visible queues per request.
- [Formatters](/recipes/formatters): rewrite job fields for the UI.
