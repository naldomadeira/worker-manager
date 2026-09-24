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

- Simple setup: [`examples/with-express`](https://github.com/naldomadeira/worker-manager/tree/main/examples/with-express)
- With basic auth: [`examples/with-express-auth`](https://github.com/naldomadeira/worker-manager/tree/main/examples/with-express-auth)
- With CSRF: [`examples/with-express-csrf`](https://github.com/naldomadeira/worker-manager/tree/main/examples/with-express-csrf)
- Multiple dashboard instances: [`examples/with-multiple-instances`](https://github.com/naldomadeira/worker-manager/tree/main/examples/with-multiple-instances)

## Next steps

- [UIConfig](/configuration/ui-config): title, logo, locale, polling.
- [Read-only mode](/recipes/read-only-mode): disable destructive actions.
- [Visibility guard](/recipes/visibility-guard): scope visible queues per request.
- [Formatters](/recipes/formatters): rewrite job fields for the UI.
