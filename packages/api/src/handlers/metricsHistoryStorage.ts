import { errorResponse } from '../errors';
import { isReadOnlyBoard } from '../queuesApi';
import type { PurgeMetricsHistoryBody } from '../schemas/requests';
import { GetMetricsHistoryUsageResponse, PurgeMetricsHistoryResponse } from '../schemas/responses';
import {
  AppControllerRoute,
  WorkerManagerRequest,
  ControllerHandlerReturnType,
  MetricsHistoryProvider,
} from '../types';

export function createMetricsHistoryUsageHandler(
  provider: MetricsHistoryProvider
): AppControllerRoute<'GetMetricsHistoryUsageResponse'>['handler'] {
  return async function metricsHistoryUsageHandler(): Promise<
    ControllerHandlerReturnType<GetMetricsHistoryUsageResponse>
  > {
    const usage = await provider.getUsage!();
    return { status: 200, body: usage };
  };
}

export function createMetricsHistoryPurgeHandler(
  provider: MetricsHistoryProvider
): AppControllerRoute<
  'PurgeMetricsHistoryResponse',
  Record<string, any>,
  PurgeMetricsHistoryBody
>['handler'] {
  return async function metricsHistoryPurgeHandler(
    req?: WorkerManagerRequest<Record<string, any>, PurgeMetricsHistoryBody>
  ): Promise<ControllerHandlerReturnType<PurgeMetricsHistoryResponse>> {
    // Judged per request: a board created empty and filled through `addQueue` only learns it
    // is read-only once those queues are there.
    if (isReadOnlyBoard(req!.queues.values())) {
      return errorResponse(405, 'ERRORS.QUEUE_READ_ONLY');
    }

    const { queue, before } = req!.body;
    const result = await provider.purge!({ queue, before });
    return { status: 200, body: result };
  };
}
