import path from 'path';
import { errorHandler } from './handlers/error';
import { wrapHandler } from './hooks';
import { appRoutes, buildHistoryRoutes } from './routes';
import type {
  AppControllerRoute,
  BoardEngine,
  BoardOptions,
  IServerAdapter,
  UIConfig,
  WorkerManagerQueues,
} from './types';

export interface MountBoardOptions {
  engine: BoardEngine;
  /** The engine's own API routes. History routes are added here when a provider is configured. */
  routes: AppControllerRoute[];
  serverAdapter: IServerAdapter;
  /** Queue adapters the BullMQ engine hands to each handler. Empty for engines that bind their own. */
  queues?: WorkerManagerQueues;
  options?: BoardOptions;
  /** Whether the board is read-only right now, asked on every entry request. */
  isReadOnly: () => boolean;
  /** Whether it is read-only at mount, which decides whether destructive history routes exist. */
  readOnlyAtMount: boolean;
}

export function mountBoard({
  engine,
  routes,
  serverAdapter,
  queues = new Map(),
  options = { uiConfig: {} },
  isReadOnly,
  readOnlyAtMount,
}: MountBoardOptions): void {
  const uiBasePath =
    // oxlint-disable-next-line no-eval
    options.uiBasePath || path.dirname(eval(`require.resolve('@worker-manager/ui/package.json')`));

  const historyProvider = options.historyProvider;
  // Optional provider capabilities: a route only exists when the provider implements it.
  // Purging is destructive, so it additionally requires a board that isn't read-only. A board
  // that is read-only up front never mounts the route; one that becomes writable later mounts it,
  // and the handler and `uiConfig.canPurgeHistory` judge the board of the moment.
  const hasHistoryUsage = Boolean(historyProvider?.getUsage);
  const hasLatencyHistory = Boolean(historyProvider?.getLatency);
  const hasHistoryPurge = Boolean(historyProvider?.purge);

  const apiRoutes = [...routes];
  if (historyProvider) {
    apiRoutes.push(
      ...buildHistoryRoutes(historyProvider, {
        hasUsage: hasHistoryUsage,
        canPurge: hasHistoryPurge && !readOnlyAtMount,
        hasLatency: hasLatencyHistory,
      })
    );
  }

  const validateResponses = options.validateResponses === true;
  const finalApiRoutes = apiRoutes.map((route) => ({
    ...route,
    handler: wrapHandler(route, { hooks: options.handlerHooks, validateResponses }),
  }));

  const uiConfig: UIConfig = {
    boardTitle: 'Worker Manager',
    favIcon: {
      default: 'static/images/logo.svg',
      alternative: 'static/favicon-32x32.png',
    },
    ...options.uiConfig,
    // Derived, so these must win over any caller-supplied uiConfig: each one gates a UI feature
    // whose backing routes only exist on this engine or with this provider.
    engine,
    hasHistoryProvider: Boolean(historyProvider),
    hasHistoryUsage,
    hasLatencyHistory,
  };
  // Read on every request rather than fixed here, because the queues a NestJS module or the
  // CLI register arrive after the board exists. The server adapters keep this object by
  // reference and serialise it per entry request, so a getter is enough.
  Object.defineProperty(uiConfig, 'canPurgeHistory', {
    enumerable: true,
    get: () => hasHistoryPurge && !isReadOnly(),
  });

  serverAdapter
    .setQueues(queues)
    .setViewsPath(path.join(uiBasePath, 'dist'))
    .setStaticPath('/static', path.join(uiBasePath, 'dist/static'))
    .setUIConfig(uiConfig)
    .setEntryRoute(appRoutes.entryPoint)
    .setErrorHandler(errorHandler)
    .setApiRoutes(finalApiRoutes);
}
