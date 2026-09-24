import { errorResponse } from '../errors';
import { BaseAdapter } from '../queueAdapters/base';
import { WorkerManagerRequest, ControllerHandlerReturnType, QueueJob } from '../types';

export function jobProvider<TBody, TRequest extends WorkerManagerRequest<any, any>>(
  next: (
    req: TRequest,
    job: QueueJob,
    queue: BaseAdapter
  ) => Promise<ControllerHandlerReturnType<TBody>>
) {
  return async (req: TRequest, queue: BaseAdapter): Promise<ControllerHandlerReturnType<TBody>> => {
    const { jobId } = req.params;

    const job = await queue.getJob(jobId);

    if (!job) {
      return errorResponse(404, 'ERRORS.JOB_NOT_FOUND');
    }

    return next(req, job, queue);
  };
}
