import { queueProvider } from '../providers/queue';
import { BaseAdapter } from '../queueAdapters/base';
import { EmptyResponse } from '../schemas/responses';
import { WorkerManagerRequest, ControllerHandlerReturnType } from '../types';

async function emptyQueue(
  _req: WorkerManagerRequest,
  queue: BaseAdapter
): Promise<ControllerHandlerReturnType<EmptyResponse>> {
  await queue.empty();

  return { status: 200, body: {} };
}

export const emptyQueueHandler = queueProvider(emptyQueue);
