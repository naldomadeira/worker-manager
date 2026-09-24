import { queueProvider } from '../providers/queue';
import { BaseAdapter } from '../queueAdapters/base';
import { GetQueueDefaultJobOptionsResponse } from '../schemas/responses';
import { WorkerManagerRequest, ControllerHandlerReturnType } from '../types';

async function getDefaultJobOptions(
  _req: WorkerManagerRequest,
  queue: BaseAdapter
): Promise<ControllerHandlerReturnType<GetQueueDefaultJobOptionsResponse>> {
  return {
    status: 200,
    body: queue.getQueueDefaultJobOptions(),
  };
}

export const defaultJobOptionsHandler = queueProvider(getDefaultJobOptions, {
  skipReadOnlyModeCheck: true,
});
