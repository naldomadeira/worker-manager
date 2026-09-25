import {
  AppJob,
  AppQueue,
  JobCleanStatus,
  JobRetryStatus,
  QueueRateLimit,
  Status,
} from '@worker-manager/api/typings/app';
import type { RetriableFailedJobs } from '../src/utils/failedRetries';

export { Status } from '@worker-manager/api/typings/app';

export type SelectedStatuses = Record<AppQueue['name'], Status>;

/** Every action resolves `true` when it ran and succeeded, `false` when cancelled or refused. */
export interface QueueActions {
  pauseAll: () => Promise<boolean>;
  resumeAll: () => Promise<boolean>;
  retryAll: (queueName: string, status: JobRetryStatus) => () => Promise<boolean>;
  retryFailedInQueues: (retriable: RetriableFailedJobs) => () => Promise<boolean>;
  promoteAll: (queueName: string) => () => Promise<boolean>;
  cleanAll: (queueName: string, status: JobCleanStatus) => () => Promise<boolean>;
  pauseQueue: (queueName: string) => () => Promise<boolean>;
  resumeQueue: (queueName: string) => () => Promise<boolean>;
  pauseQueues: (queueNames: string[]) => () => Promise<boolean>;
  resumeQueues: (queueNames: string[]) => () => Promise<boolean>;
  emptyQueue: (queueName: string) => () => Promise<boolean>;
  obliterateQueue: (queueName: string) => () => Promise<boolean>;
  updateQueues: () => Promise<void>;
  addJob: (
    queueName: string,
    jobName: string,
    jobData: any,
    jobOptions: any
  ) => () => Promise<boolean>;
  setGlobalConcurrency: (queueName: string, concurrency: number) => () => Promise<boolean>;
  setQueueRateLimit: (
    queueName: string,
    rateLimit: QueueRateLimit | null
  ) => () => Promise<boolean>;
  releaseQueueRateLimit: (queueName: string) => () => Promise<boolean>;
}

export interface JobActions {
  promoteJob: (queueName: string) => (job: AppJob) => () => Promise<boolean>;
  retryJob: (queueName: string) => (job: AppJob) => () => Promise<boolean>;
  cleanJob: (queueName: string) => (job: AppJob) => () => Promise<boolean>;
  updateJobData: (
    queueName: string,
    job: AppJob,
    newData: Record<string, any>
  ) => () => Promise<boolean>;
  changeJobDelay: (queueName: string, job: AppJob, runAt: number) => () => Promise<boolean>;
  changeJobPriority: (queueName: string, job: AppJob, priority: number) => () => Promise<boolean>;
  removeUnprocessedChildren: (queueName: string) => (job: AppJob) => () => Promise<boolean>;
  getJobLogs: (queueName: string) => (job: AppJob) => () => Promise<string[]>;
  getJob: () => Promise<any>;
}
