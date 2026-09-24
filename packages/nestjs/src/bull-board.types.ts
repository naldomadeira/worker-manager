import type {
  InjectionToken,
  ModuleMetadata,
  OptionalFactoryDependency,
  Type,
} from '@nestjs/common';
import { createBullBoard } from '@worker-manager/api';
import type { BaseAdapter } from '@worker-manager/api/baseAdapter';
import type {
  BoardOptions,
  IServerAdapter,
  QueueAdapterOptions,
  UIConfig,
} from '@worker-manager/api/typings/app';
import type { AuthOptions } from '@worker-manager/auth';

export type { AuthOptions } from '@worker-manager/auth';

export type BullBoardInstance = ReturnType<typeof createBullBoard>;

export type BullBoardModuleOptions = {
  /**
   * Where the board is served, relative to the Nest global prefix. Defaults to `/queues`.
   */
  route?: string;
  /**
   * The server adapter class, `ExpressAdapter` from `@worker-manager/express` or
   * `FastifyAdapter` from `@worker-manager/fastify`. When left out, the module picks the one
   * matching the Nest HTTP platform the application runs on.
   */
  adapter?: { new (): BullBoardServerAdapter };
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
   * sets `options.readOnlyMode` itself.
   */
  readOnly?: boolean;
  /** Queues to register at the root, without a separate `forFeature` import. */
  queues?: BullBoardQueueOptions[];
  /** Merged into `boardOptions.uiConfig` (these take precedence). */
  uiConfig?: UIConfig;
  /** Shortcut for `uiConfig.boardTitle`. */
  title?: string;
  /** Shortcut for `uiConfig.boardLogo`. */
  logo?: UIConfig['boardLogo'];
  /** Shortcut for `uiConfig.theme`. */
  theme?: UIConfig['theme'];
};

export interface BullBoardOptionsFactory {
  createBullBoardOptions(): BullBoardModuleOptions | Promise<BullBoardModuleOptions>;
}

export type BullBoardModuleAsyncOptions = {
  imports?: ModuleMetadata['imports'];
  useFactory?: (...args: any[]) => BullBoardModuleOptions | Promise<BullBoardModuleOptions>;
  inject?: Array<InjectionToken | OptionalFactoryDependency>;
  /** A class implementing `BullBoardOptionsFactory`, instantiated by the module. */
  useClass?: Type<BullBoardOptionsFactory>;
  /** An existing provider implementing `BullBoardOptionsFactory`. */
  useExisting?: InjectionToken;
};

type BullBoardQueueCommonOptions = {
  adapter: { new (queue: any, options?: Partial<QueueAdapterOptions>): BaseAdapter };
  options?: Partial<QueueAdapterOptions>;
};

export type BullBoardQueueOptions = BullBoardQueueCommonOptions &
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
export type BullBoardServerAdapter = IServerAdapter & { setBasePath(path: string): any };
export type BullBoardFastifyAdapter = BullBoardServerAdapter & { registerPlugin(): any };
export type BullBoardExpressAdapter = BullBoardServerAdapter & { getRouter(): any };
