import * as v from 'valibot';
import { errorResponse } from '../../errors';
import { pgBossJobIdSchema } from '../../schemas/pgBoss';
import type {
  GetPgBossJobsQuery,
  GetPgBossSchedulesQuery,
  PgBossJobIdsBody,
  PreviewPgBossScheduleBody,
  RemovePgBossScheduleBody,
  SendPgBossJobBody,
  UpsertPgBossScheduleBody,
} from '../../schemas/requests';
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
} from '../../schemas/responses';
import type {
  ControllerHandlerReturnType,
  PgBossJobState,
  PgBossQueueSummary,
  WorkerManagerRequest,
} from '../../types';
import { PgBossEngineError } from './errors';
import type { PgBossEngine, PgBossJobAction } from './types';

type Result<T> = Promise<ControllerHandlerReturnType<T>>;

/** The states each single-job action is valid in, the same rules pg-boss's own SQL applies. */
const ACTION_STATES: Record<PgBossJobAction, readonly PgBossJobState[]> = {
  retry: ['failed'],
  cancel: ['created', 'retry', 'active'],
  resume: ['cancelled'],
  delete: ['created', 'retry', 'completed', 'cancelled', 'failed'],
};

async function answer<T>(run: () => Result<T>): Result<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof PgBossEngineError) {
      return errorResponse(
        error.status,
        error.options ? { key: error.key, options: error.options } : error.key,
        error.detail === undefined ? {} : { message: error.detail }
      );
    }
    throw error;
  }
}

async function readable<T>(engine: PgBossEngine, run: () => Result<T>): Result<T> {
  return answer(async () => {
    const reason = await engine.readGate();
    return reason ? errorResponse(409, reason) : run();
  });
}

async function writable<T>(engine: PgBossEngine, run: () => Result<T>): Result<T> {
  return readable(engine, async () => {
    const reason = await engine.writeGate();
    return reason
      ? errorResponse(409, 'ERRORS.PGBOSS_WRITES_DISABLED', { message: reason })
      : run();
  });
}

async function withQueue<T>(
  engine: PgBossEngine,
  req: WorkerManagerRequest<any, any>,
  run: (queue: PgBossQueueSummary) => Result<T>
): Result<T> {
  const name = String(req.params.queueName ?? '');
  const queue = (await engine.isVisible(req, name)) ? await engine.getQueue(name) : null;
  return queue ? run(queue) : errorResponse(404, 'ERRORS.QUEUE_NOT_FOUND');
}

function parseJobId(req: WorkerManagerRequest<any, any>): string | null {
  const parsed = v.safeParse(pgBossJobIdSchema, req.params.jobId);
  return parsed.success ? parsed.output : null;
}

const invalidJobId = () =>
  errorResponse(
    400,
    { key: 'ERRORS.INVALID_QUERY_PARAM', options: { field: 'jobId' } },
    { code: 'INVALID_REQUEST' }
  );

const conflict = (action: PgBossJobAction, state: PgBossJobState) =>
  errorResponse(409, { key: 'ERRORS.PGBOSS_JOB_STATE_CONFLICT', options: { action, state } });

export function createPgBossHandlers(engine: PgBossEngine) {
  const info = (): Result<GetPgBossInfoResponse> =>
    answer(async () => ({ body: await engine.info() }));

  const queues = (req: WorkerManagerRequest): Result<GetPgBossQueuesResponse> =>
    readable(engine, async () => {
      const visible: PgBossQueueSummary[] = [];
      for (const queue of await engine.listQueues()) {
        if (await engine.isVisible(req, queue.name)) visible.push(queue);
      }
      return { body: { queues: visible } };
    });

  const queue = (req: WorkerManagerRequest): Result<GetPgBossQueueResponse> =>
    readable(engine, () => withQueue(engine, req, async (found) => ({ body: { queue: found } })));

  const counts = (req: WorkerManagerRequest): Result<GetPgBossStateCountsResponse> =>
    readable(engine, () =>
      withQueue(engine, req, async (found) => ({ body: await engine.countStates(found.name) }))
    );

  const jobs = (req: WorkerManagerRequest<GetPgBossJobsQuery>): Result<GetPgBossJobsResponse> =>
    readable(engine, () =>
      withQueue(engine, req, async (found) => ({
        body: await engine.listJobs(found.name, req.query),
      }))
    );

  const job = (req: WorkerManagerRequest): Result<GetPgBossJobResponse> =>
    readable(engine, () =>
      withQueue(engine, req, async (found) => {
        const id = parseJobId(req);
        if (!id) return invalidJobId();
        const detail = await engine.getJob(found.name, id);
        return detail ? { body: { job: detail } } : errorResponse(404, 'ERRORS.JOB_NOT_FOUND');
      })
    );

  const dependencies = (req: WorkerManagerRequest): Result<GetPgBossDependenciesResponse> =>
    readable(engine, () =>
      withQueue(engine, req, async (found) => {
        const id = parseJobId(req);
        if (!id) return invalidJobId();
        if (!(await engine.getJob(found.name, id)))
          return errorResponse(404, 'ERRORS.JOB_NOT_FOUND');
        return { body: await engine.getDependencies(found.name, id) };
      })
    );

  const schedules = (
    req: WorkerManagerRequest<GetPgBossSchedulesQuery>
  ): Result<GetPgBossSchedulesResponse> =>
    readable(engine, async () => {
      const { queueName } = req.query;
      if (queueName !== undefined) {
        const visible =
          (await engine.isVisible(req, queueName)) && (await engine.getQueue(queueName));
        if (!visible) return errorResponse(404, 'ERRORS.QUEUE_NOT_FOUND');
      }
      const listed = [];
      for (const schedule of await engine.listSchedules(queueName)) {
        if (await engine.isVisible(req, schedule.queueName)) listed.push(schedule);
      }
      return { body: { schedules: listed } };
    });

  const preview = (
    req: WorkerManagerRequest<Record<string, any>, PreviewPgBossScheduleBody>
  ): Result<PreviewPgBossScheduleResponse> =>
    answer(async () => ({ body: { runs: await engine.previewSchedule(req.body) } }));

  const send = (
    req: WorkerManagerRequest<Record<string, any>, SendPgBossJobBody>
  ): Result<SendPgBossJobResponse> =>
    writable(engine, () =>
      withQueue(engine, req, async (found) => ({
        body: { id: await engine.send(found.name, req.body) },
      }))
    );

  const jobCommand =
    (action: PgBossJobAction) =>
    (req: WorkerManagerRequest): Result<PgBossCommandResponse> =>
      writable(engine, () =>
        withQueue<PgBossCommandResponse>(engine, req, async (found) => {
          const id = parseJobId(req);
          if (!id) return invalidJobId();

          const current = await engine.getJob(found.name, id);
          if (!current) return errorResponse(404, 'ERRORS.JOB_NOT_FOUND');
          if (action === 'delete' && current.state === 'active') {
            return errorResponse(409, 'ERRORS.JOB_IS_ACTIVE', {
              message: { key: 'ERRORS.JOB_IS_ACTIVE_DETAILS', options: { jobId: id } },
            });
          }
          if (!ACTION_STATES[action].includes(current.state))
            return conflict(action, current.state);

          const result = await engine.command(action, found.name, [id]);
          if (result.affected === 0) {
            // The job moved between the read and the write; report where it went.
            const moved = await engine.getJob(found.name, id);
            return moved
              ? conflict(action, moved.state)
              : errorResponse(404, 'ERRORS.JOB_NOT_FOUND');
          }
          return { body: result };
        })
      );

  const bulkCommand =
    (action: PgBossJobAction) =>
    (
      req: WorkerManagerRequest<Record<string, any>, PgBossJobIdsBody>
    ): Result<PgBossCommandResponse> =>
      writable(engine, () =>
        withQueue(engine, req, async (found) => ({
          body: await engine.command(action, found.name, req.body.ids),
        }))
      );

  const queueCommand =
    (run: (name: string) => Promise<PgBossCommandResponse>) =>
    (req: WorkerManagerRequest): Result<PgBossCommandResponse> =>
      writable(engine, () =>
        withQueue(engine, req, async (found) => ({ body: await run(found.name) }))
      );

  const upsertSchedule = (
    req: WorkerManagerRequest<Record<string, any>, UpsertPgBossScheduleBody>
  ): Result<PgBossScheduleResponse> =>
    writable(engine, () =>
      withQueue(engine, req, async (found) => ({
        body: { schedule: await engine.upsertSchedule(found.name, req.body) },
      }))
    );

  const removeSchedule = (
    req: WorkerManagerRequest<Record<string, any>, RemovePgBossScheduleBody>
  ): Result<PgBossCommandResponse> =>
    writable(engine, () =>
      withQueue<PgBossCommandResponse>(engine, req, async (found) => {
        const result = await engine.removeSchedule(found.name, req.body.key);
        return result.affected === 0
          ? errorResponse(404, 'ERRORS.JOB_SCHEDULER_NOT_FOUND')
          : { body: result };
      })
    );

  return {
    info,
    queues,
    queue,
    counts,
    jobs,
    job,
    dependencies,
    schedules,
    preview,
    send,
    jobCommand,
    bulkCommand,
    retryFailed: queueCommand((name) => engine.retryFailed(name)),
    deleteQueued: queueCommand((name) => engine.deleteQueued(name)),
    deleteStored: queueCommand((name) => engine.deleteStored(name)),
    upsertSchedule,
    removeSchedule,
  };
}
