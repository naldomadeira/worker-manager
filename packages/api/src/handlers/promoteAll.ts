import { queueProvider } from '../providers/queue';
import { BaseAdapter } from '../queueAdapters/base';
import { EmptyResponse } from '../schemas/responses';
import { WorkerManagerRequest, ControllerHandlerReturnType } from '../types';

async function promoteAll(
  _req: WorkerManagerRequest,
  queue: BaseAdapter
): Promise<ControllerHandlerReturnType<EmptyResponse>> {
  await queue.promoteAll();

  return { status: 200, body: {} };
}

export const promoteAllHandler = queueProvider(promoteAll);
