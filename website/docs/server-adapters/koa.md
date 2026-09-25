# Koa

[Koa](https://koajs.com/). `@worker-manager/koa` gives you middleware to mount on your app.

## Install

```sh
npm install @worker-manager/api @worker-manager/koa
```

```ts
import { createWorkerManagerBoard } from '@worker-manager/api';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { KoaAdapter } from '@worker-manager/koa';
import { Queue } from 'bullmq';
import Koa from 'koa';

const queue = new Queue('my-queue', {
  connection: { host: 'localhost', port: 6379 },
});

const app = new Koa();

const serverAdapter = new KoaAdapter();

createWorkerManagerBoard({
  queues: [new BullMQAdapter(queue)],
  serverAdapter,
});

serverAdapter.setBasePath('/ui');
app.use(serverAdapter.registerPlugin());

app.listen(3000);
```

`registerPlugin()` returns Koa middleware. Mount it after `setBasePath()`.

## Full runnable example

- Simple setup: [`examples/more/koa`](https://github.com/naldomadeira/worker-manager/tree/main/examples/more/koa)

## Next steps

- [UIConfig](/configuration/ui-config): title, logo, locale, polling.
- [Read-only mode](/recipes/read-only-mode): disable destructive actions.
- [Visibility guard](/recipes/visibility-guard): scope visible queues per request.
- [Formatters](/recipes/formatters): rewrite job fields for the UI.
