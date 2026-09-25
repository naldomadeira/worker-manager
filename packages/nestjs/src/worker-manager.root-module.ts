import {
  DynamicModule,
  Inject,
  MiddlewareConsumer,
  Module,
  NestModule,
  OnApplicationShutdown,
  OnModuleInit,
  Provider,
  Type,
} from '@nestjs/common';
import { ApplicationConfig, HttpAdapterHost, ModuleRef } from '@nestjs/core';
import { createAuthMiddleware, createFastifyAuthPlugin } from '@worker-manager/auth';
import { DEFAULT_WORKER_MANAGER_ROUTE, getWorkerManagerTokens } from './worker-manager.constants';
import {
  WorkerManagerBoard,
  WorkerManagerModuleAsyncOptions,
  WorkerManagerModuleOptions,
  WorkerManagerOptionsFactory,
  WorkerManagerPgBossBoard,
  WorkerManagerServerAdapter,
} from './worker-manager.types';
import {
  assertEngineOptions,
  createBoard,
  isExpressAdapter,
  isFastifyAdapter,
  isEnabled,
  isPgBossBoard,
  registerQueues,
  resolveServerAdapter,
  scopeAuthToBoard,
} from './worker-manager.util';

export interface WorkerManagerRootModuleClass extends Type<unknown> {
  forRoot(options: WorkerManagerModuleOptions): DynamicModule;
  forRootAsync(options: WorkerManagerModuleAsyncOptions): DynamicModule;
}

const rootModules = new Map<string | undefined, WorkerManagerRootModuleClass>();

/**
 * The root module class of one board. Its constructor injects the board's own tokens through
 * static `@Inject()` decorators, so a named board needs a class of its own. Memoised, so every
 * `forRoot({ name })` with the same name shares one class.
 */
export function getWorkerManagerRootModule(name?: string): WorkerManagerRootModuleClass {
  let rootModule = rootModules.get(name);
  if (!rootModule) {
    rootModule = createRootModule(name);
    rootModules.set(name, rootModule);
  }
  return rootModule;
}

function createRootModule(name: string | undefined): WorkerManagerRootModuleClass {
  const tokens = getWorkerManagerTokens(name);

  @Module({})
  class WorkerManagerRootModule implements NestModule, OnModuleInit, OnApplicationShutdown {
    constructor(
      private readonly adapterHost: HttpAdapterHost,
      private readonly applicationConfig: ApplicationConfig,
      private readonly moduleRef: ModuleRef,
      @Inject(tokens.adapter) private readonly adapter: WorkerManagerServerAdapter | null,
      @Inject(tokens.options) private readonly options: WorkerManagerModuleOptions,
      @Inject(tokens.instance)
      private readonly board: WorkerManagerBoard | WorkerManagerPgBossBoard | null
    ) {}

    onModuleInit(): void {
      if (!this.board || isPgBossBoard(this.board) || !this.options.queues?.length) return;

      registerQueues(this.board, this.moduleRef, this.options.queues, this.options.readOnly);
    }

    async onApplicationShutdown(): Promise<void> {
      // Only the pg-boss engine holds resources of its own (its read pool); the app's instance
      // and pool are borrowed and stay open.
      if (this.board && isPgBossBoard(this.board)) await this.board.close();
    }

    configure(consumer: MiddlewareConsumer): any {
      if (!isEnabled(this.options) || !this.adapter) return;

      const route = this.options.route ?? DEFAULT_WORKER_MANAGER_ROUTE;
      const addForwardSlash = (path: string) => {
        return path.startsWith('/') || path === '' ? path : `/${path}`;
      };

      const shouldBypassGlobalPrefix = () => {
        const prefixOptions = this.applicationConfig.getGlobalPrefixOptions();
        if (!prefixOptions?.exclude) return false;

        return prefixOptions.exclude.some((exclusion) => {
          const routePath = addForwardSlash(route);
          return exclusion.pathRegex.test(routePath);
        });
      };

      const prefix = shouldBypassGlobalPrefix()
        ? addForwardSlash(route)
        : addForwardSlash(this.applicationConfig.getGlobalPrefix() + route);

      this.adapter.setBasePath(prefix);

      const auth = this.options.auth
        ? createAuthMiddleware(scopeAuthToBoard(this.options.auth, name), { basePath: prefix })
        : undefined;

      if (isExpressAdapter(this.adapter)) {
        const chain = [auth, this.options.middleware, this.adapter.getRouter()].filter(Boolean);

        return consumer.apply(...chain).forRoutes(route);
      }

      if (isFastifyAdapter(this.adapter)) {
        const plugin = this.adapter.registerPlugin();
        const instance = this.adapterHost.httpAdapter.getInstance();

        // With auth, the hook is scoped to the board's own routes: it sees every request under
        // the prefix, assets and API included, and nothing else in the application.
        instance.register(auth ? createFastifyAuthPlugin(plugin, auth) : plugin, { prefix });

        if (this.options.middleware) {
          return consumer.apply(this.options.middleware).forRoutes(route);
        }
      }
    }

    static forRoot(options: WorkerManagerModuleOptions): DynamicModule {
      assertEngineOptions(options);
      const optionsProvider: Provider = {
        provide: tokens.options,
        useValue: options,
      };

      return WorkerManagerRootModule.build(optionsProvider, []);
    }

    static forRootAsync(options: WorkerManagerModuleAsyncOptions): DynamicModule {
      const extraProviders: Provider[] = [];
      let optionsProvider: Provider;
      const checked = (resolved: WorkerManagerModuleOptions) => {
        if (resolved?.name !== undefined && resolved.name !== name) {
          throw new Error(
            `WorkerManagerModule.forRootAsync(): the factory returned name ${JSON.stringify(resolved.name)}, ` +
              `but the board was registered as ${JSON.stringify(name)}. Pass \`name\` to forRootAsync() itself.`
          );
        }
        assertEngineOptions(resolved);
        return resolved;
      };

      if (options.useFactory) {
        const useFactory = options.useFactory;
        optionsProvider = {
          provide: tokens.options,
          useFactory: async (...args: any[]) => checked(await useFactory(...args)),
          inject: options.inject ?? [],
        };
      } else if (options.useClass || options.useExisting) {
        const factoryToken = options.useExisting ?? options.useClass!;
        if (options.useClass) {
          extraProviders.push({ provide: options.useClass, useClass: options.useClass });
        }
        optionsProvider = {
          provide: tokens.options,
          useFactory: async (factory: WorkerManagerOptionsFactory) =>
            checked(await factory.createWorkerManagerOptions()),
          inject: [factoryToken],
        };
      } else {
        throw new Error(
          'WorkerManagerModule.forRootAsync() needs one of useFactory, useClass or useExisting.'
        );
      }

      return WorkerManagerRootModule.build(optionsProvider, extraProviders, options.imports);
    }

    private static build(
      optionsProvider: Provider,
      extraProviders: Provider[],
      imports: WorkerManagerModuleAsyncOptions['imports'] = []
    ): DynamicModule {
      const serverAdapterProvider: Provider = {
        provide: tokens.adapter,
        useFactory: (options: WorkerManagerModuleOptions, adapterHost: HttpAdapterHost) =>
          isEnabled(options) ? resolveServerAdapter(options, adapterHost) : null,
        inject: [tokens.options, HttpAdapterHost],
      };

      const workerManagerProvider: Provider = {
        provide: tokens.instance,
        useFactory: (
          options: WorkerManagerModuleOptions,
          adapter: WorkerManagerServerAdapter | null,
          moduleRef: ModuleRef
        ) => (isEnabled(options) && adapter ? createBoard(options, adapter, moduleRef) : null),
        inject: [tokens.options, tokens.adapter, ModuleRef],
      };

      return {
        module: WorkerManagerRootModule,
        global: true,
        imports,
        providers: [
          ...extraProviders,
          optionsProvider,
          serverAdapterProvider,
          workerManagerProvider,
        ],
        exports: [serverAdapterProvider, workerManagerProvider, optionsProvider],
      };
    }
  }

  if (name !== undefined) {
    Object.defineProperty(WorkerManagerRootModule, 'name', {
      value: `WorkerManagerRootModule_${name}`,
    });
  }

  return WorkerManagerRootModule;
}

export const WorkerManagerRootModule = getWorkerManagerRootModule();
