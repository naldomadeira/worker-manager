import path from 'path';
import { errorHandler } from './handlers/error';
import { wrapHandler } from './hooks';
import { BaseAdapter } from './queueAdapters/base';
import { getQueuesApi, isReadOnlyBoard } from './queuesApi';
import { appRoutes, buildHistoryRoutes } from './routes';
import { BoardOptions, IServerAdapter, UIConfig } from './types';

export function createWorkerManagerBoard({
  queues,
  serverAdapter,
  options = { uiConfig: {} },
}: {
  queues: ReadonlyArray<BaseAdapter>;
  serverAdapter: IServerAdapter;
  options?: BoardOptions;
}) {
  const { workerManagerQueues, setQueues, replaceQueues, addQueue, removeQueue } =
    getQueuesApi(queues);
  const uiBasePath =
    // oxlint-disable-next-line no-eval
    options.uiBasePath || path.dirname(eval(`require.resolve('@worker-manager/ui/package.json')`));

  const historyProvider = options.historyProvider;
  // Optional provider capabilities: a route only exists when the provider implements it.
  // Purging is destructive, so it additionally requires a board that isn't read-only.
  // `readOnlyMode` is per-queue here, so a board is read-only when every queue is. A board
  // that is read-only up front never mounts the route; one populated later through `addQueue`
  // mounts it, and the handler and `uiConfig.canPurgeHistory` judge the queues of the moment.
  const hasHistoryUsage = Boolean(historyProvider?.getUsage);
  const hasLatencyHistory = Boolean(historyProvider?.getLatency);
  const hasHistoryPurge = Boolean(historyProvider?.purge);
  const canPurgeHistory = hasHistoryPurge && !isReadOnlyBoard(queues);

  const apiRoutes = [...appRoutes.api];
  if (historyProvider) {
    apiRoutes.push(
      ...buildHistoryRoutes(historyProvider, {
        hasUsage: hasHistoryUsage,
        canPurge: canPurgeHistory,
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
    // Derived from `historyProvider`, so these must win over any caller-supplied
    // uiConfig: each flag gates a UI feature whose backing route only exists when the
    // provider supports it.
    hasHistoryProvider: Boolean(historyProvider),
    hasHistoryUsage,
    hasLatencyHistory,
  };
  // Read on every request rather than fixed here, because the queues a NestJS module or the
  // CLI register arrive after the board exists. The server adapters keep this object by
  // reference and serialise it per entry request, so a getter is enough.
  Object.defineProperty(uiConfig, 'canPurgeHistory', {
    enumerable: true,
    get: () => hasHistoryPurge && !isReadOnlyBoard(workerManagerQueues.values()),
  });

  serverAdapter
    .setQueues(workerManagerQueues)
    .setViewsPath(path.join(uiBasePath, 'dist'))
    .setStaticPath('/static', path.join(uiBasePath, 'dist/static'))
    .setUIConfig(uiConfig)
    .setEntryRoute(appRoutes.entryPoint)
    .setErrorHandler(errorHandler)
    .setApiRoutes(finalApiRoutes);

  return { setQueues, replaceQueues, addQueue, removeQueue };
}
