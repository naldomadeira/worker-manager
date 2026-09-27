# NestJS reference

Source of truth: <https://naldomadeira.github.io/worker-manager/server-adapters/nestjs>.
Supports NestJS 9, 10, 11 and 12 (12 is ESM only; the CommonJS package imports fine from an ESM app).

```sh
npm install @worker-manager/api @worker-manager/nestjs @worker-manager/express   # or @worker-manager/fastify
npm install @worker-manager/pg-boss                                              # only for engine: 'pg-boss'
```

`@worker-manager/auth` comes with the module. When `adapter` is omitted the module asks
`HttpAdapterHost` for the platform and loads `@worker-manager/express` or `@worker-manager/fastify`,
failing with an install hint if it is missing.

## `WorkerManagerModule.forRoot(options)`

All optional.

| Option | Default | Notes |
|---|---|---|
| `name` | none | Named board with its own DI tokens (several boards per app). Letters, digits, `.`, `_`, `-`. |
| `engine` | `'bullmq'` | `'pg-boss'` mounts a pg-boss board. |
| `pgBoss` | | pg-boss board config; only valid with `engine: 'pg-boss'`. |
| `route` | `'/queues'` | Relative to the Nest global prefix. |
| `adapter` | auto | `ExpressAdapter` or `FastifyAdapter` class. |
| `auth` | none | `@worker-manager/auth` options, see [auth.md](auth.md). Guards page, API and assets. |
| `enabled` | `true` | `false`: no routes, `forFeature` is a no-op, `@InjectWorkerManager()` resolves `null`. |
| `readOnly` | `false` | Every queue from `queues`/`forFeature` read-only unless it sets `options.readOnlyMode`. Whole board on pg-boss. |
| `queues` | `[]` | Same shape as `forFeature` entries, registered at the root. Not allowed on a pg-boss board. |
| `uiConfig` | | Merged into `boardOptions.uiConfig`, wins over it. |
| `title`, `logo`, `theme` | | Shortcuts for `uiConfig.boardTitle`, `uiConfig.boardLogo`, `uiConfig.theme`. |
| `boardOptions` | | Passed to the board: `uiConfig`, `uiBasePath`, `historyProvider`, `handlerHooks`, `validateResponses`. |
| `middleware` | | Extra Nest middleware on the route (Express: after `auth`). |

## `WorkerManagerModule.forFeature(...queues)` / `forFeature(boardName, ...queues)`

Import it in the module that registers the queues (`BullModule.registerQueue`). Each entry:

- `name`: queue name resolved from DI (`getQueueToken`), **or** `queue`: an instance to register
  directly (PostgreSQL-backed queues, or two queues sharing a name under different prefixes,
  which `@nestjs/bullmq` collapses onto one token).
- `adapter`: `BullMQAdapter` (`@worker-manager/api/bullMQAdapter`) or `BullAdapter` (`@worker-manager/api/bullAdapter`).
- `options`: queue adapter options, e.g. `{ readOnlyMode: true, description: '...', prefix: 'tenant-a:' }`.

```ts
WorkerManagerModule.forFeature(
  { name: 'emails', adapter: BullMQAdapter },
  { name: 'billing', adapter: BullMQAdapter, options: { readOnlyMode: true } },
);
```

## `WorkerManagerModule.forRootAsync(options)`

`imports` plus exactly one of `useFactory` (+ `inject`), `useClass` or `useExisting` (the latter two
implement `WorkerManagerOptionsFactory.createWorkerManagerOptions()`). `name` goes on the async
options, not in the factory result, because it decides the DI tokens.

```ts
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
      auth: {
        strategy: 'keycloak',
        url: this.config.getOrThrow('KEYCLOAK_URL'),
        realm: this.config.getOrThrow('KEYCLOAK_REALM'),
        clientId: this.config.getOrThrow('KEYCLOAK_CLIENT_ID'),
        clientSecret: this.config.get('KEYCLOAK_CLIENT_SECRET'),
        requiredRoles: ['wm-admin'],
        cookie: { secret: this.config.getOrThrow('BOARD_SESSION_SECRET') },
      },
    };
  }
}

WorkerManagerModule.forRootAsync({ imports: [ConfigModule], useClass: BoardConfig });
```

## Named boards

```ts
WorkerManagerModule.forRoot({ name: 'ops', route: '/ops', auth: opsAuth }),
WorkerManagerModule.forRootAsync({
  name: 'billing',
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({ route: '/billing', title: config.get('TITLE') }),
}),
WorkerManagerModule.forFeature('ops', { name: 'emails', adapter: BullMQAdapter }),
WorkerManagerModule.forFeature('billing', { name: 'invoices', adapter: BullMQAdapter }),
```

- Tokens: `worker_manager_instance:<name>` etc. (`getWorkerManagerToken(name)`); the unnamed board
  keeps plain `worker_manager_*`, so it can sit next to named ones.
- Inject with `@InjectWorkerManager('ops') board: WorkerManagerBoard` (`addQueue`, `removeQueue`,
  `setQueues`, `replaceQueues`). A pg-boss board resolves `WorkerManagerPgBossBoard` (`{ engine, close() }`).
- Give each board its own `route`, never nested (`/queues` and `/queues/ops` breaks on Express).
- Each board has its own `auth`. Keycloak: register `https://<host>/<route>/auth/callback` per board.
  A named board's session cookie is `wm_session_<name>`; sessions are per board.

## pg-boss board

Needs `@worker-manager/pg-boss`, pg-boss ≥ 12.24, Node ≥ 22.12. The app owns and starts pg-boss.

```ts
@Module({
  providers: [
    {
      provide: 'PG_BOSS',
      useFactory: async () => {
        const boss = new PgBoss(process.env.DATABASE_URL!);
        await boss.start();
        return boss;
      },
    },
  ],
  exports: ['PG_BOSS'],
})
export class PgBossModule {}

@Module({
  imports: [
    PgBossModule,
    WorkerManagerModule.forRoot({ route: '/queues' }), // existing BullMQ board, unchanged
    WorkerManagerModule.forRootAsync({
      name: 'pgboss',
      imports: [PgBossModule],
      inject: ['PG_BOSS'],
      useFactory: (boss: PgBoss) => ({
        route: '/pg-boss',
        engine: 'pg-boss',
        auth: { strategy: 'basic', users: [{ username: 'ops', password: process.env.BOARD_PASSWORD! }] },
        pgBoss: { instance: boss, connection: process.env.DATABASE_URL, schema: 'pgboss' },
      }),
    }),
  ],
})
export class AppModule {}
```

`pgBoss` takes `instance` or `useExisting` (a provider token looked up at bootstrap, works with
plain `forRoot`) and/or `connection`, plus `schema`, `queues`, `delimiter`,
`includeInternalQueues`, `queryTimeoutMs`, `countCap`, `visibilityGuard`, `allowUntestedSchema`
(see [pg-boss.md](pg-boss.md)) and `engine` (a ready-made `PgBossEngine`, e.g.
`createPgBossStubEngine()` from `@worker-manager/api/engine` in tests). At least one of
`instance`, `useExisting`, `connection` or `engine` is required. `queues` at the root and
`forFeature` into a pg-boss board throw: narrow with `pgBoss.queues` instead.

## PostgreSQL-backed BullMQ queues

`@nestjs/bullmq` cannot pass a backend factory, so create the queue with `bullmq` directly and hand
over the instance (details in [postgres.md](postgres.md)):

```ts
import { Queue, createPostgresBackend } from 'bullmq'; // bullmq@6 + pg

const invoices = new Queue(
  'invoices',
  { connection: { connectionString: process.env.POSTGRES_URL, migrate: true } },
  createPostgresBackend
);

WorkerManagerModule.forRoot({ queues: [{ queue: invoices, adapter: BullMQAdapter }] });
```

A queue created inside a provider: inject the board and call
`board.addQueue(new BullMQAdapter(queue))` in `onModuleInit`.

## Testing

`Test.createTestingModule({ imports: [AppModule] }).compile()` works without an explicit `adapter`
(since 2.2.0): the real adapter is picked in `app.init()`. On Fastify also await
`app.getHttpAdapter().getInstance().ready()`. CommonJS Jest failing on `content-disposition` with
`Must use import to load ES Module`: see [troubleshooting.md](troubleshooting.md).

## Examples

`examples/nestjs/{redis,postgres,keycloak,fastify-custom-auth,pg-boss}` in
<https://github.com/naldomadeira/worker-manager/tree/main/examples/nestjs>.
