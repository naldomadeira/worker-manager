import { defineRoute } from '../../routes';
import type { AppControllerRoute } from '../../types';
import { createPgBossHandlers } from './handlers';
import type { PgBossEngine, PgBossJobAction } from './types';

const AVAILABILITY = "The board was created with engine 'pg-boss'.";
const WRITE_AVAILABILITY = `${AVAILABILITY} The board is not read-only. Answers 409 \`ERRORS.PGBOSS_WRITES_DISABLED\` while the schema guard has writes off.`;

const JOB_ACTIONS: { action: PgBossJobAction; path: string; one: string; many: string }[] = [
  { action: 'retry', path: 'retry', one: 'Retry one failed job.', many: 'Retry failed jobs' },
  {
    action: 'cancel',
    path: 'cancel',
    one: 'Cancel one job that has not finished. A running handler is not interrupted.',
    many: 'Cancel jobs that have not finished',
  },
  {
    action: 'resume',
    path: 'resume',
    one: 'Resume one cancelled job.',
    many: 'Resume cancelled jobs',
  },
  {
    action: 'delete',
    path: 'remove',
    one: 'Delete one job that is not active.',
    many: 'Delete jobs',
  },
];

/**
 * The route table of a pg-boss board, bound to its engine the way `buildHistoryRoutes` is bound
 * to its provider. Mutations are left out of a read-only board altogether, so a forged request
 * gets a 404 rather than a refusal that confirms the route exists.
 */
export function buildPgBossRoutes(
  engine: PgBossEngine,
  { readOnly }: { readOnly: boolean }
): AppControllerRoute[] {
  const handlers = createPgBossHandlers(engine);

  const reads: AppControllerRoute[] = [
    defineRoute({
      method: 'get',
      route: '/api/pg-boss/info',
      spec: {
        summary: 'Report the pg-boss installation, the schema guard and what the board can do.',
        response: 'GetPgBossInfoResponse',
        availableWhen: AVAILABILITY,
      },
      handler: handlers.info,
    }),
    defineRoute({
      method: 'get',
      route: '/api/pg-boss/queues',
      spec: {
        summary: 'List every visible pg-boss queue with its cached counters.',
        response: 'GetPgBossQueuesResponse',
        availableWhen: AVAILABILITY,
      },
      handler: handlers.queues,
    }),
    defineRoute({
      method: 'get',
      route: '/api/pg-boss/queues/:queueName',
      spec: {
        summary: 'Read one pg-boss queue.',
        response: 'GetPgBossQueueResponse',
        availableWhen: AVAILABILITY,
      },
      handler: handlers.queue,
    }),
    defineRoute({
      method: 'get',
      route: '/api/pg-boss/queues/:queueName/counts',
      spec: {
        summary: 'Count the jobs of one queue in each state, live and capped.',
        response: 'GetPgBossStateCountsResponse',
        availableWhen: AVAILABILITY,
      },
      handler: handlers.counts,
    }),
    defineRoute({
      method: 'get',
      route: '/api/pg-boss/queues/:queueName/jobs',
      spec: {
        summary: 'List the jobs of one queue, newest first, one keyset page at a time.',
        response: 'GetPgBossJobsResponse',
        query: 'GetPgBossJobsQuery',
        availableWhen: AVAILABILITY,
      },
      handler: handlers.jobs,
    }),
    defineRoute({
      method: 'get',
      route: '/api/pg-boss/queues/:queueName/jobs/:jobId',
      spec: {
        summary: 'Read one job with its data and output.',
        response: 'GetPgBossJobResponse',
        availableWhen: AVAILABILITY,
      },
      handler: handlers.job,
    }),
    defineRoute({
      method: 'get',
      route: '/api/pg-boss/queues/:queueName/jobs/:jobId/dependencies',
      spec: {
        summary: 'List the jobs one job waits on and the jobs waiting on it.',
        response: 'GetPgBossDependenciesResponse',
        availableWhen: AVAILABILITY,
      },
      handler: handlers.dependencies,
    }),
    defineRoute({
      method: 'get',
      route: '/api/pg-boss/schedules',
      spec: {
        summary: 'List the schedules of every visible queue, or one named queue.',
        response: 'GetPgBossSchedulesResponse',
        query: 'GetPgBossSchedulesQuery',
        availableWhen: AVAILABILITY,
      },
      handler: handlers.schedules,
    }),
    defineRoute({
      method: 'post',
      route: '/api/pg-boss/schedules/preview',
      spec: {
        summary: 'Work out the next occurrences of a cron or RRULE expression.',
        response: 'PreviewPgBossScheduleResponse',
        body: 'PreviewPgBossScheduleBody',
        availableWhen: `${AVAILABILITY} Needs pg-boss 12.31 or later, else 409 \`ERRORS.PGBOSS_PREVIEW_UNAVAILABLE\`.`,
      },
      handler: handlers.preview,
    }),
  ];

  if (readOnly) {
    return reads;
  }

  return [
    ...reads,
    defineRoute({
      method: 'post',
      route: '/api/pg-boss/queues/:queueName/jobs',
      spec: {
        summary: 'Send a job to one queue.',
        response: 'SendPgBossJobResponse',
        body: 'SendPgBossJobBody',
        availableWhen: WRITE_AVAILABILITY,
      },
      handler: handlers.send,
    }),
    ...JOB_ACTIONS.flatMap(({ action, path, one, many }) => [
      defineRoute({
        method: 'put',
        route: `/api/pg-boss/queues/:queueName/jobs/${path}`,
        spec: {
          summary: `${many}, up to 100 ids at once.`,
          response: 'PgBossCommandResponse',
          body: 'PgBossJobIdsBody',
          availableWhen: WRITE_AVAILABILITY,
        },
        handler: handlers.bulkCommand(action),
      }),
      defineRoute({
        method: 'put',
        route: `/api/pg-boss/queues/:queueName/jobs/:jobId/${path}`,
        spec: {
          summary: one,
          response: 'PgBossCommandResponse',
          availableWhen: WRITE_AVAILABILITY,
        },
        handler: handlers.jobCommand(action),
      }),
    ]),
    defineRoute({
      method: 'put',
      route: '/api/pg-boss/queues/:queueName/retry-failed',
      spec: {
        summary: 'Retry every failed job of one queue.',
        response: 'PgBossCommandResponse',
        availableWhen: WRITE_AVAILABILITY,
      },
      handler: handlers.retryFailed,
    }),
    defineRoute({
      method: 'put',
      route: '/api/pg-boss/queues/:queueName/delete-queued',
      spec: {
        summary: 'Delete every job of one queue that has not started.',
        response: 'PgBossCommandResponse',
        availableWhen: WRITE_AVAILABILITY,
      },
      handler: handlers.deleteQueued,
    }),
    defineRoute({
      method: 'put',
      route: '/api/pg-boss/queues/:queueName/delete-stored',
      spec: {
        summary: 'Delete every completed, cancelled and failed job of one queue.',
        response: 'PgBossCommandResponse',
        availableWhen: WRITE_AVAILABILITY,
      },
      handler: handlers.deleteStored,
    }),
    defineRoute({
      method: 'put',
      route: '/api/pg-boss/queues/:queueName/schedules',
      spec: {
        summary: 'Create or replace the schedule with this key on one queue.',
        response: 'PgBossScheduleResponse',
        body: 'UpsertPgBossScheduleBody',
        availableWhen: WRITE_AVAILABILITY,
      },
      handler: handlers.upsertSchedule,
    }),
    defineRoute({
      method: 'put',
      route: '/api/pg-boss/queues/:queueName/schedules/remove',
      spec: {
        summary: 'Remove one schedule.',
        response: 'PgBossCommandResponse',
        body: 'RemovePgBossScheduleBody',
        availableWhen: WRITE_AVAILABILITY,
      },
      handler: handlers.removeSchedule,
    }),
  ];
}
