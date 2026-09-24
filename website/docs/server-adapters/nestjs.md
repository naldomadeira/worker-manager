# NestJS

[NestJS](https://nestjs.com/). Worker Manager ships a NestJS module plus a plain adapter you can wire manually.

## Install

```sh
npm install @worker-manager/api @worker-manager/nestjs
```

Also install the adapter for the HTTP platform your Nest app uses (Express is the default):

```sh
npm install @worker-manager/express
# or, for Fastify:
npm install @worker-manager/fastify
```

## Supported NestJS versions

`@worker-manager/nestjs` supports NestJS 9, 10, 11 and 12. The suite runs against both 11 and 12 on
every CI build.

NestJS 12 ships as ESM only, so a Nest 12 application has to be ESM itself. `@worker-manager/nestjs`
is published as CommonJS and its named exports are importable from an ESM app, so nothing about
the setup below changes on Nest 12.

## Module-based setup (recommended)

Register `WorkerManagerModule.forRoot()` in your root module, then `WorkerManagerModule.forFeature()` per queue from the feature module.

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WorkerManagerModule } from '@worker-manager/nestjs';
import { ExpressAdapter } from '@worker-manager/express';
import { FeatureModule } from './feature/feature.module';

@Module({
  imports: [
    BullModule.forRoot({
      connection: { host: 'localhost', port: 6379 },
    }),
    WorkerManagerModule.forRoot({
      route: '/queues', // the default
      adapter: ExpressAdapter, // optional: detected from the Nest platform when left out
    }),
    FeatureModule,
  ],
})
export class AppModule {}
```

```ts
// feature/feature.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WorkerManagerModule } from '@worker-manager/nestjs';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'feature_queue' }),
    WorkerManagerModule.forFeature({
      name: 'feature_queue',
      adapter: BullMQAdapter, // or BullAdapter for Bull v3
    }),
  ],
})
export class FeatureModule {}
```

`forRoot()` options, all optional:

| Option | Default | |
|---|---|---|
| `route` | `'/queues'` | Base path where the dashboard is mounted, relative to the Nest global prefix. |
| `adapter` | auto-detected | Server adapter class (`ExpressAdapter` or `FastifyAdapter`). When left out, the module asks `HttpAdapterHost` which platform the app runs on and loads `@worker-manager/express` or `@worker-manager/fastify`, failing with an install hint if the package is missing. |
| `auth` | none | Built-in authentication (Basic or Keycloak). See [Authentication](#authentication). |
| `enabled` | `true` | `false` registers nothing: no routes, no middleware, `forFeature()` becomes a no-op and `@InjectWorkerManager()` resolves `null`. Handy to switch the board off per environment. |
| `readOnly` | `false` | Read-only mode for every queue registered through `queues` or `forFeature()`, unless the queue sets `options.readOnlyMode` itself. |
| `queues` | `[]` | Queues to register at the root without a separate `forFeature()` import. Same shape as `forFeature()` entries. |
| `uiConfig` | | Merged into `boardOptions.uiConfig`, taking precedence. |
| `title`, `logo`, `theme` | | Shortcuts for `uiConfig.boardTitle`, `uiConfig.boardLogo` and `uiConfig.theme`. |
| `boardOptions` | | Forwarded to `createWorkerManagerBoard` (e.g. `uiConfig`, `uiBasePath`). |
| `middleware` | | Optional Nest middleware on the board route. On Express it runs after `auth`; on Fastify it is Nest middleware on the exact `route`. |

```ts
WorkerManagerModule.forRoot({
  title: 'Ops queues',
  readOnly: process.env.NODE_ENV === 'production',
  enabled: process.env.QUEUE_BOARD !== 'off',
  queues: [{ name: 'emails', adapter: BullMQAdapter }],
});
```

`forFeature()` options (pass either `name` or `queue`):

- `name`: queue name registered with `BullModule.registerQueue`. The module resolves the instance from Nest's DI container.
- `queue`: a queue instance to register directly, instead of resolving it by `name`. See [Queues with the same name](#queues-with-the-same-name) below.
- `adapter`: `BullMQAdapter` or `BullAdapter`.
- `options`: queue adapter options like `readOnlyMode` or `description`.

To register several queues at once, pass multiple option objects:

```ts
WorkerManagerModule.forFeature(
  { name: 'emails', adapter: BullMQAdapter },
  { name: 'billing', adapter: BullMQAdapter },
);
```

### Queues with the same name

`@nestjs/bullmq` builds a queue's DI token from its `name` alone, and the `prefix` is not part of it. So if you run the same queue name under two prefixes (a common multi-tenant setup), both share one DI token and a `name` lookup can only ever return one of them. Registering both by `name` makes one queue shadow the other on the board.

Pass the instances directly via `queue` instead. Hold the queues somewhere you control (a provider, a service, wherever you created them) and hand them to `forFeature`:

```ts
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

The board keys entries by `prefix` + name, so the two show up as `tenant-a:emails` and `tenant-b:emails`. Set each adapter's `prefix` to match the queue's own prefix so the labels line up.

### Async configuration

`WorkerManagerModule.forRootAsync()` takes `imports` plus one of `useFactory` (with `inject`),
`useClass` or `useExisting`. The latter two name a provider implementing
`WorkerManagerOptionsFactory`:

```ts
import { Injectable, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  WorkerManagerModule,
  type WorkerManagerModuleOptions,
  type WorkerManagerOptionsFactory,
} from '@worker-manager/nestjs';

@Injectable()
class BoardConfig implements WorkerManagerOptionsFactory {
  constructor(private readonly config: ConfigService) {}

  createWorkerManagerOptions(): WorkerManagerModuleOptions {
    return {
      enabled: this.config.get('QUEUE_BOARD_ENABLED') !== 'false',
      readOnly: this.config.get('NODE_ENV') === 'production',
    };
  }
}

@Module({
  imports: [WorkerManagerModule.forRootAsync({ imports: [ConfigModule], useClass: BoardConfig })],
})
export class AppModule {}
```

## Authentication

`auth` puts [`@worker-manager/auth`](/recipes/keycloak-auth) in front of every board route: the
page, the API and the static assets. It works the same on Express and Fastify, and the mount path
includes the Nest global prefix.

### Basic

```ts
WorkerManagerModule.forRoot({
  auth: {
    strategy: 'basic',
    users: [{ username: 'admin', password: process.env.BOARD_PASSWORD!, roles: ['admin'] }],
  },
});
```

Unauthenticated requests get `401` with a `WWW-Authenticate: Basic` challenge and
`{ "error": { "key": "ERRORS.UNAUTHORIZED" } }`. Credentials are compared in constant time.

### Keycloak, configured from `ConfigService`

```ts
WorkerManagerModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    route: '/queues',
    auth: {
      strategy: 'keycloak',
      url: config.getOrThrow('KEYCLOAK_URL'), // https://sso.example.com
      realm: config.getOrThrow('KEYCLOAK_REALM'),
      clientId: config.getOrThrow('KEYCLOAK_CLIENT_ID'),
      clientSecret: config.get('KEYCLOAK_CLIENT_SECRET'),
      publicUrl: config.get('BOARD_PUBLIC_URL'), // e.g. https://api.example.com/queues
      requiredRoles: ['wm-admin'],
      cookie: { secret: config.getOrThrow('BOARD_SESSION_SECRET') },
    },
  }),
});
```

Browsers go through the OIDC authorization code flow with PKCE and get an encrypted session
cookie; API clients may send `Authorization: Bearer <access token>` instead. A user without one of
`requiredRoles` gets `403` with `ERRORS.FORBIDDEN`. The module also serves `GET /queues/auth/me`
and `GET /queues/auth/logout`. See [Keycloak auth](/recipes/keycloak-auth) for the Keycloak client
settings.

## PostgreSQL-backed queues

BullMQ v6 can store queues in PostgreSQL (see [PostgreSQL backend](/recipes/postgres-backend)).
Such a queue has no Redis connection and usually no DI token, so pass the instance:

```ts
import { Queue, createPostgresBackend } from 'bullmq'; // bullmq@6, plus the `pg` package
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';

const invoices = new Queue(
  'invoices',
  // `migrate: true` creates BullMQ's schema on first connect; see the PostgreSQL recipe.
  { connection: { connectionString: process.env.POSTGRES_URL, migrate: true } },
  createPostgresBackend
);

@Module({
  imports: [
    WorkerManagerModule.forRoot({
      queues: [{ queue: invoices, adapter: BullMQAdapter }],
    }),
  ],
})
export class AppModule {}
```

`@nestjs/bullmq` has no way to pass a backend factory, so PostgreSQL queues and their workers
are created with `bullmq` directly, as above, rather than through `BullModule.registerQueue` and
`@Processor`. Redis queues can keep using `@nestjs/bullmq` in the same app; if your Redis queues
must stay on BullMQ v5, install v6 under an alias for the Postgres ones
(`"bullmq-v6": "npm:bullmq@^6"`, then `import { Queue } from 'bullmq-v6'`).

If the queue is created inside a provider instead, inject the board with `@InjectWorkerManager()` and
call `board.addQueue(new BullMQAdapter(queue))` from `onModuleInit`. Redis and PostgreSQL queues can share one board; the datastore panel reports
Postgres stats for the Postgres queue.

### Running next to @bull-board/nestjs

Migrating one service at a time? Worker Manager's module registers its providers under its own
DI tokens (`worker_manager_*`) since 1.0.1, so the legacy `@bull-board/nestjs` module and this one
can be imported in the same app on different routes, each with its own `forFeature` queues.

You can inject the board instance anywhere:

```ts
import { Controller } from '@nestjs/common';
import { WorkerManagerBoard, InjectWorkerManager } from '@worker-manager/nestjs';

@Controller('ops')
export class OpsController {
  constructor(@InjectWorkerManager() private readonly board: WorkerManagerBoard) {}
}
```

## Plain adapter setup

If you'd rather wire the server adapter yourself (custom middleware, existing Nest conventions), do it in a module's `configure()`:

```ts
import {
  DynamicModule,
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { createWorkerManagerBoard } from '@worker-manager/api';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { ExpressAdapter } from '@worker-manager/express';
import { Queue } from 'bullmq';

@Module({})
export class QueuesModule implements NestModule {
  static register(): DynamicModule {
    return {
      module: QueuesModule,
      imports: [
        BullModule.forRoot({
          connection: { host: 'localhost', port: 6379 },
        }),
        BullModule.registerQueue({ name: 'test' }),
      ],
    };
  }

  constructor(private readonly testQueue: Queue) {}

  configure(consumer: MiddlewareConsumer) {
    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath('/queues');

    createWorkerManagerBoard({
      queues: [new BullMQAdapter(this.testQueue)],
      serverAdapter,
    });

    consumer.apply(serverAdapter.getRouter()).forRoutes('/queues');
  }
}
```

## Full runnable examples

- NestJS module (recommended): [`examples/with-nestjs-module`](https://github.com/naldomadeira/worker-manager/tree/main/examples/with-nestjs-module)
- Plain adapter: [`examples/with-nestjs`](https://github.com/naldomadeira/worker-manager/tree/main/examples/with-nestjs)
- Fastify platform with auth: [`examples/with-nestjs-fastify-auth`](https://github.com/naldomadeira/worker-manager/tree/main/examples/with-nestjs-fastify-auth)

## Next steps

- [UIConfig](/configuration/ui-config): title, logo, locale, polling.
- [Read-only mode](/recipes/read-only-mode): disable destructive actions.
- [Visibility guard](/recipes/visibility-guard): scope visible queues per request.
- [Formatters](/recipes/formatters): rewrite job fields for the UI.
