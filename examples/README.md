# Examples

Each directory is a standalone project that installs the published `@worker-manager/*` packages.
Open its README for the commands to run it.

## NestJS

- [`nestjs/redis`](./nestjs/redis): NestJS 11 with `@nestjs/bullmq` on Redis, `forRoot` + `forFeature`, basic auth.
- [`nestjs/postgres`](./nestjs/postgres): BullMQ v6 queues stored in PostgreSQL, registered through the root `queues` option, basic auth.
- [`nestjs/keycloak`](./nestjs/keycloak): `@nestjs/bullmq` on Redis behind Keycloak, configured with `forRootAsync` and `ConfigService`.
- [`nestjs/pg-boss`](./nestjs/pg-boss): placeholder until the pg-boss engine ships.
- [`nestjs/fastify-custom-auth`](./nestjs/fastify-custom-auth): Nest on the Fastify platform with a custom session login in front of the board.

## Express

- [`express/basic`](./express/basic): the minimal Express setup.
- [`express/custom-login`](./express/custom-login): a Passport local login page in front of the board.
- [`express/csrf`](./express/csrf): CSRF protection with `csrf-csrf`.
- [`express/multiple-boards`](./express/multiple-boards): two boards mounted in one app.

## Fastify

- [`fastify/basic`](./fastify/basic): the minimal Fastify setup.
- [`fastify/auth`](./fastify/auth): basic auth and a cookie login, side by side.
- [`fastify/visibility-guard`](./fastify/visibility-guard): per-user queue visibility with `visibilityGuard`.

## Next.js

- [`nextjs/app-router`](./nextjs/app-router): App Router with the Hono adapter, deployable to Vercel.
- [`nextjs/pages-router`](./nextjs/pages-router): Pages Router with the Express adapter, deployable to Vercel.

## Hapi

- [`hapi/basic`](./hapi/basic): the minimal Hapi setup.
- [`hapi/auth`](./hapi/auth): basic auth with `@hapi/basic`.

## More

- [`more/bun`](./more/bun): Bun's native HTTP server.
- [`more/elysia`](./more/elysia): Elysia on Bun.
- [`more/h3`](./more/h3): h3.
- [`more/hono`](./more/hono): Hono.
- [`more/koa`](./more/koa): Koa.
- [`more/sails`](./more/sails): Sails, through the Express adapter.
