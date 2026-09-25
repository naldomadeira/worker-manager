import type {
  InjectionToken,
  ModuleMetadata,
  OptionalFactoryDependency,
  Type,
} from '@nestjs/common';
import { createWorkerManagerBoard } from '@worker-manager/api';
import type { BaseAdapter } from '@worker-manager/api/baseAdapter';
import type { PgBossEngine } from '@worker-manager/api/engine';
import type {
  BoardOptions,
  IServerAdapter,
  QueueAdapterOptions,
  UIConfig,
} from '@worker-manager/api/typings/app';
import type { AuthOptions } from '@worker-manager/auth';
import type { PgBossBoardOptions, PgBossLike } from '@worker-manager/pg-boss';

export type { AuthOptions } from '@worker-manager/auth';

export type WorkerManagerBoard = ReturnType<typeof createWorkerManagerBoard>;

/** What a board created with `engine: 'pg-boss'` resolves to through `@InjectWorkerManager()`. */
export type WorkerManagerPgBossBoard = { engine: PgBossEngine; close(): Promise<void> };

export type WorkerManagerEngine = 'bullmq' | 'pg-boss';

/**
 * The `pgBoss` block of a board created with `engine: 'pg-boss'`. Everything but `useExisting`
 * and `engine` is handed to `createPgBossBoard` from `@worker-manager/pg-boss` as it is.
 */
export type WorkerManagerPgBossOptions = Omit<PgBossBoardOptions, 'instance'> & {
  /** The app's own pg-boss instance, already started. Preferred for writes. */
  instance?: PgBossLike;
  /** A provider token that resolves to the app's pg-boss instance, looked up at bootstrap. */
  useExisting?: InjectionToken;
  /**
   * A ready-made engine, mounted as it is instead of building one from a connection. For tests
   * (`createPgBossStubEngine()` from `@worker-manager/api/engine`) or an engine configured
   * elsewhere with `createPgBossEngine()`. `@worker-manager/pg-boss` is then never loaded.
   */
  engine?: PgBossEngine;
};

export type WorkerManagerModuleOptions = {
  /**
   * Registers a named board. Its providers get their own tokens
   * (`worker_manager_instance:<name>` and so on) and it is injected with
   * `@InjectWorkerManager(name)`, so several boards can be mounted in one application. Leave it
   * out for the single, unnamed board.
   */
  name?: string;
  /**
   * `bullmq` (the default) serves Bull and BullMQ queues registered through `queues` or
   * `forFeature`. `pg-boss` serves a pg-boss schema configured by `pgBoss`, and needs
   * `@worker-manager/pg-boss` installed. Experimental.
   */
  engine?: WorkerManagerEngine;
  /** Where the pg-boss board reads and writes. Required with `engine: 'pg-boss'`. */
  pgBoss?: WorkerManagerPgBossOptions;
  /**
   * Where the board is served, relative to the Nest global prefix. Defaults to `/queues`.
   */
  route?: string;
  /**
   * The server adapter class, `ExpressAdapter` from `@worker-manager/express` or
   * `FastifyAdapter` from `@worker-manager/fastify`. When left out, the module picks the one
   * matching the Nest HTTP platform the application runs on.
   */
  adapter?: { new (): WorkerManagerServerAdapter };
  boardOptions?: BoardOptions;
  /** Nest middleware applied to the board's routes, after `auth`. */
  middleware?: any;
  /**
   * Protects the board with `@worker-manager/auth`: Basic credentials or Keycloak (OIDC code
   * flow + bearer tokens). Runs before `middleware` and before every board route.
   */
  auth?: AuthOptions;
  /** `false` registers nothing: no routes, no middleware, and forFeature becomes a no-op. */
  enabled?: boolean;
  /**
   * Read-only mode for every queue registered through `queues` or `forFeature`, unless a queue
   * sets `options.readOnlyMode` itself. On a pg-boss board, the whole board is read-only.
   */
  readOnly?: boolean;
  /** Queues to register at the root, without a separate `forFeature` import. */
  queues?: WorkerManagerQueueOptions[];
  /** Merged into `boardOptions.uiConfig` (these take precedence). */
  uiConfig?: UIConfig;
  /** Shortcut for `uiConfig.boardTitle`. */
  title?: string;
  /** Shortcut for `uiConfig.boardLogo`. */
  logo?: UIConfig['boardLogo'];
  /** Shortcut for `uiConfig.theme`. */
  theme?: UIConfig['theme'];
};

export interface WorkerManagerOptionsFactory {
  createWorkerManagerOptions(): WorkerManagerModuleOptions | Promise<WorkerManagerModuleOptions>;
}

export type WorkerManagerModuleAsyncOptions = {
  /**
   * The board's name, as in `forRoot({ name })`. It has to be known before the factory runs,
   * because it decides the tokens, so it goes here rather than in the resolved options.
   */
  name?: string;
  imports?: ModuleMetadata['imports'];
  useFactory?: (...args: any[]) => WorkerManagerModuleOptions | Promise<WorkerManagerModuleOptions>;
  inject?: Array<InjectionToken | OptionalFactoryDependency>;
  /** A class implementing `WorkerManagerOptionsFactory`, instantiated by the module. */
  useClass?: Type<WorkerManagerOptionsFactory>;
  /** An existing provider implementing `WorkerManagerOptionsFactory`. */
  useExisting?: InjectionToken;
};

type WorkerManagerQueueCommonOptions = {
  adapter: { new (queue: any, options?: Partial<QueueAdapterOptions>): BaseAdapter };
  options?: Partial<QueueAdapterOptions>;
};

export type WorkerManagerQueueOptions = WorkerManagerQueueCommonOptions &
  (
    | {
        /**
         * The queue name to resolve from the Nest DI container (via `getQueueToken`).
         */
        name: string;
        queue?: undefined;
      }
    | {
        /**
         * A queue instance to register directly, bypassing the DI container lookup.
         *
         * Use this when the name-based lookup cannot disambiguate the queue — e.g. two
         * queues sharing the same name but using different prefixes, which `@nestjs/bullmq`
         * collapses onto a single DI token — or for a queue the container does not know about,
         * such as a BullMQ v6 queue backed by PostgreSQL.
         */
        queue: unknown;
        name?: string;
      }
  );

//create our own types with the needed functions, so we don't need to include express/fastify libraries here.
export type WorkerManagerServerAdapter = IServerAdapter & { setBasePath(path: string): any };
export type WorkerManagerFastifyAdapter = WorkerManagerServerAdapter & { registerPlugin(): any };
export type WorkerManagerExpressAdapter = WorkerManagerServerAdapter & { getRouter(): any };
