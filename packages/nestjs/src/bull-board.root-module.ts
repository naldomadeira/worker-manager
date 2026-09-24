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
import { createBullBoard } from '@worker-manager/api';
import { createAuthMiddleware, createFastifyAuthPlugin } from '@worker-manager/auth';
import {
  BULL_BOARD_ADAPTER,
  BULL_BOARD_INSTANCE,
  BULL_BOARD_OPTIONS,
  DEFAULT_BULL_BOARD_ROUTE,
} from './bull-board.constants';
import {
  BullBoardInstance,
  BullBoardModuleAsyncOptions,
  BullBoardModuleOptions,
  BullBoardOptionsFactory,
  BullBoardServerAdapter,
} from './bull-board.types';
import {
  isExpressAdapter,
  isFastifyAdapter,
  isEnabled,
  registerQueues,
  resolveBoardOptions,
  resolveServerAdapter,
} from './bull-board.util';

@Module({})
export class BullBoardRootModule implements NestModule, OnModuleInit {
  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly applicationConfig: ApplicationConfig,
    private readonly moduleRef: ModuleRef,
    @Inject(BULL_BOARD_ADAPTER) private readonly adapter: BullBoardServerAdapter | null,
    @Inject(BULL_BOARD_OPTIONS) private readonly options: BullBoardModuleOptions,
    @Inject(BULL_BOARD_INSTANCE) private readonly board: BullBoardInstance | null
  ) {}

  onModuleInit(): void {
    if (!this.board || !this.options.queues?.length) return;

    registerQueues(this.board, this.moduleRef, this.options.queues, this.options.readOnly);
  }

  configure(consumer: MiddlewareConsumer): any {
    if (!isEnabled(this.options) || !this.adapter) return;

    const route = this.options.route ?? DEFAULT_BULL_BOARD_ROUTE;
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

  static forRoot(options: BullBoardModuleOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: BULL_BOARD_OPTIONS,
      useValue: options,
    };

    return BullBoardRootModule.build(optionsProvider, []);
  }

  static forRootAsync(options: BullBoardModuleAsyncOptions): DynamicModule {
    const extraProviders: Provider[] = [];
    let optionsProvider: Provider;

    if (options.useFactory) {
      optionsProvider = {
        provide: BULL_BOARD_OPTIONS,
        useFactory: options.useFactory,
        inject: options.inject ?? [],
      };
    } else if (options.useClass || options.useExisting) {
      const factoryToken = options.useExisting ?? options.useClass!;
      if (options.useClass) {
        extraProviders.push({ provide: options.useClass, useClass: options.useClass });
      }
      optionsProvider = {
        provide: BULL_BOARD_OPTIONS,
        useFactory: (factory: BullBoardOptionsFactory) => factory.createBullBoardOptions(),
        inject: [factoryToken],
      };
    } else {
      throw new Error(
        'BullBoardModule.forRootAsync() needs one of useFactory, useClass or useExisting.'
      );
    }

    return BullBoardRootModule.build(optionsProvider, extraProviders, options.imports);
  }

  private static build(
    optionsProvider: Provider,
    extraProviders: Provider[],
    imports: BullBoardModuleAsyncOptions['imports'] = []
  ): DynamicModule {
    const serverAdapterProvider: Provider = {
      provide: BULL_BOARD_ADAPTER,
      useFactory: (options: BullBoardModuleOptions, adapterHost: HttpAdapterHost) =>
        isEnabled(options) ? resolveServerAdapter(options, adapterHost) : null,
      inject: [BULL_BOARD_OPTIONS, HttpAdapterHost],
    };

    const bullBoardProvider: Provider = {
      provide: BULL_BOARD_INSTANCE,
      useFactory: (options: BullBoardModuleOptions, adapter: BullBoardServerAdapter | null) =>
        isEnabled(options) && adapter
          ? createBullBoard({
              queues: [],
              serverAdapter: adapter,
              options: resolveBoardOptions(options),
            })
          : null,
      inject: [BULL_BOARD_OPTIONS, BULL_BOARD_ADAPTER],
    };

    return {
      module: BullBoardRootModule,
      global: true,
      imports,
      providers: [...extraProviders, optionsProvider, serverAdapterProvider, bullBoardProvider],
      exports: [serverAdapterProvider, bullBoardProvider, optionsProvider],
    };
  }
}
