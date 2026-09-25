import type { PgBossJobState } from '@worker-manager/api/typings/app';

/**
 * pg-boss pages sit on the BullMQ paths. The state goes in `state` rather than BullMQ's
 * `status`, since `retry`, `created` and `cancelled` are not BullMQ statuses.
 */
export const pgBossLinks = {
  queuePage(queueName: string, state?: PgBossJobState): { pathname: string; search: string } {
    return {
      pathname: `/queue/${encodeURIComponent(queueName)}`,
      search: state ? new URLSearchParams({ state }).toString() : '',
    };
  },
  jobPage(
    queueName: string,
    jobId: string,
    state?: PgBossJobState
  ): { pathname: string; search: string } {
    return {
      pathname: `/queue/${encodeURIComponent(queueName)}/${encodeURIComponent(jobId)}`,
      search: state ? new URLSearchParams({ state }).toString() : '',
    };
  },
  schedules(queueName?: string): { pathname: string; search: string } {
    return {
      pathname: '/job-schedulers',
      search: queueName ? new URLSearchParams({ queueName }).toString() : '',
    };
  },
};
