import type {
  GetPgBossJobsQuery,
  GetPgBossWarningsQuery,
  PreviewPgBossScheduleBody,
  SendPgBossJobBody,
  UpsertPgBossScheduleBody,
} from '../../schemas/requests';
import type {
  GetPgBossJobsResponse,
  GetPgBossWarningsResponse,
  PgBossCommandResponse,
} from '../../schemas/responses';
import type {
  PgBossDependencyRef,
  PgBossInfo,
  PgBossJob,
  PgBossJobSummary,
  PgBossQueueDepthPoint,
  PgBossQueueSummary,
  PgBossSchedule,
  PgBossStateCounts,
  Promisify,
  TranslatableMessage,
  WorkerManagerRequest,
} from '../../types';

export type PgBossJobAction = 'retry' | 'cancel' | 'resume' | 'delete';

export interface PgBossQueueDepthWindow {
  /** Inclusive bounds, epoch milliseconds. */
  from: number;
  to: number;
  /** Bucket width. */
  bucketSeconds: number;
  /** How a bucket folds its snapshots: the worst backlog seen in it, or the mean. */
  aggregate: 'max' | 'avg';
}

/**
 * The seam between the pg-boss routes and whatever answers them. The routes, schemas and error
 * keys live in the core; the implementation that talks to PostgreSQL is `@worker-manager/pg-boss`,
 * and a stub stands in for it in tests and in the OpenAPI generator.
 *
 * Methods throw {@link PgBossEngineError} for a failure the client should see as a translation
 * key; anything else is answered as a 500.
 */
export interface PgBossEngine {
  info(): Promise<PgBossInfo>;
  /** Why nothing can be read right now, or null when reads are fine. */
  readGate(): Promise<TranslatableMessage | null>;
  /** Why the board cannot write right now, or null when it can. */
  writeGate(): Promise<TranslatableMessage | null>;
  listQueues(): Promise<PgBossQueueSummary[]>;
  getQueue(name: string): Promise<PgBossQueueSummary | null>;
  countStates(name: string): Promise<{ counts: PgBossStateCounts; cap: number }>;
  listJobs(name: string, query: GetPgBossJobsQuery): Promise<GetPgBossJobsResponse>;
  getJob(name: string, id: string): Promise<PgBossJob | null>;
  /**
   * The job with this id in any of `queueNames`, looked up queue by queue on the `(name, id)`
   * key so it never scans the whole job table. The caller passes only the queues it may show.
   */
  findJob(id: string, queueNames: string[]): Promise<PgBossJobSummary | null>;
  /** pg-boss's `queue_stats` snapshots of one queue, bucketed. */
  queueDepth(name: string, window: PgBossQueueDepthWindow): Promise<PgBossQueueDepthPoint[]>;
  /**
   * One keyset page of pg-boss's persisted warnings, newest first. A warning that names a queue
   * `isVisible` refuses, or one the engine's own allowlist hides, is left out of the page.
   */
  listWarnings(
    query: GetPgBossWarningsQuery,
    isVisible: (queueName: string) => Promisify<boolean>
  ): Promise<GetPgBossWarningsResponse>;
  getDependencies(
    name: string,
    id: string
  ): Promise<{ dependencies: PgBossDependencyRef[]; dependents: PgBossDependencyRef[] }>;
  listSchedules(queueName?: string): Promise<PgBossSchedule[]>;
  previewSchedule(body: PreviewPgBossScheduleBody): Promise<string[]>;
  /** Null when pg-boss dropped the job, for instance a duplicate singleton. */
  send(name: string, body: SendPgBossJobBody): Promise<string | null>;
  command(action: PgBossJobAction, name: string, ids: string[]): Promise<PgBossCommandResponse>;
  retryFailed(name: string): Promise<PgBossCommandResponse>;
  deleteQueued(name: string): Promise<PgBossCommandResponse>;
  deleteStored(name: string): Promise<PgBossCommandResponse>;
  upsertSchedule(name: string, body: UpsertPgBossScheduleBody): Promise<PgBossSchedule>;
  removeSchedule(name: string, key: string): Promise<PgBossCommandResponse>;
  /** Hidden queues answer 404 on every route, so a request cannot tell them from missing ones. */
  isVisible(request: WorkerManagerRequest, queueName: string): Promisify<boolean>;
  close(): Promise<void>;
}
