import { mountBoard } from './engine';
import { BaseAdapter } from './queueAdapters/base';
import { getQueuesApi, isReadOnlyBoard } from './queuesApi';
import { appRoutes } from './routes';
import { BoardOptions, IServerAdapter } from './types';

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

  // `readOnlyMode` is per-queue, so a board is read-only when every queue is.
  mountBoard({
    engine: 'bullmq',
    routes: appRoutes.api,
    serverAdapter,
    queues: workerManagerQueues,
    options,
    isReadOnly: () => isReadOnlyBoard(workerManagerQueues.values()),
    readOnlyAtMount: isReadOnlyBoard(queues),
  });

  return { setQueues, replaceQueues, addQueue, removeQueue };
}
