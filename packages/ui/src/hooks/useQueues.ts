import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { STATUSES } from '@worker-manager/api/constants/statuses';
import type {
  JobCleanStatus,
  JobRetryStatus,
  QueueRateLimit,
} from '@worker-manager/api/typings/app';
import type { ErrorResponseBody } from '@worker-manager/api/typings/app';
import { GetQueuesResponse } from '@worker-manager/api/typings/responses';
import { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { QueueActions } from '../../typings/app';
import { runWithToast } from '../utils/actionToast';
import type { RetriableFailedJobs } from '../utils/failedRetries';
import { getConfirmFor } from '../utils/getConfirmFor';
import { translateMessage } from '../utils/translateMessage';
import { queryKeys } from './queryKeys';
import { useActiveQueueName } from './useActiveQueueName';
import { useApi } from './useApi';
import { useConfirm } from './useConfirm';
import { useSearchParams } from './useSearchParams';
import { useSelectedStatuses } from './useSelectedStatuses';
import { useSettingsStore } from './useSettings';
import { UIConfigContext } from './useUIConfig';

export type QueuesState = {
  queues: null | GetQueuesResponse['queues'];
  loading: boolean;
  fetching: boolean;
  /** Showing the previous route/filter's data while the next fetch resolves. */
  isTransitioning: boolean;
  /** Why the last fetch failed, already worded for the user; `null` while it works. */
  error: Error | null;
};

export function useQueues(): QueuesState & { actions: QueueActions } {
  const { page } = useSearchParams();
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const activeQueueName = useActiveQueueName();
  const selectedStatuses = useSelectedStatuses();
  const { pollingInterval, jobsPerPage, confirmQueueActions } = useSettingsStore(
    useShallow(({ pollingInterval, jobsPerPage, confirmQueueActions }) => ({
      pollingInterval,
      jobsPerPage,
      confirmQueueActions,
    }))
  );
  const { openConfirm } = useConfirm();
  // The shell asks for the queue list on every board; only a BullMQ board serves it.
  const isBullMQBoard = (useContext(UIConfigContext)?.engine ?? 'bullmq') === 'bullmq';

  const status = activeQueueName ? selectedStatuses[activeQueueName] : undefined;
  const params = { activeQueue: activeQueueName || undefined, status, page, jobsPerPage };

  const { data, isPending, isFetching, isPlaceholderData, error } = useQuery({
    queryKey: queryKeys.queues.list(params),
    queryFn: () => api.getQueues(params),
    enabled: isBullMQBoard,
    refetchInterval: pollingInterval > 0 ? pollingInterval * 1000 : false,
    placeholderData: keepPreviousData,
    // Non-mutating: lets structural sharing keep stable job references across polls.
    select: (res) => {
      // The interceptor resolves an error body rather than throwing, so a failed poll lands here
      // without `queues`; surfacing it as the query's error is what lets a page say so.
      if (!Array.isArray(res?.queues)) {
        const body = res as unknown as Partial<ErrorResponseBody>;
        throw new Error(body.error ? translateMessage(body.error) : t('DASHBOARD.LOAD_ERROR'));
      }
      return res.queues.map((queue) =>
        queue.displayName ? queue : { ...queue, displayName: queue.name }
      );
    },
  });

  const invalidateQueues = () => queryClient.invalidateQueries({ queryKey: queryKeys.queues.all });

  const withConfirmAndUpdate = getConfirmFor(invalidateQueues, openConfirm);

  const skippedDescription = (skipped: number | undefined) =>
    skipped ? t('QUEUE.ACTIONS.TOAST.RETRY_SKIPPED', { count: skipped }) : undefined;

  const retryAll = (queueName: string, status: JobRetryStatus) =>
    withConfirmAndUpdate(
      () =>
        runWithToast(() => api.retryAll(queueName, status), {
          pending: t('QUEUE.ACTIONS.TOAST.RETRY_PENDING', { status }),
          success: (result) => ({
            title: t('QUEUE.ACTIONS.TOAST.RETRY_DONE', { status }),
            description: skippedDescription(result?.skipped),
          }),
        }),
      {
        description: t('QUEUE.ACTIONS.CONFIRM.RETRY_ALL', { status }),
        shouldConfirm: confirmQueueActions,
      }
    );

  const retryFailedInQueues = ({ queueNames, jobCount }: RetriableFailedJobs) =>
    withConfirmAndUpdate(
      () =>
        runWithToast(
          () => Promise.all(queueNames.map((name) => api.retryAll(name, STATUSES.failed))),
          {
            pending: t('QUEUE.ACTIONS.TOAST.RETRY_QUEUES_PENDING', {
              jobs: jobCount,
              count: queueNames.length,
            }),
            success: (results) => ({
              title: t('QUEUE.ACTIONS.TOAST.RETRY_QUEUES_DONE', {
                jobs: jobCount,
                count: queueNames.length,
              }),
              description: skippedDescription(
                results.reduce((total, result) => total + (result?.skipped ?? 0), 0)
              ),
            }),
          }
        ),
      {
        description: t('QUEUE.ACTIONS.CONFIRM.RETRY_FAILED_QUEUES', {
          jobs: jobCount,
          count: queueNames.length,
        }),
        shouldConfirm: confirmQueueActions,
      }
    );

  const promoteAll = (queueName: string) =>
    withConfirmAndUpdate(() => api.promoteAll(queueName), {
      description: t('QUEUE.ACTIONS.CONFIRM.PROMOTE_ALL'),
      shouldConfirm: confirmQueueActions,
    });

  const cleanAll = (queueName: string, status: JobCleanStatus) =>
    withConfirmAndUpdate(() => api.cleanAll(queueName, status), {
      description: t('QUEUE.ACTIONS.CONFIRM.CLEAN_ALL', { status }),
      shouldConfirm: confirmQueueActions,
    });

  const pauseQueue = (queueName: string) =>
    withConfirmAndUpdate(() => api.pauseQueue(queueName), {
      description: t('QUEUE.ACTIONS.CONFIRM.PAUSE_QUEUE'),
      shouldConfirm: confirmQueueActions,
    });

  const resumeQueue = (queueName: string) =>
    withConfirmAndUpdate(() => api.resumeQueue(queueName), {
      description: t('QUEUE.ACTIONS.CONFIRM.RESUME_QUEUE'),
      shouldConfirm: confirmQueueActions,
    });

  const emptyQueue = (queueName: string) =>
    withConfirmAndUpdate(() => api.emptyQueue(queueName), {
      description: t('QUEUE.ACTIONS.CONFIRM.EMPTY_QUEUE'),
      shouldConfirm: confirmQueueActions,
    });

  /**
   * Pausing a queue does not stop the jobs a worker already holds, and Bull/BullMQ refuse to
   * obliterate while any job is active. The force opt-in is only offered when there is something
   * to force past, so an ordinary obliterate keeps its plain confirmation.
   */
  const obliterateQueue = (queueName: string) => {
    const activeJobs = data?.find((queue) => queue.name === queueName)?.counts.active ?? 0;

    return withConfirmAndUpdate(({ checked }) => api.obliterateQueue(queueName, checked), {
      description: t('QUEUE.ACTIONS.CONFIRM.OBLITERATE_QUEUE'),
      shouldConfirm: true,
      checkbox: activeJobs
        ? {
            label: t('QUEUE.ACTIONS.CONFIRM.OBLITERATE_FORCE'),
            description: t('QUEUE.ACTIONS.CONFIRM.OBLITERATE_FORCE_DESCRIPTION', {
              jobs: activeJobs,
            }),
          }
        : undefined,
    });
  };

  const addJob = (
    queueName: string,
    jobName: string,
    jobData: Record<any, any>,
    jobOptions: Record<any, any>
  ) =>
    withConfirmAndUpdate(() => api.addJob(queueName, jobName, jobData, jobOptions), {
      description: '',
      shouldConfirm: false,
    });

  const setGlobalConcurrency = (queueName: string, concurrency: number) =>
    withConfirmAndUpdate(() => api.setGlobalConcurrency(queueName, concurrency), {
      description: '',
      shouldConfirm: false,
    });

  const setQueueRateLimit = (queueName: string, rateLimit: QueueRateLimit | null) =>
    withConfirmAndUpdate(() => api.setQueueRateLimit(queueName, rateLimit), {
      description: '',
      shouldConfirm: false,
    });

  const releaseQueueRateLimit = (queueName: string) =>
    withConfirmAndUpdate(() => api.releaseQueueRateLimit(queueName), {
      description: t('RATE_LIMIT.CONFIRM_RELEASE'),
      shouldConfirm: confirmQueueActions,
    });

  const pauseQueues = (queueNames: string[]) =>
    withConfirmAndUpdate(() => Promise.all(queueNames.map((name) => api.pauseQueue(name))), {
      description: t('QUEUE.ACTIONS.CONFIRM.PAUSE_GROUP', { count: queueNames.length }),
      shouldConfirm: confirmQueueActions,
    });

  const resumeQueues = (queueNames: string[]) =>
    withConfirmAndUpdate(() => Promise.all(queueNames.map((name) => api.resumeQueue(name))), {
      description: t('QUEUE.ACTIONS.CONFIRM.RESUME_GROUP', { count: queueNames.length }),
      shouldConfirm: confirmQueueActions,
    });

  const pauseAll = withConfirmAndUpdate(() => api.pauseAllQueues(), {
    description: t('QUEUE.ACTIONS.CONFIRM.PAUSE_ALL'),
    shouldConfirm: confirmQueueActions,
  });
  const resumeAll = withConfirmAndUpdate(() => api.resumeAllQueues(), {
    description: t('QUEUE.ACTIONS.CONFIRM.RESUME_ALL'),
    shouldConfirm: confirmQueueActions,
  });

  return {
    queues: data ?? null,
    loading: isPending,
    fetching: isFetching,
    isTransitioning: isPlaceholderData,
    error: error ?? null,
    actions: {
      pauseAll,
      resumeAll,
      updateQueues: invalidateQueues,
      retryAll,
      retryFailedInQueues,
      promoteAll,
      cleanAll,
      pauseQueue,
      resumeQueue,
      pauseQueues,
      resumeQueues,
      emptyQueue,
      obliterateQueue,
      addJob,
      setGlobalConcurrency,
      setQueueRateLimit,
      releaseQueueRateLimit,
    },
  };
}
