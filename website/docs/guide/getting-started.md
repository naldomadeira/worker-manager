# Installation

Install the core `@worker-manager/api` plus one adapter for your framework.

::: tip Using a coding agent? Install the agent skill
Claude Code: `/plugin marketplace add naldomadeira/worker-manager`, then `/plugin install worker-manager@worker-manager`.
Any agent with a skills folder:

```sh
curl -fsSL https://naldomadeira.github.io/worker-manager/worker-manager-skill.zip -o /tmp/wm-skill.zip && unzip -o /tmp/wm-skill.zip -d ~/.claude/skills/
```

Then ask for the dashboard in plain words. See [AI agent skill & setup](/guide/ai-agent-setup#install-the-agent-skill).
:::

## Prerequisites

- Node.js 20+ or Bun 1.x. CI covers Node 20, 22 and 24.
- A running Redis instance
- [Bull](https://github.com/OptimalBits/bull) or [BullMQ](https://docs.bullmq.io/) already set up in your app

::: tip Sharing an ioredis connection?
Worker Manager reads your existing Bull/BullMQ queues, so it inherits their Redis connection. If you construct BullMQ with a shared `ioredis` instance rather than a plain `{ host, port }`, BullMQ requires that connection to be created with `maxRetriesPerRequest: null`. This is a BullMQ requirement, not a Worker Manager one, but it's the most common setup snag. See the [BullMQ connection docs](https://docs.bullmq.io/guide/connections).
:::

## Install

Pick the adapter that matches your framework:

| Framework | Install command |
|-----------|-----------------|
| Express   | `npm install @worker-manager/api @worker-manager/express` |
| Fastify   | `npm install @worker-manager/api @worker-manager/fastify` |
| NestJS    | `npm install @worker-manager/api @worker-manager/nestjs` |
| Koa       | `npm install @worker-manager/api @worker-manager/koa` |
| Hapi      | `npm install @worker-manager/api @worker-manager/hapi` |
| Hono      | `npm install @worker-manager/api @worker-manager/hono` |
| H3        | `npm install @worker-manager/api @worker-manager/h3` |
| Elysia    | `npm install @worker-manager/api @worker-manager/elysia` |
| Bun       | `npm install @worker-manager/api @worker-manager/bun` |

## Next steps

- [Build your first dashboard](/guide/your-first-dashboard) for a framework-agnostic walkthrough.
- Or jump to your adapter: [Express](/server-adapters/express), [Fastify](/server-adapters/fastify), [Koa](/server-adapters/koa), [Hapi](/server-adapters/hapi), [NestJS](/server-adapters/nestjs), [Hono](/server-adapters/hono), [H3](/server-adapters/h3), [Elysia](/server-adapters/elysia), [Bun](/server-adapters/bun).
