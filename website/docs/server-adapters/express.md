# Express

[Express.js](https://expressjs.com/). `@worker-manager/express` mounts as a sub-router under any path.

## Install

```sh
npm install @worker-manager/api @worker-manager/express
```

```ts
import { createWorkerManagerBoard } from '@worker-manager/api';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { ExpressAdapter } from '@worker-manager/express';
import { Queue } from 'bullmq';
import express from 'express';

const queue = new Queue('my-queue', {
  connection: { host: 'localhost', port: 6379 },
});

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createWorkerManagerBoard({
  queues: [new BullMQAdapter(queue)],
  serverAdapter,
});

const app = express();
app.use('/admin/queues', serverAdapter.getRouter());
app.listen(3000);
```

The path in `setBasePath()` must match the mount point in `app.use()`.

## Full runnable examples

- Simple setup: [`examples/express/basic`](https://github.com/naldomadeira/worker-manager/tree/main/examples/express/basic)
- With basic auth: [`examples/express/custom-login`](https://github.com/naldomadeira/worker-manager/tree/main/examples/express/custom-login)
- With CSRF: [`examples/express/csrf`](https://github.com/naldomadeira/worker-manager/tree/main/examples/express/csrf)
- Multiple dashboard instances: [`examples/express/multiple-boards`](https://github.com/naldomadeira/worker-manager/tree/main/examples/express/multiple-boards)

## Next steps

- [UIConfig](/configuration/ui-config): title, logo, locale, polling.
- [Read-only mode](/recipes/read-only-mode): disable destructive actions.
- [Visibility guard](/recipes/visibility-guard): scope visible queues per request.
- [Formatters](/recipes/formatters): rewrite job fields for the UI.
