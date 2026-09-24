import { jobProvider } from '../providers/job';
import { queueProvider } from '../providers/queue';
import { EmptyResponse } from '../schemas/responses';
import { WorkerManagerRequest, ControllerHandlerReturnType, QueueJob } from '../types';

async function promoteJob(
  _req: WorkerManagerRequest,
  job: QueueJob
): Promise<ControllerHandlerReturnType<EmptyResponse>> {
  await job.promote();

  return {
    status: 204,
    body: {},
  };
}

export const promoteJobHandler = queueProvider(jobProvider(promoteJob));
