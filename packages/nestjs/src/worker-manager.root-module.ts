import {
  DynamicModule,
  Inject,
  MiddlewareConsumer,
  Module,
  NestModule,
  OnModuleInit,
  Provider,
} from '@nestjs/common';
import { ApplicationConfig, HttpAdapterHost, ModuleRef } from '@nestjs/core';
import { createWorkerManagerBoard } from '@worker-manager/api';
import { createAuthMiddleware, createFastifyAuthPlugin } from '@worker-manager/auth';
import {
  WORKER_MANAGER_ADAPTER,
  WORKER_MANAGER_INSTANCE,
  WORKER_MANAGER_OPTIONS,
  DEFAULT_WORKER_MANAGER_ROUTE,
} from './worker-manager.constants';
import {
  WorkerManagerBoard,
  WorkerManagerModuleAsyncOptions,
  WorkerManagerModuleOptions,
  WorkerManagerOptionsFactory,
  WorkerManagerServerAdapter,
} from './worker-manager.types';
import {
  isExpressAdapter,
  isFastifyAdapter,
  isEnabled,
  registerQueues,
  resolveBoardOptions,
  resolveServerAdapter,
} from './worker-manager.util';

@Module({})
export class WorkerManagerRootModule implements NestModule, OnModuleInit {
  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly applicationConfig: ApplicationConfig,
    private readonly moduleRef: ModuleRef,
    @Inject(WORKER_MANAGER_ADAPTER) private readonly adapter: WorkerManagerServerAdapter | null,
    @Inject(WORKER_MANAGER_OPTIONS) private readonly options: WorkerManagerModuleOptions,
    @Inject(WORKER_MANAGER_INSTANCE) private readonly board: WorkerManagerBoard | null
  ) {}

  onModuleInit(): void {
    if (!this.board || !this.options.queues?.length) return;

    registerQueues(this.board, this.moduleRef, this.options.queues, this.options.readOnly);
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
      ? createAuthMiddleware(this.options.auth, { basePath: prefix })
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
    const optionsProvider: Provider = {
      provide: WORKER_MANAGER_OPTIONS,
      useValue: options,
    };

    return WorkerManagerRootModule.build(optionsProvider, []);
  }

  static forRootAsync(options: WorkerManagerModuleAsyncOptions): DynamicModule {
    const extraProviders: Provider[] = [];
    let optionsProvider: Provider;

    if (options.useFactory) {
      optionsProvider = {
        provide: WORKER_MANAGER_OPTIONS,
        useFactory: options.useFactory,
        inject: options.inject ?? [],
      };
    } else if (options.useClass || options.useExisting) {
      const factoryToken = options.useExisting ?? options.useClass!;
      if (options.useClass) {
        extraProviders.push({ provide: options.useClass, useClass: options.useClass });
      }
      optionsProvider = {
        provide: WORKER_MANAGER_OPTIONS,
        useFactory: (factory: WorkerManagerOptionsFactory) => factory.createWorkerManagerOptions(),
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
      provide: WORKER_MANAGER_ADAPTER,
      useFactory: (options: WorkerManagerModuleOptions, adapterHost: HttpAdapterHost) =>
        isEnabled(options) ? resolveServerAdapter(options, adapterHost) : null,
      inject: [WORKER_MANAGER_OPTIONS, HttpAdapterHost],
    };

    const workerManagerProvider: Provider = {
      provide: WORKER_MANAGER_INSTANCE,
      useFactory: (
        options: WorkerManagerModuleOptions,
        adapter: WorkerManagerServerAdapter | null
      ) =>
        isEnabled(options) && adapter
          ? createWorkerManagerBoard({
              queues: [],
              serverAdapter: adapter,
              options: resolveBoardOptions(options),
            })
          : null,
      inject: [WORKER_MANAGER_OPTIONS, WORKER_MANAGER_ADAPTER],
    };

    return {
      module: WorkerManagerRootModule,
      global: true,
      imports,
      providers: [...extraProviders, optionsProvider, serverAdapterProvider, workerManagerProvider],
      exports: [serverAdapterProvider, workerManagerProvider, optionsProvider],
    };
  }
}
