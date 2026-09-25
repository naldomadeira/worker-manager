import type { PgBossEngine } from '@worker-manager/api/engine';
import type {
  AppJob,
  AppQueue,
  ErrorResponseBody,
  PgBossJob,
  PgBossQueueSummary,
  QueueCapabilities,
} from '@worker-manager/api/typings/app';
import type {
  AddJobBody,
  GetPgBossJobsQuery,
  GetQueuesQuery,
} from '@worker-manager/api/typings/requests';
import type {
  GetPgBossJobsResponse,
  GetQueuesResponse,
} from '@worker-manager/api/typings/responses';

type IsAny<T> = 0 extends 1 & T ? true : false;

export const appJobIsTyped: false = null as unknown as IsAny<AppJob>;
export const appQueueIsTyped: false = null as unknown as IsAny<AppQueue>;
export const errorBodyIsTyped: false = null as unknown as IsAny<ErrorResponseBody>;
export const addJobBodyIsTyped: false = null as unknown as IsAny<AddJobBody>;
export const getQueuesQueryIsTyped: false = null as unknown as IsAny<GetQueuesQuery>;
export const getQueuesResponseIsTyped: false = null as unknown as IsAny<GetQueuesResponse>;

export const queueName: string = null as unknown as AppQueue['name'];
export const jobsPerPage: number = null as unknown as GetQueuesQuery['jobsPerPage'];
export const queues: AppJob[] = null as unknown as GetQueuesResponse['queues'][number]['jobs'];

export const capabilitiesAreTyped: false = null as unknown as IsAny<QueueCapabilities>;
export const pgBossQueueIsTyped: false = null as unknown as IsAny<PgBossQueueSummary>;
export const pgBossJobIsTyped: false = null as unknown as IsAny<PgBossJob>;
export const pgBossJobsQueryIsTyped: false = null as unknown as IsAny<GetPgBossJobsQuery>;
export const pgBossJobsResponseIsTyped: false = null as unknown as IsAny<GetPgBossJobsResponse>;
export const pgBossEngineIsTyped: false = null as unknown as IsAny<PgBossEngine>;
export const nextCursor: string | null = null as unknown as GetPgBossJobsResponse['nextCursor'];
