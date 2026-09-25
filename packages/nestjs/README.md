# <img alt="Worker Manager" src="https://raw.githubusercontent.com/naldomadeira/worker-manager/main/packages/ui/src/static/images/logo.svg" width="35px" /> @worker-manager/nestjs

[NestJS](https://nestjs.com/) module for Worker Manager.

<p align="center">
  <a href="https://www.npmjs.com/package/@worker-manager/nestjs">
    <img alt="npm version" src="https://img.shields.io/npm/v/@worker-manager/nestjs">
  </a>
  <a href="https://www.npmjs.com/package/@worker-manager/nestjs">
    <img alt="npm downloads" src="https://img.shields.io/npm/dw/@worker-manager/nestjs">
  </a>
  <a href="https://github.com/naldomadeira/worker-manager/blob/main/LICENSE">
    <img alt="licence" src="https://img.shields.io/github/license/naldomadeira/worker-manager">
  </a>
<p>

![Overview](https://raw.githubusercontent.com/naldomadeira/worker-manager/main/screenshots/overview.png)
![UI](https://raw.githubusercontent.com/naldomadeira/worker-manager/main/screenshots/dashboard.png)

## Installation

Install both @worker-manager/api and this module.
```bash
$ npm install --save @worker-manager/nestjs @worker-manager/api
```

Install the Express or Fastify adapter depending on what you use in NestJS (default is Express)
```bash
$ npm install --save @worker-manager/express
//or 
$ npm install --save @worker-manager/fastify
```

## Register the root module
Once the installation is completed, we can import the `WorkerManagerModule` into your rootmodule e.g. `AppModule`.

```typescript
import { Module } from '@nestjs/common';
import { WorkerManagerModule } from "@worker-manager/nestjs";

@Module({
  imports: [
    BullModule.forRoot({
      // your bull module config here.
    }),

    // Served at /queues, with the adapter matching your Nest platform (Express or Fastify).
    WorkerManagerModule.forRoot(),
  ],
})
export class AppModule {
}
```

The `forRoot()` method registers the Worker Manager instance and allows you to pass several options to both the instance and module.
The following options are available, all optional.

| Option | Default | |
|---|---|---|
| `route` | `'/queues'` | Base route of the board, relative to the Nest global prefix. |
| `adapter` | auto-detected | `ExpressAdapter` (`@worker-manager/express`) or `FastifyAdapter` (`@worker-manager/fastify`). When omitted, the module reads the platform from `HttpAdapterHost` and loads the matching package. |
| `auth` | none | Built-in authentication, see [Authentication](#authentication). |
| `enabled` | `true` | `false` registers nothing: no routes, no middleware, `forFeature` becomes a no-op and the injected instance is `null`. |
| `readOnly` | `false` | Read-only mode for every queue registered through `queues` or `forFeature`, unless the queue sets `options.readOnlyMode` itself. |
| `queues` | `[]` | Queues to register at the root, same shape as `forFeature` entries. |
| `uiConfig` | | Merged into `boardOptions.uiConfig`. |
| `title` / `logo` / `theme` | | Shortcuts for `uiConfig.boardTitle`, `uiConfig.boardLogo`, `uiConfig.theme`. |
| `boardOptions` | | Options as provided by the Worker Manager package, such as `uiBasePath` and `uiConfig`. |
| `middleware` | | Nest middleware applied to the board route, after `auth` on Express. |

```typescript
WorkerManagerModule.forRoot({
  route: '/ops/queues',
  title: 'Ops queues',
  readOnly: process.env.NODE_ENV === 'production',
  enabled: process.env.QUEUE_BOARD !== 'off',
  queues: [{ name: 'emails', adapter: BullMQAdapter }],
}),
```

### Async configuration

`forRootAsync()` accepts `useFactory` + `inject`, `useClass` or `useExisting`, with `imports`:

```typescript
WorkerManagerModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    route: '/queues',
    enabled: config.get('QUEUE_BOARD_ENABLED') !== 'false',
    auth: {
      strategy: 'keycloak',
      url: config.getOrThrow('KEYCLOAK_URL'),
      realm: config.getOrThrow('KEYCLOAK_REALM'),
      clientId: config.getOrThrow('KEYCLOAK_CLIENT_ID'),
      clientSecret: config.get('KEYCLOAK_CLIENT_SECRET'),
      requiredRoles: ['wm-admin'],
      cookie: { secret: config.getOrThrow('SESSION_SECRET') },
    },
  }),
}),
```

```typescript
@Injectable()
class BoardConfig implements WorkerManagerOptionsFactory {
  constructor(private readonly config: ConfigService) {}

  createWorkerManagerOptions(): WorkerManagerModuleOptions {
    return { auth: { strategy: 'basic', users: [{ username: 'admin', password: this.config.getOrThrow('BOARD_PASSWORD') }] } };
  }
}

WorkerManagerModule.forRootAsync({ imports: [ConfigModule], useClass: BoardConfig }),
```

## Authentication

The `auth` option protects every board route (page, API, assets) with
[`@worker-manager/auth`](https://www.npmjs.com/package/@worker-manager/auth), on Express and
Fastify alike, and honours the Nest global prefix.

### Basic

```typescript
WorkerManagerModule.forRoot({
  auth: {
    strategy: 'basic',
    users: [{ username: 'admin', password: process.env.BOARD_PASSWORD, roles: ['admin'] }],
  },
}),
```

### Keycloak

```typescript
WorkerManagerModule.forRoot({
  auth: {
    strategy: 'keycloak',
    url: 'https://sso.example.com',
    realm: 'ops',
    clientId: 'worker-manager',
    clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
    publicUrl: 'https://api.example.com/queues', // the board's external URL, base path included
    requiredRoles: ['wm-admin'],
    cookie: { secret: process.env.SESSION_SECRET },
  },
}),
```

Browsers are sent through the OIDC authorization code flow (PKCE), API clients may send an
`Authorization: Bearer` access token. Register `https://api.example.com/queues/auth/callback` as a
redirect URI on the Keycloak client. The board serves `GET /queues/auth/me` (the signed-in user)
and `GET /queues/auth/logout`.

### Custom middleware

`middleware` still takes any Nest middleware, e.g. `express-basic-auth`. On Express it runs after
`auth`. On Fastify it is applied as Nest middleware to the exact `route`, before the board's own
hooks.

```typescript
import basicAuth from "express-basic-auth";

WorkerManagerModule.forRoot({
  route: "/queues",
  middleware: basicAuth({
    challenge: true,
    users: { admin: "passwordhere" },
  }),
}),
```

## Register your queues
To register a new queue, you need to register `WorkerManagerModule.forFeature` in the same module as where your queues are registered.

```typescript
import { Module } from '@nestjs/common';
import { WorkerManagerModule } from "@worker-manager/nestjs";
import { BullMQAdapter } from "@worker-manager/api/bullMQAdapter";
import { BullModule } from "@nestjs/bullmq";

@Module({
  imports: [
    BullModule.registerQueue(
      {
        name: 'my_awesome_queue'
      }
    ),
    
    WorkerManagerModule.forFeature({
      name: 'my_awesome_queue',
      adapter: BullMQAdapter, //or use BullAdapter if you're using bull instead of bullMQ
    }),
  ],
})
export class FeatureModule {}
```

The `forFeature` method registers the given queues to the Worker Manager instance.
The following options are available.
- `name` the queue name to resolve from the Nest DI container.
- `queue` a queue instance to register directly, instead of resolving it by `name`.
- `adapter` either `BullAdapter` or `BullMQAdapter` depending on which package you use.
- `options` queue adapter options as found in the Worker Manager package, such as `readOnlyMode`, `description` etc.

Provide either `name` or `queue`.

### PostgreSQL-backed queues (BullMQ v6)

A BullMQ v6 queue stored in PostgreSQL has no Redis connection and is usually not in the Nest
container, so hand the instance over directly:

```typescript
import { Queue, createPostgresBackend } from 'bullmq'; // bullmq@6, plus `pg`

const invoices = new Queue('invoices', { connection: process.env.POSTGRES_URL }, createPostgresBackend);

WorkerManagerModule.forRoot({
  queues: [{ queue: invoices, adapter: BullMQAdapter }],
}),
```

Redis and PostgreSQL queues can share one board.

### Registering queue instances directly

`@nestjs/bullmq` generates the DI token for a queue from its `name` only, ignoring the
`prefix`. Two queues that share a name but use different prefixes therefore collapse onto a
single DI token, and a `name`-based lookup cannot tell them apart. Pass the queue instances
directly via `queue` to register them as distinct board entries:

```typescript
@Module({
  imports: [
    WorkerManagerModule.forFeature(
      { queue: emailsTenantA, adapter: BullMQAdapter, options: { prefix: 'tenant-a:' } },
      { queue: emailsTenantB, adapter: BullMQAdapter, options: { prefix: 'tenant-b:' } },
    ),
  ],
})
export class FeatureModule {}
```

##  Using the Worker Manager instance in your controllers and/or services.
The created Worker Manager instance is available via the `@InjectWorkerManager()` decorator.
For example in a controller:

```typescript
import { Controller, Get } from "@nestjs/common";
import { WorkerManagerBoard, InjectWorkerManager } from "@worker-manager/nestjs";

@Controller('my-feature')
export class FeatureController {

  constructor(
    @InjectWorkerManager() private readonly boardInstance: WorkerManagerBoard
  ) {
  }
  
  //controller methods
}
```

# Usage examples
1. [Redis with `@nestjs/bullmq` and basic auth](https://github.com/naldomadeira/worker-manager/tree/main/examples/nestjs/redis)
2. [PostgreSQL-backed BullMQ v6 queues](https://github.com/naldomadeira/worker-manager/tree/main/examples/nestjs/postgres)
3. [Keycloak auth from `ConfigService`](https://github.com/naldomadeira/worker-manager/tree/main/examples/nestjs/keycloak)
4. [Fastify platform with a custom auth hook](https://github.com/naldomadeira/worker-manager/tree/main/examples/nestjs/fastify-custom-auth)

For more info visit the main [README](https://github.com/naldomadeira/worker-manager#readme)
