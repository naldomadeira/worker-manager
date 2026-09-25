import { errorResponse } from '../errors';
import { queueProvider } from '../providers/queue';
import { BaseAdapter } from '../queueAdapters/base';
import { EmptyResponse } from '../schemas/responses';
import { WorkerManagerRequest, ControllerHandlerReturnType, JobCleanStatus } from '../types';

const GRACE_TIME_MS = 5000;

const CLEANABLE_STATUSES: ReadonlySet<string> = new Set<JobCleanStatus>([
  'completed',
  'wait',
  'active',
  'delayed',
  'failed',
]);

function isCleanableStatus(status: string): status is JobCleanStatus {
  return CLEANABLE_STATUSES.has(status);
}

async function cleanAll(
  req: WorkerManagerRequest,
  queue: BaseAdapter
): Promise<ControllerHandlerReturnType<EmptyResponse>> {
  const { queueStatus } = req.params;

  if (!isCleanableStatus(queueStatus)) {
    return errorResponse(400, {
      key: 'ERRORS.INVALID_QUERY_PARAM',
      options: { field: 'queueStatus' },
    });
  }

  await queue.clean(queueStatus, GRACE_TIME_MS);

  return {
    status: 200,
    body: {},
  };
}

export const cleanAllHandler = queueProvider(cleanAll);
