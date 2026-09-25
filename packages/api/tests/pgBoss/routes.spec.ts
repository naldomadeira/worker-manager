import {
  buildPgBossRoutes,
  createPgBossStubEngine,
  encodePgBossCursor,
  mountBoard,
  type PgBossStubOptions,
} from '@worker-manager/api/engine';
import { ExpressAdapter } from '@worker-manager/express';
import request from 'supertest';

const FAILED = '00000000-0000-4000-8000-000000000001';
const ACTIVE = '00000000-0000-4000-8000-000000000002';
const CANCELLED = '00000000-0000-4000-8000-000000000003';
const MISSING = '00000000-0000-4000-8000-0000000000ff';

function board(options: PgBossStubOptions = {}, readOnly = false) {
  const engine = createPgBossStubEngine({
    queues: ['emails', 'secret'],
    hidden: ['secret'],
    jobs: [
      { id: FAILED, queueName: 'emails', state: 'failed' },
      { id: ACTIVE, queueName: 'emails', state: 'active' },
      { id: CANCELLED, queueName: 'emails', state: 'cancelled' },
    ],
    ...options,
  });
  const serverAdapter = new ExpressAdapter();
  mountBoard({
    engine: 'pg-boss',
    routes: buildPgBossRoutes(engine, { readOnly }),
    serverAdapter,
    options: { uiConfig: { engine: 'bullmq' } as any },
    isReadOnly: () => readOnly,
    readOnlyAtMount: readOnly,
  });
  return request(serverAdapter.getRouter());
}

describe('pg-boss routes', () => {
  it('writes the engine into the entry page, over what the caller passed', async () => {
    const res = await board().get('/').expect(200);

    expect(res.text).toContain('"engine":"pg-boss"');
  });

  it('registers none of the BullMQ routes', async () => {
    await board().get('/api/queues').expect(404);
  });

  it('lists only the visible queues', async () => {
    const res = await board().get('/api/pg-boss/queues').expect(200);

    expect(res.body.queues.map((queue: { name: string }) => queue.name)).toEqual(['emails']);
  });

  it('answers a hidden queue exactly like a missing one', async () => {
    const hidden = await board().get('/api/pg-boss/queues/secret').expect(404);
    const missing = await board().get('/api/pg-boss/queues/nope').expect(404);

    expect(hidden.body).toEqual(missing.body);
    expect(hidden.body.error).toEqual({ key: 'ERRORS.QUEUE_NOT_FOUND' });
  });

  it('rejects a job id that is not a uuid, naming the field', async () => {
    const res = await board().get('/api/pg-boss/queues/emails/jobs/123').expect(400);

    expect(res.body.error).toEqual({
      key: 'ERRORS.INVALID_QUERY_PARAM',
      options: { field: 'jobId' },
    });
  });

  it('reads one job and 404s an unknown one', async () => {
    const res = await board().get(`/api/pg-boss/queues/emails/jobs/${FAILED}`).expect(200);
    expect(res.body.job.state).toBe('failed');

    const missing = await board().get(`/api/pg-boss/queues/emails/jobs/${MISSING}`).expect(404);
    expect(missing.body.error).toEqual({ key: 'ERRORS.JOB_NOT_FOUND' });
  });

  it('pages jobs with cursors and rejects a forged one', async () => {
    const agent = board({
      jobs: Array.from({ length: 5 }, (_, i) => ({
        id: `00000000-0000-4000-8000-00000000001${i}`,
        queueName: 'emails',
        createdOn: `2026-01-01T00:00:0${i}.000Z`,
      })),
    });

    const first = await agent.get('/api/pg-boss/queues/emails/jobs?limit=2').expect(200);
    expect(first.body.jobs.map((job: { id: string }) => job.id.slice(-2))).toEqual(['14', '13']);
    expect(first.body.prevCursor).toBeNull();

    const second = await agent
      .get(`/api/pg-boss/queues/emails/jobs?limit=2&cursor=${first.body.nextCursor}`)
      .expect(200);
    expect(second.body.jobs.map((job: { id: string }) => job.id.slice(-2))).toEqual(['12', '11']);

    const back = await agent
      .get(`/api/pg-boss/queues/emails/jobs?limit=2&cursor=${second.body.prevCursor}`)
      .expect(200);
    expect(back.body.jobs).toEqual(first.body.jobs);

    const forged = await agent.get('/api/pg-boss/queues/emails/jobs?cursor=bm9wZQ').expect(400);
    expect(forged.body.error).toEqual({ key: 'ERRORS.PGBOSS_INVALID_CURSOR' });

    const tooMany = await agent.get('/api/pg-boss/queues/emails/jobs?limit=101').expect(400);
    expect(tooMany.body.error).toEqual({
      key: 'ERRORS.INVALID_QUERY_PARAM',
      options: { field: 'limit' },
    });
  });

  it('round-trips a cursor it did not produce itself', () => {
    const cursor = encodePgBossCursor({
      direction: 'next',
      createdOn: '2026-01-01T00:00:00.123456Z',
      id: FAILED,
    });

    expect(Buffer.from(cursor, 'base64url').toString()).toBe(
      `next|2026-01-01T00:00:00.123456Z|${FAILED}`
    );
  });

  it('counts every state', async () => {
    const res = await board().get('/api/pg-boss/queues/emails/counts').expect(200);

    expect(res.body.counts.failed).toEqual({ count: 1, capped: false });
    expect(Object.keys(res.body.counts)).toEqual([
      'created',
      'retry',
      'active',
      'completed',
      'cancelled',
      'failed',
    ]);
  });

  it('retries a failed job and refuses to retry it twice', async () => {
    const agent = board();

    const res = await agent.put(`/api/pg-boss/queues/emails/jobs/${FAILED}/retry`).expect(200);
    expect(res.body).toEqual({ requested: 1, affected: 1 });

    const again = await agent.put(`/api/pg-boss/queues/emails/jobs/${FAILED}/retry`).expect(409);
    expect(again.body.error).toEqual({
      key: 'ERRORS.PGBOSS_JOB_STATE_CONFLICT',
      options: { action: 'retry', state: 'retry' },
    });
  });

  it('refuses to delete an active job, the way the BullMQ routes do', async () => {
    const res = await board().put(`/api/pg-boss/queues/emails/jobs/${ACTIVE}/remove`).expect(409);

    expect(res.body.error).toEqual({ key: 'ERRORS.JOB_IS_ACTIVE' });
    expect(res.body.message).toEqual({
      key: 'ERRORS.JOB_IS_ACTIVE_DETAILS',
      options: { jobId: ACTIVE },
    });
  });

  it('resumes a cancelled job', async () => {
    await board().put(`/api/pg-boss/queues/emails/jobs/${CANCELLED}/resume`).expect(200);
  });

  it('bounds the bulk body', async () => {
    const ids = Array.from({ length: 101 }, () => FAILED);
    const res = await board()
      .put('/api/pg-boss/queues/emails/jobs/cancel')
      .send({ ids })
      .expect(400);

    expect(res.body.error).toEqual({ key: 'ERRORS.PGBOSS_BULK_LIMIT', options: { max: 100 } });
  });

  it('sends a job and returns its id', async () => {
    const res = await board()
      .post('/api/pg-boss/queues/emails/jobs')
      .send({ data: { to: 'a@b.c' } })
      .expect(200);

    expect(res.body.id).toEqual(expect.any(String));
  });

  it('keeps the routes but refuses writes while the schema guard has them off', async () => {
    const reason = {
      key: 'ERRORS.PGBOSS_SCHEMA_MISMATCH' as const,
      options: { found: 41, expected: 42 },
    };
    const res = await board({ unwritable: reason })
      .put(`/api/pg-boss/queues/emails/jobs/${FAILED}/retry`)
      .expect(409);

    expect(res.body.error).toEqual({ key: 'ERRORS.PGBOSS_WRITES_DISABLED' });
    expect(res.body.message).toEqual(reason);
  });

  it('answers reads with the reason when the schema cannot be read, but still reports info', async () => {
    const reason = { key: 'ERRORS.PGBOSS_NOT_INSTALLED' as const };
    const agent = board({ unreadable: reason });

    const res = await agent.get('/api/pg-boss/queues').expect(409);
    expect(res.body.error).toEqual(reason);

    const info = await agent.get('/api/pg-boss/info').expect(200);
    expect(info.body.installed).toBe(false);
    expect(info.body.unavailableReason).toEqual(reason);
  });

  it('does not register a single mutation on a read-only board', async () => {
    const agent = board({}, true);

    await agent.get('/api/pg-boss/queues').expect(200);
    await agent.put(`/api/pg-boss/queues/emails/jobs/${FAILED}/retry`).expect(404);
    await agent.post('/api/pg-boss/queues/emails/jobs').send({}).expect(404);
    await agent.put('/api/pg-boss/queues/emails/delete-stored').expect(404);
    await agent.put('/api/pg-boss/queues/emails/schedules').send({ cron: '* * * * *' }).expect(404);
  });

  it('previews a schedule and reports an invalid expression with the parser text', async () => {
    const agent = board();

    const ok = await agent
      .post('/api/pg-boss/schedules/preview')
      .send({ expression: '*/5 * * * *', count: 3 })
      .expect(200);
    expect(ok.body.runs).toHaveLength(3);

    const bad = await agent
      .post('/api/pg-boss/schedules/preview')
      .send({ expression: 'nope' })
      .expect(400);
    expect(bad.body.error).toEqual({ key: 'ERRORS.PGBOSS_INVALID_SCHEDULE' });
    expect(bad.body.message).toBe('nope');
  });

  it('upserts and removes a schedule, 404ing an unknown key', async () => {
    const agent = board();

    const put = await agent
      .put('/api/pg-boss/queues/emails/schedules')
      .send({ key: 'nightly', cron: '0 3 * * *' })
      .expect(200);
    expect(put.body.schedule).toMatchObject({ queueName: 'emails', key: 'nightly' });

    const listed = await agent.get('/api/pg-boss/schedules?queueName=emails').expect(200);
    expect(listed.body.schedules).toHaveLength(1);

    await agent
      .put('/api/pg-boss/queues/emails/schedules/remove')
      .send({ key: 'nightly' })
      .expect(200);
    const gone = await agent
      .put('/api/pg-boss/queues/emails/schedules/remove')
      .send({ key: 'nightly' })
      .expect(404);
    expect(gone.body.error).toEqual({ key: 'ERRORS.JOB_SCHEDULER_NOT_FOUND' });
  });

  it('runs a before hook ahead of validation, like every other route', async () => {
    const engine = createPgBossStubEngine();
    const serverAdapter = new ExpressAdapter();
    mountBoard({
      engine: 'pg-boss',
      routes: buildPgBossRoutes(engine, { readOnly: false }),
      serverAdapter,
      options: { handlerHooks: { before: () => ({ allow: false, status: 404 }) } },
      isReadOnly: () => false,
      readOnlyAtMount: false,
    });

    await request(serverAdapter.getRouter())
      .get('/api/pg-boss/queues/default/jobs/bad')
      .expect(404);
  });
});
