import { useQueryClient } from '@tanstack/react-query';
import type { PgBossJobState, PgBossSchedule } from '@worker-manager/api/typings/app';
import type {
  SendPgBossJobBody,
  UpsertPgBossScheduleBody,
} from '@worker-manager/api/typings/requests';
import type { PgBossCommandResponse } from '@worker-manager/api/typings/responses';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useConfirm } from '../../../hooks/useConfirm';
import { useSettingsStore } from '../../../hooks/useSettings';
import { runWithToast } from '../../../utils/actionToast';
import { getConfirmFor } from '../../../utils/getConfirmFor';
import type { PgBossJobCommand } from '../services/PgBossApi';
import { sendOptionsOf } from '../utils/jobs';
import { isErrorBody } from './query';
import { pgBossKeys } from './queryKeys';
import { usePgBossApi } from './usePgBossApi';

const COMMAND_KEYS = {
  retry: 'RETRY',
  cancel: 'CANCEL',
  resume: 'RESUME',
  delete: 'DELETE',
} as const satisfies Record<PgBossJobCommand, string>;

/**
 * Every write the pg-boss pages make, each one wrapped the way the BullMQ board wraps its own:
 * an optional confirm, a pending toast that turns into the outcome, and a refresh of the board
 * afterwards. Each action resolves `true` only when it ran and the server accepted it.
 */
export function usePgBossActions() {
  const { t } = useTranslation();
  const api = usePgBossApi();
  const queryClient = useQueryClient();
  const { openConfirm } = useConfirm();
  const { confirmJobActions, confirmQueueActions } = useSettingsStore(
    useShallow(({ confirmJobActions, confirmQueueActions }) => ({
      confirmJobActions,
      confirmQueueActions,
    }))
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: pgBossKeys.all });
  const withConfirm = getConfirmFor(refresh, openConfirm);

  const affected = (result: PgBossCommandResponse) =>
    isErrorBody(result)
      ? undefined
      : t('PGBOSS.ACTIONS.AFFECTED', { affected: result.affected, requested: result.requested });

  const jobCommand = (
    command: PgBossJobCommand,
    queueName: string,
    job: { id: string; state: PgBossJobState }
  ) => {
    const key = COMMAND_KEYS[command];
    // Cancelling a running job leaves its handler running, which is worth saying every time.
    const runningCancel = command === 'cancel' && job.state === 'active';
    return withConfirm(
      () =>
        runWithToast(() => api.jobCommand(command, queueName, job.id), {
          pending: t(`PGBOSS.ACTIONS.${key}.PENDING`),
          success: t(`PGBOSS.ACTIONS.${key}.DONE`),
        }),
      {
        description: runningCancel
          ? `${t('PGBOSS.ACTIONS.CANCEL.CONFIRM')} ${t('PGBOSS.ACTIONS.CANCEL_ACTIVE_WARNING')}`
          : t(`PGBOSS.ACTIONS.${key}.CONFIRM`),
        shouldConfirm: confirmJobActions || runningCancel,
      }
    );
  };

  const retryFailed = (queueName: string) =>
    withConfirm(
      () =>
        runWithToast(() => api.retryFailed(queueName), {
          pending: t('PGBOSS.ACTIONS.RETRY_FAILED.PENDING'),
          success: (result) => ({
            title: t('PGBOSS.ACTIONS.RETRY_FAILED.DONE'),
            description: affected(result),
          }),
        }),
      { description: t('PGBOSS.ACTIONS.RETRY_FAILED.CONFIRM'), shouldConfirm: confirmQueueActions }
    );

  // Deleting a queue's jobs cannot be undone, so it always asks, like obliterating a BullMQ queue.
  const deleteQueued = (queueName: string) =>
    withConfirm(
      () =>
        runWithToast(() => api.deleteQueued(queueName), {
          pending: t('PGBOSS.ACTIONS.DELETE_QUEUED.PENDING'),
          success: (result) => ({
            title: t('PGBOSS.ACTIONS.DELETE_QUEUED.DONE'),
            description: affected(result),
          }),
        }),
      { description: t('PGBOSS.ACTIONS.DELETE_QUEUED.CONFIRM'), shouldConfirm: true }
    );

  const deleteStored = (queueName: string) =>
    withConfirm(
      () =>
        runWithToast(() => api.deleteStored(queueName), {
          pending: t('PGBOSS.ACTIONS.DELETE_STORED.PENDING'),
          success: (result) => ({
            title: t('PGBOSS.ACTIONS.DELETE_STORED.DONE'),
            description: affected(result),
          }),
        }),
      { description: t('PGBOSS.ACTIONS.DELETE_STORED.CONFIRM'), shouldConfirm: true }
    );

  const sendJob = (queueName: string, body: SendPgBossJobBody, duplicate = false) => {
    const key = duplicate ? 'DUPLICATE' : 'SEND';
    return withConfirm(
      () =>
        runWithToast(() => api.sendJob(queueName, body), {
          pending: t(`PGBOSS.ACTIONS.${key}.PENDING`),
          success: (result) =>
            !isErrorBody(result) && result.id === null
              ? t('PGBOSS.ACTIONS.SEND.DROPPED')
              : { title: t(`PGBOSS.ACTIONS.${key}.DONE`), description: result.id ?? undefined },
        }),
      { description: '', shouldConfirm: false }
    );
  };

  const upsertSchedule = (queueName: string, body: UpsertPgBossScheduleBody) =>
    withConfirm(
      () =>
        runWithToast(() => api.upsertSchedule(queueName, body), {
          pending: t('PGBOSS.SCHEDULES.SAVE_PENDING'),
          success: t('PGBOSS.SCHEDULES.SAVE_DONE'),
        }),
      { description: '', shouldConfirm: false }
    );

  const removeSchedule = (schedule: PgBossSchedule) =>
    withConfirm(
      () =>
        runWithToast(() => api.removeSchedule(schedule.queueName, schedule.key), {
          pending: t('PGBOSS.SCHEDULES.REMOVE_PENDING'),
          success: t('PGBOSS.SCHEDULES.REMOVE_DONE'),
        }),
      { description: t('PGBOSS.SCHEDULES.REMOVE_CONFIRM'), shouldConfirm: true }
    );

  /** What pg-boss's timekeeper does when a schedule fires: send its template. */
  const runScheduleNow = (schedule: PgBossSchedule) =>
    withConfirm(
      () =>
        runWithToast(
          () =>
            api.sendJob(schedule.queueName, {
              data: schedule.data ?? undefined,
              options: sendOptionsOf(schedule.options),
            }),
          {
            pending: t('PGBOSS.SCHEDULES.RUN_NOW_PENDING'),
            success: (result) =>
              !isErrorBody(result) && result.id === null
                ? t('PGBOSS.ACTIONS.SEND.DROPPED')
                : {
                    title: t('PGBOSS.SCHEDULES.RUN_NOW_DONE'),
                    description: result.id ?? undefined,
                  },
          }
        ),
      { description: t('PGBOSS.SCHEDULES.RUN_NOW_CONFIRM'), shouldConfirm: confirmJobActions }
    );

  return {
    refresh,
    jobCommand,
    retryFailed,
    deleteQueued,
    deleteStored,
    sendJob,
    upsertSchedule,
    removeSchedule,
    runScheduleNow,
  };
}
