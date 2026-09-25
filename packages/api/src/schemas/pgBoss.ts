import * as v from 'valibot';
import { redisStatsSchema, translatableMessageSchema } from './domain';
import { key, totalRecord } from './support';

export const PGBOSS_JOB_STATES = [
  'created',
  'retry',
  'active',
  'completed',
  'cancelled',
  'failed',
] as const;

export const PGBOSS_BULK_MAX = 100;

export const PGBOSS_JOBS_PAGE_MAX = 100;

const timestamp = () => v.pipe(v.string(), v.description('ISO 8601.'));

export const pgBossJobIdSchema = v.pipe(v.string(), v.uuid());

export const pgBossJobStateSchema = v.picklist(PGBOSS_JOB_STATES);

export const pgBossQueueCountsSchema = v.pipe(
  v.object({
    queued: v.number(),
    deferred: v.number(),
    ready: v.number(),
    active: v.number(),
    failed: v.number(),
    total: v.number(),
  }),
  v.description(
    "pg-boss's cached counters, written by whichever instance last ran `supervise`. Not live: see `statsCapturedOn`."
  )
);

export const pgBossQueueSummarySchema = v.object({
  name: v.string(),
  policy: v.pipe(
    v.string(),
    v.description(
      'standard, short, singleton, stately, exclusive or key_strict_fifo, as pg-boss reports it.'
    )
  ),
  partition: v.boolean(),
  counts: pgBossQueueCountsSchema,
  statsCapturedOn: v.pipe(
    v.nullable(v.string()),
    v.description('When `counts` were last written. Null means no instance ever monitored it.')
  ),
  readyHistory: v.array(v.number()),
  deadLetter: v.nullable(v.string()),
  retryLimit: v.number(),
  retryDelay: v.number(),
  retryBackoff: v.boolean(),
  retryDelayMax: v.nullable(v.number()),
  expireInSeconds: v.number(),
  retentionSeconds: v.number(),
  deleteAfterSeconds: v.number(),
  warningQueueSize: v.number(),
  backlogged: v.boolean(),
  heartbeatSeconds: v.nullable(v.number()),
  notify: v.boolean(),
  singletonsActive: v.nullable(v.array(v.string())),
  scheduleCount: v.number(),
  createdOn: timestamp(),
  updatedOn: timestamp(),
});

export const pgBossStateCountSchema = v.object({
  count: v.pipe(
    v.nullable(v.number()),
    v.description('Null when the count did not finish inside the query timeout.')
  ),
  capped: v.pipe(v.boolean(), v.description('True when there are more than `cap` jobs.')),
});

export const pgBossStateCountsSchema = totalRecord(PGBOSS_JOB_STATES, pgBossStateCountSchema);

export const pgBossDeadLetterSourceSchema = v.object({
  queueName: v.string(),
  id: v.string(),
  createdOn: v.nullable(v.string()),
  retryCount: v.nullable(v.number()),
});

export const pgBossJobSummarySchema = v.object({
  id: v.string(),
  queueName: v.string(),
  state: pgBossJobStateSchema,
  priority: v.number(),
  retryCount: v.number(),
  retryLimit: v.number(),
  createdOn: timestamp(),
  startAfter: timestamp(),
  startedOn: v.nullable(v.string()),
  completedOn: v.nullable(v.string()),
  singletonKey: v.nullable(v.string()),
  groupId: v.nullable(v.string()),
  deferred: v.pipe(
    v.boolean(),
    v.description('A `created` job whose `startAfter` is still in the future.')
  ),
  blocked: v.pipe(v.boolean(), v.description('A flow dependent still waiting on its parents.')),
  deadLetterSource: v.nullable(pgBossDeadLetterSourceSchema),
});

export const pgBossJobSchema = v.object({
  ...pgBossJobSummarySchema.entries,
  data: v.any(),
  output: v.any(),
  policy: v.nullable(v.string()),
  retryDelay: v.number(),
  retryBackoff: v.boolean(),
  retryDelayMax: v.nullable(v.number()),
  expireInSeconds: v.number(),
  deleteAfterSeconds: v.number(),
  keepUntil: timestamp(),
  singletonOn: v.nullable(v.string()),
  groupTier: v.nullable(v.string()),
  heartbeatSeconds: v.nullable(v.number()),
  heartbeatOn: v.nullable(v.string()),
  deadLetter: v.nullable(v.string()),
  blocking: v.boolean(),
  pendingDependencies: v.number(),
});

export const pgBossDependencyRefSchema = v.object({
  queueName: v.string(),
  id: v.string(),
});

export const pgBossScheduleKindSchema = v.picklist(['cron', 'rrule'] as const);

export const pgBossScheduleSchema = v.object({
  queueName: v.string(),
  key: v.pipe(v.string(), v.description("pg-boss's default key is the empty string.")),
  kind: pgBossScheduleKindSchema,
  expression: v.string(),
  timezone: v.string(),
  data: v.any(),
  options: v.record(v.string(), v.any()),
  createdOn: timestamp(),
  updatedOn: timestamp(),
  lastJobId: v.nullable(v.string()),
  nextRuns: v.pipe(
    v.array(v.string()),
    v.description(
      'The next occurrences, worked out on the server. Empty when the pg-boss in use cannot preview.'
    )
  ),
});

export const pgBossCapabilitiesSchema = v.object({
  send: v.boolean(),
  retry: v.boolean(),
  cancel: v.boolean(),
  resume: v.boolean(),
  delete: v.boolean(),
  scheduleWrite: v.boolean(),
  schedulePreview: v.boolean(),
  bulk: v.boolean(),
});

export const pgBossInfoSchema = v.object({
  schema: v.string(),
  delimiter: v.pipe(
    v.string(),
    v.description('What queue names are split on to group them in the sidebar. Empty for none.')
  ),
  installed: v.boolean(),
  schemaVersion: v.nullable(v.number()),
  supportedRange: v.object({ min: v.number(), max: v.number() }),
  readable: v.boolean(),
  writable: v.boolean(),
  readOnly: v.pipe(v.boolean(), v.description('The board was created with `readOnly`.')),
  unavailableReason: v.pipe(
    v.nullable(translatableMessageSchema),
    v.description('Why nothing can be read, when `readable` is false.')
  ),
  writesDisabledReason: v.pipe(
    v.nullable(translatableMessageSchema),
    v.description('Why the board cannot write, when `writable` is false.')
  ),
  persistQueueStats: v.boolean(),
  datastore: v.nullable(redisStatsSchema),
  capabilities: pgBossCapabilitiesSchema,
});

const queryLimit = v.pipe(
  v.string(key('ERRORS.INVALID_QUERY_PARAM')),
  v.toNumber(key('ERRORS.INVALID_QUERY_PARAM')),
  v.integer(key('ERRORS.INVALID_QUERY_PARAM')),
  v.minValue(1, key('ERRORS.INVALID_QUERY_PARAM')),
  v.maxValue(PGBOSS_JOBS_PAGE_MAX, key('ERRORS.INVALID_QUERY_PARAM'))
);

export const getPgBossJobsQuerySchema = v.object({
  state: v.optional(pgBossJobStateSchema),
  cursor: v.optional(v.string()),
  limit: v.optional(queryLimit, '20'),
  order: v.optional(v.picklist(['desc', 'asc'] as const), 'desc'),
  id: v.optional(pgBossJobIdSchema),
  singletonKey: v.optional(v.string()),
});

export const getPgBossSchedulesQuerySchema = v.partial(v.object({ queueName: v.string() }));

const scheduleMessage = key('ERRORS.PGBOSS_INVALID_SCHEDULE');

export const previewPgBossScheduleBodySchema = v.object(
  {
    expression: v.pipe(v.string(scheduleMessage), v.minLength(1, scheduleMessage)),
    tz: v.optional(v.string(scheduleMessage)),
    count: v.optional(
      v.pipe(
        v.number(key('ERRORS.INVALID_REQUEST_BODY')),
        v.integer(key('ERRORS.INVALID_REQUEST_BODY')),
        v.minValue(1, key('ERRORS.INVALID_REQUEST_BODY')),
        v.maxValue(20, key('ERRORS.INVALID_REQUEST_BODY'))
      ),
      5
    ),
  },
  scheduleMessage
);

const nonNegativeInteger = v.pipe(
  v.number(key('ERRORS.INVALID_REQUEST_BODY')),
  v.integer(key('ERRORS.INVALID_REQUEST_BODY')),
  v.minValue(0, key('ERRORS.INVALID_REQUEST_BODY'))
);

export const sendPgBossJobBodySchema = v.object({
  data: v.optional(v.any()),
  options: v.optional(
    v.object({
      priority: v.optional(v.pipe(v.number(), v.integer())),
      startAfter: v.optional(
        v.pipe(
          v.union([v.string(), v.number()]),
          v.description('An ISO date, or a number of seconds from now.')
        )
      ),
      singletonKey: v.optional(v.string()),
      retryLimit: v.optional(nonNegativeInteger),
      retryDelay: v.optional(nonNegativeInteger),
      retryBackoff: v.optional(v.boolean()),
      expireInSeconds: v.optional(v.pipe(nonNegativeInteger, v.minValue(1))),
    }),
    {}
  ),
});

const bulkMessage = key('ERRORS.PGBOSS_BULK_LIMIT', { max: PGBOSS_BULK_MAX });

export const pgBossJobIdsBodySchema = v.object({
  ids: v.pipe(
    v.array(pgBossJobIdSchema, bulkMessage),
    v.minLength(1, bulkMessage),
    v.maxLength(PGBOSS_BULK_MAX, bulkMessage)
  ),
});

export const upsertPgBossScheduleBodySchema = v.object({
  key: v.optional(v.string(), ''),
  cron: v.pipe(v.string(scheduleMessage), v.minLength(1, scheduleMessage)),
  tz: v.optional(v.string(scheduleMessage)),
  data: v.optional(v.any()),
  options: v.optional(v.record(v.string(), v.any()), {}),
  missed: v.optional(v.picklist(['skip', 'once'] as const, scheduleMessage)),
});

export const removePgBossScheduleBodySchema = v.object({
  key: v.optional(v.string(), ''),
});

export const getPgBossInfoResponseSchema = pgBossInfoSchema;

export const getPgBossQueuesResponseSchema = v.object({
  queues: v.array(pgBossQueueSummarySchema),
});

export const getPgBossQueueResponseSchema = v.object({ queue: pgBossQueueSummarySchema });

export const getPgBossStateCountsResponseSchema = v.object({
  counts: pgBossStateCountsSchema,
  cap: v.number(),
});

export const getPgBossJobsResponseSchema = v.object({
  jobs: v.array(pgBossJobSummarySchema),
  nextCursor: v.pipe(v.nullable(v.string()), v.description('Null on the last page.')),
  prevCursor: v.pipe(v.nullable(v.string()), v.description('Null on the first page.')),
});

export const getPgBossJobResponseSchema = v.object({ job: pgBossJobSchema });

export const getPgBossDependenciesResponseSchema = v.object({
  dependencies: v.array(pgBossDependencyRefSchema),
  dependents: v.array(pgBossDependencyRefSchema),
});

export const getPgBossSchedulesResponseSchema = v.object({
  schedules: v.array(pgBossScheduleSchema),
});

export const previewPgBossScheduleResponseSchema = v.object({ runs: v.array(v.string()) });

export const sendPgBossJobResponseSchema = v.object({
  id: v.pipe(
    v.nullable(v.string()),
    v.description('Null when pg-boss dropped the job, for instance a duplicate singleton.')
  ),
});

export const pgBossCommandResponseSchema = v.object({
  requested: v.number(),
  affected: v.number(),
});

export const pgBossScheduleResponseSchema = v.object({ schedule: pgBossScheduleSchema });

export const pgBossDomainSchemas = {
  PgBossJobState: pgBossJobStateSchema,
  PgBossQueueCounts: pgBossQueueCountsSchema,
  PgBossQueueSummary: pgBossQueueSummarySchema,
  PgBossStateCount: pgBossStateCountSchema,
  PgBossStateCounts: pgBossStateCountsSchema,
  PgBossDeadLetterSource: pgBossDeadLetterSourceSchema,
  PgBossJobSummary: pgBossJobSummarySchema,
  PgBossJob: pgBossJobSchema,
  PgBossDependencyRef: pgBossDependencyRefSchema,
  PgBossScheduleKind: pgBossScheduleKindSchema,
  PgBossSchedule: pgBossScheduleSchema,
  PgBossCapabilities: pgBossCapabilitiesSchema,
  PgBossInfo: pgBossInfoSchema,
};

export const pgBossRequestSchemas = {
  GetPgBossJobsQuery: getPgBossJobsQuerySchema,
  GetPgBossSchedulesQuery: getPgBossSchedulesQuerySchema,
  PreviewPgBossScheduleBody: previewPgBossScheduleBodySchema,
  SendPgBossJobBody: sendPgBossJobBodySchema,
  PgBossJobIdsBody: pgBossJobIdsBodySchema,
  UpsertPgBossScheduleBody: upsertPgBossScheduleBodySchema,
  RemovePgBossScheduleBody: removePgBossScheduleBodySchema,
};

export const pgBossResponseSchemas = {
  GetPgBossInfoResponse: getPgBossInfoResponseSchema,
  GetPgBossQueuesResponse: getPgBossQueuesResponseSchema,
  GetPgBossQueueResponse: getPgBossQueueResponseSchema,
  GetPgBossStateCountsResponse: getPgBossStateCountsResponseSchema,
  GetPgBossJobsResponse: getPgBossJobsResponseSchema,
  GetPgBossJobResponse: getPgBossJobResponseSchema,
  GetPgBossDependenciesResponse: getPgBossDependenciesResponseSchema,
  GetPgBossSchedulesResponse: getPgBossSchedulesResponseSchema,
  PreviewPgBossScheduleResponse: previewPgBossScheduleResponseSchema,
  SendPgBossJobResponse: sendPgBossJobResponseSchema,
  PgBossCommandResponse: pgBossCommandResponseSchema,
  PgBossScheduleResponse: pgBossScheduleResponseSchema,
};
