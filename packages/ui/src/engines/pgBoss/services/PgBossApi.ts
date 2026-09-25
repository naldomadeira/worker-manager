import type { PgBossJobState } from '@worker-manager/api/typings/app';
import type {
  PreviewPgBossScheduleBody,
  SendPgBossJobBody,
  UpsertPgBossScheduleBody,
} from '@worker-manager/api/typings/requests';
import type {
  GetPgBossDependenciesResponse,
  GetPgBossInfoResponse,
  GetPgBossJobResponse,
  GetPgBossJobsResponse,
  GetPgBossQueueResponse,
  GetPgBossQueuesResponse,
  GetPgBossSchedulesResponse,
  GetPgBossStateCountsResponse,
  PgBossCommandResponse,
  PgBossScheduleResponse,
  PreviewPgBossScheduleResponse,
  SendPgBossJobResponse,
} from '@worker-manager/api/typings/responses';
import Axios, { type AxiosInstance } from 'axios';
import { handleApiError, handleApiResponse } from '../../../services/Api';

/** The single-job and bulk commands, named by their path segment on the server. */
export type PgBossJobCommand = 'retry' | 'cancel' | 'resume' | 'delete';

const COMMAND_PATHS: Record<PgBossJobCommand, string> = {
  retry: 'retry',
  cancel: 'cancel',
  resume: 'resume',
  delete: 'remove',
};

export interface PgBossJobsParams {
  state?: PgBossJobState;
  cursor?: string;
  limit?: number;
  id?: string;
  singletonKey?: string;
}

const queuePath = (name: string) => `/queues/${encodeURIComponent(name)}`;
const jobPath = (name: string, id: string) => `${queuePath(name)}/jobs/${encodeURIComponent(id)}`;

/**
 * Client of the `/api/pg-boss/*` routes. It shares the BullMQ client's interceptors: an error
 * body is toasted and then resolved rather than thrown, so callers check for `error` the same
 * way on both engines.
 */
export class PgBossApi {
  private axios: AxiosInstance;

  constructor({ basePath }: { basePath: string } = { basePath: '' }) {
    this.axios = Axios.create({ baseURL: `${basePath}api/pg-boss` });
    this.axios.interceptors.response.use(handleApiResponse, handleApiError);
  }

  public getInfo(): Promise<GetPgBossInfoResponse> {
    return this.axios.get('/info');
  }

  public getQueues(): Promise<GetPgBossQueuesResponse> {
    return this.axios.get('/queues');
  }

  public getQueue(name: string): Promise<GetPgBossQueueResponse> {
    return this.axios.get(queuePath(name));
  }

  public getCounts(name: string): Promise<GetPgBossStateCountsResponse> {
    return this.axios.get(`${queuePath(name)}/counts`);
  }

  public getJobs(name: string, params: PgBossJobsParams): Promise<GetPgBossJobsResponse> {
    return this.axios.get(`${queuePath(name)}/jobs`, { params });
  }

  public getJob(name: string, id: string): Promise<GetPgBossJobResponse> {
    return this.axios.get(jobPath(name, id));
  }

  public getDependencies(name: string, id: string): Promise<GetPgBossDependenciesResponse> {
    return this.axios.get(`${jobPath(name, id)}/dependencies`);
  }

  public getSchedules(queueName?: string): Promise<GetPgBossSchedulesResponse> {
    return this.axios.get('/schedules', { params: queueName ? { queueName } : {} });
  }

  public previewSchedule(
    body: Omit<PreviewPgBossScheduleBody, 'count'> &
      Partial<Pick<PreviewPgBossScheduleBody, 'count'>>
  ): Promise<PreviewPgBossScheduleResponse> {
    return this.axios.post('/schedules/preview', body);
  }

  public sendJob(name: string, body: SendPgBossJobBody): Promise<SendPgBossJobResponse> {
    return this.axios.post(`${queuePath(name)}/jobs`, body);
  }

  public jobCommand(
    command: PgBossJobCommand,
    name: string,
    id: string
  ): Promise<PgBossCommandResponse> {
    return this.axios.put(`${jobPath(name, id)}/${COMMAND_PATHS[command]}`);
  }

  public bulkCommand(
    command: PgBossJobCommand,
    name: string,
    ids: string[]
  ): Promise<PgBossCommandResponse> {
    return this.axios.put(`${queuePath(name)}/jobs/${COMMAND_PATHS[command]}`, { ids });
  }

  public retryFailed(name: string): Promise<PgBossCommandResponse> {
    return this.axios.put(`${queuePath(name)}/retry-failed`);
  }

  public deleteQueued(name: string): Promise<PgBossCommandResponse> {
    return this.axios.put(`${queuePath(name)}/delete-queued`);
  }

  public deleteStored(name: string): Promise<PgBossCommandResponse> {
    return this.axios.put(`${queuePath(name)}/delete-stored`);
  }

  public upsertSchedule(
    name: string,
    body: UpsertPgBossScheduleBody
  ): Promise<PgBossScheduleResponse> {
    return this.axios.put(`${queuePath(name)}/schedules`, body);
  }

  public removeSchedule(name: string, key: string): Promise<PgBossCommandResponse> {
    return this.axios.put(`${queuePath(name)}/schedules/remove`, { key });
  }
}
