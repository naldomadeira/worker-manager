# <img alt="Worker Manager" src="https://raw.githubusercontent.com/naldomadeira/worker-manager/main/packages/ui/src/static/images/logo.svg" width="35px" /> @worker-manager

Dashboard UI for [Bull](https://github.com/OptimalBits/bull) and [BullMQ](https://github.com/taskforcesh/bullmq) job queues. Plug it into your server, see your queues.

<p align="center">
  <a href="https://www.npmjs.com/org/bull-board">
    <img alt="npm downloads" src="https://img.shields.io/npm/dw/@worker-manager/api">
  </a>
  <a href="https://github.com/naldomadeira/worker-manager/blob/main/LICENSE">
    <img alt="licence" src="https://img.shields.io/github/license/naldomadeira/worker-manager">
  </a>
  <img alt="open issues" src="https://img.shields.io/github/issues/naldomadeira/worker-manager"/>
</p>

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
    alt="bull-board dashboard"
    src="https://raw.githubusercontent.com/naldomadeira/worker-manager/main/website/docs/public/screenshots/dashboard-overview.png"
  />
</picture>

<sub>Light and dark ship together, and this picks whichever you are reading in.</sub>

[Documentation](#documentation) · [What you get](#what-you-get) · [Install](#install) · [Minimal Express example](#minimal-express-example) · [Historical metrics](#historical-metrics) · [Packages](#packages) · [Contributing](#contributing)

## Try it

If you already have a Redis with queues in it, one command gets you the dashboard:

```sh
npx @worker-manager/cli -r redis://localhost:6379
```

Or as a container, no Node needed ([docs](https://naldomadeira.github.io/worker-manager/guide/docker)):

```sh
docker run --rm -p 127.0.0.1:3000:3000 ghcr.io/naldomadeira/worker-manager --redis redis://host.docker.internal:6379
```

No install and no code. To embed it in your own app instead, read on.

## Documentation

The [docs](https://naldomadeira.github.io/worker-manager/) have guides, recipes, the UIConfig reference, and per-adapter setup. There's also a [live demo](https://naldomadeira.github.io/worker-manager/demo/) covering every view below.

## What you get

|   |   |
|---|---|
| [<img alt="Schedulers" src="https://raw.githubusercontent.com/naldomadeira/worker-manager/main/website/docs/public/screenshots/schedulers-page.png" width="420" />](https://naldomadeira.github.io/worker-manager/guide/exploring-the-dashboard)<br/>Every repeatable job across every queue, with its pattern or interval, when it next fires and when it last ran. Edit or remove one in place. | [<img alt="Historical metrics" src="https://raw.githubusercontent.com/naldomadeira/worker-manager/main/website/docs/public/screenshots/historical-metrics-page.png" width="420" />](https://naldomadeira.github.io/worker-manager/recipes/historical-metrics)<br/>Opt-in throughput and latency history over 90 days, per queue and board-wide. The storage panel tells you what keeping it costs. |
| [<img alt="Job flows" src="https://raw.githubusercontent.com/naldomadeira/worker-manager/main/website/docs/public/screenshots/flow-tree.png" width="420" />](https://naldomadeira.github.io/worker-manager/recipes/job-logs-and-flows)<br/>Parent and child jobs as one pannable graph, even when the children live in other queues, each with its own state and progress. Click a node to inspect it without leaving the page. Per-job logs alongside. | [<img alt="Whitelabel theming" src="https://raw.githubusercontent.com/naldomadeira/worker-manager/main/website/docs/public/screenshots/whitelabel-violet-dark.png" width="420" />](https://naldomadeira.github.io/worker-manager/recipes/whitelabel-theming)<br/>Design tokens named after the shadcn contract. Set `primary` and the focus ring, the sidebar and the selection states all follow it. |

## Install

Pick the adapter for your framework:

```sh
npm install @worker-manager/api @worker-manager/express
# or @worker-manager/fastify, @worker-manager/koa, @worker-manager/hapi,
# @worker-manager/nestjs, @worker-manager/hono, @worker-manager/h3,
# @worker-manager/elysia, @worker-manager/bun
```

Just want to look at a queue without wiring anything into your app? See the [CLI guide](https://naldomadeira.github.io/worker-manager/guide/cli).

## Minimal Express example

```js
const express = require('express');
const { Queue } = require('bullmq');
const { createBullBoard } = require('@worker-manager/api');
const { BullMQAdapter } = require('@worker-manager/api/bullMQAdapter');
const { ExpressAdapter } = require('@worker-manager/express');

const emailQueue = new Queue('emails', { connection: { host: 'localhost', port: 6379 } });

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter,
});

const app = express();

app.use('/admin/queues', serverAdapter.getRouter());

// other configurations of your server

app.listen(3000, () => {
  console.log('Running on 3000...');
  console.log('For the UI, open http://localhost:3000/admin/queues');
  console.log('Make sure Redis is running on port 6379 by default');
});
```

That's it! Now you can access the `/admin/queues` route, and you will be able to monitor everything that is happening in your queues 😁

See the [docs](https://naldomadeira.github.io/worker-manager/) for queue adapter options (read-only, retries, formatters, visibility guard), BullMQ Pro setup, board UI config, and more.

BullMQ `>= 5.56.0` and all of v6 are supported, including [v6 queues stored in PostgreSQL](https://naldomadeira.github.io/worker-manager/recipes/postgres-backend). The adapter detects which it has, so there is nothing to configure. See [supported versions](https://naldomadeira.github.io/worker-manager/queue-adapters/bullmq#supported-versions) for what CI tests and when the floor moves.

## Historical metrics

BullMQ keeps only a short ring buffer of per-minute metrics, so the throughput chart can't look back further than an hour or so. The optional `@worker-manager/metrics` package (beta) snapshots those metrics into long-retention Redis buckets and feeds them back to the board, which adds a Metrics history page and 7/30/90 day ranges on every queue chart. It is entirely opt-in: without it the core stays stateless and writes nothing.

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

Issues and PRs welcome. Check the [issues page](https://github.com/naldomadeira/worker-manager/issues) before opening a new one. When reporting a bug, include versions (Node, Redis, Bull/BullMQ, bull-board) and a minimal reproduction.

To develop locally:

```sh
git clone git@github.com:naldomadeira/worker-manager.git
cd bull-board
yarn && yarn dev:docker && yarn build && yarn dev
```

This starts Redis, builds the packages, and opens the dev server at `http://localhost:3000/ui`. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the monorepo layout, running tests and examples, and adding a new server adapter.

## Acknowledgements

- [Juan](https://github.com/joaomilho) for building the first version of this library.

## License

[MIT](https://github.com/naldomadeira/worker-manager/blob/main/LICENSE).
