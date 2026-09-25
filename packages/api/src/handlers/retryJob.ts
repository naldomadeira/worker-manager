import { errorResponse } from '../errors';
import { jobProvider } from '../providers/job';
import { queueProvider } from '../providers/queue';
import { BaseAdapter } from '../queueAdapters/base';
import { EmptyResponse } from '../schemas/responses';
import {
  WorkerManagerRequest,
  ControllerHandlerReturnType,
  JobRetryStatus,
  QueueJob,
} from '../types';

function isRetriableState(state: string): state is JobRetryStatus {
  return state === 'failed' || state === 'completed';
}

async function retryJob(
  _req: WorkerManagerRequest,
  job: QueueJob,
  queue: BaseAdapter
): Promise<ControllerHandlerReturnType<EmptyResponse>> {
  if (!queue.allowRetries) {
    return errorResponse(405, 'ERRORS.RETRIES_DISABLED');
  }

  const jobState = await job.getState();

  if (!isRetriableState(jobState)) {
    return errorResponse(400, { key: 'ERRORS.JOB_NOT_RETRIABLE', options: { state: jobState } });
  }

  if (jobState === 'completed' && !queue.allowCompletedRetries) {
    return errorResponse(405, 'ERRORS.COMPLETED_RETRIES_DISABLED');
  }

  await job.retry(jobState);

  return {
    status: 204,
    body: {},
  };
}

export const retryJobHandler = queueProvider(jobProvider(retryJob));
