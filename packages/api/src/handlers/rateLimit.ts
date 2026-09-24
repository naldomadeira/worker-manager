import { errorResponse } from '../errors';
import { queueProvider } from '../providers/queue';
import { BaseAdapter } from '../queueAdapters/base';
import type { SetRateLimitBody } from '../schemas/requests';
import { EmptyResponse, GetQueueRateLimitResponse } from '../schemas/responses';
import { WorkerManagerRequest, ControllerHandlerReturnType } from '../types';

async function getConfiguredRateLimit(
  _req: WorkerManagerRequest,
  queue: BaseAdapter
): Promise<ControllerHandlerReturnType<GetQueueRateLimitResponse>> {
  if (!queue.supportsGlobalRateLimit) {
    return { status: 200, body: { supported: false, rateLimit: null } };
  }

  return {
    status: 200,
    body: { supported: true, rateLimit: await queue.getConfiguredRateLimit() },
  };
}

async function setConfiguredRateLimit(
  req: WorkerManagerRequest<Record<string, any>, SetRateLimitBody>,
  queue: BaseAdapter
): Promise<ControllerHandlerReturnType<EmptyResponse>> {
  if (!queue.supportsGlobalRateLimit) {
    return errorResponse(400, 'ERRORS.RATE_LIMIT_NOT_SUPPORTED');
  }

  const { max, duration } = req.body;

  if (max === null || max === undefined) {
    await queue.removeConfiguredRateLimit();
    return { status: 200, body: {} };
  }

  await queue.setConfiguredRateLimit({ max, duration });
  return { status: 200, body: {} };
}

async function releaseActiveRateLimit(
  _req: WorkerManagerRequest,
  queue: BaseAdapter
): Promise<ControllerHandlerReturnType<EmptyResponse>> {
  await queue.releaseActiveRateLimit();
  return { status: 200, body: {} };
}

export const getRateLimitHandler = queueProvider(getConfiguredRateLimit, {
  skipReadOnlyModeCheck: true,
});
export const setRateLimitHandler = queueProvider(setConfiguredRateLimit);
export const releaseRateLimitHandler = queueProvider(releaseActiveRateLimit);
