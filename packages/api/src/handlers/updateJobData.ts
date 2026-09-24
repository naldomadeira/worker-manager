import { jobProvider } from '../providers/job';
import { queueProvider } from '../providers/queue';
import type { UpdateJobDataBody } from '../schemas/requests';
import { EmptyResponse } from '../schemas/responses';
import { WorkerManagerRequest, ControllerHandlerReturnType, QueueJob } from '../types';

async function updateJobData(
  req: WorkerManagerRequest<Record<string, any>, UpdateJobDataBody>,
  job: QueueJob
): Promise<ControllerHandlerReturnType<EmptyResponse>> {
  const { jobData } = req.body;

  if ('updateData' in job) {
    await job.updateData!(jobData);
  } else if ('update' in job) {
    await job.update!(jobData);
  }

  return {
    status: 200,
    body: {},
  };
}

export const updateJobDataHandler = queueProvider(jobProvider(updateJobData));
