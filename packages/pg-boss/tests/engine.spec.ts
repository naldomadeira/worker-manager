import { SCHEMA_MAX, SCHEMA_MIN } from '../src';
import {
  describeWithPostgres,
  EXPECTED_SCHEMA,
  installSchema,
  jobIn,
  mountBoard,
  POSTGRES_URL,
} from './support';

const HAS_PREVIEW = EXPECTED_SCHEMA >= 41;

describeWithPostgres('pg-boss engine', () => {
  let seed: Awaited<ReturnType<typeof installSchema>>;
  let board: ReturnType<typeof mountBoard>;

  beforeAll(async () => {
    seed = await installSchema('engine');
    await seed.app.createQueue('emails');
    await seed.app.createQueue('reports', { warningQueueSize: 1 });
    await seed.app.createQueue('private');
    board = mountBoard(
      { connection: POSTGRES_URL, schema: seed.schema, queues: (name) => name !== 'private' },
      {}
    );
  });

  afterAll(async () => {
    await board?.close();
    await seed?.teardown();
  });

  it('installed the schema of the pg-boss this run maps, inside the supported range', async () => {
    const res = await board.agent.get('/api/pg-boss/info').expect(200);

    expect(res.body.schemaVersion).toBe(EXPECTED_SCHEMA);
    expect(EXPECTED_SCHEMA).toBeGreaterThanOrEqual(SCHEMA_MIN);
    expect(EXPECTED_SCHEMA).toBeLessThanOrEqual(SCHEMA_MAX);
    expect(res.body).toMatchObject({
      schema: seed.schema,
      installed: true,
      readable: true,
      writable: true,
      writesDisabledReason: null,
      supportedRange: { min: SCHEMA_MIN, max: SCHEMA_MAX },
      capabilities: { send: true, retry: true, schedulePreview: HAS_PREVIEW },
    });
    expect(res.body.datastore.backend).toBe('postgres');
  });

  it('writes the engine into the entry page', async () => {
    const res = await board.agent.get('/').expect(200);

    expect(res.text).toContain('"engine":"pg-boss"');
  });

  it('lists the queues the allowlist lets through, without pg-boss internals', async () => {
    const res = await board.agent.get('/api/pg-boss/queues').expect(200);
    const names = res.body.queues.map((queue: { name: string }) => queue.name);

    expect(names).toEqual(['emails', 'reports']);
    expect(res.body.queues[1]).toMatchObject({
      name: 'reports',
      policy: 'standard',
      partition: false,
      warningQueueSize: 1,
      statsCapturedOn: null,
    });
    await board.agent.get('/api/pg-boss/queues/private').expect(404);
  });

  it('counts every state live, and caps the count', async () => {
    const { schema } = seed;
    await seed.app.createQueue('counted');
    for (let i = 0; i < 4; i++) await jobIn(seed, 'counted', 'failed');
    await jobIn(seed, 'counted', 'created');

    const capped = mountBoard({ connection: POSTGRES_URL, schema, countCap: 3 });
    const res = await capped.agent.get('/api/pg-boss/queues/counted/counts').expect(200);
    await capped.close();

    expect(res.body.cap).toBe(3);
    expect(res.body.counts.failed).toEqual({ count: 3, capped: true });
    expect(res.body.counts.created).toEqual({ count: 1, capped: false });
    expect(res.body.counts.completed).toEqual({ count: 0, capped: false });
  });

  it('pages with a keyset cursor, including across jobs created in the same instant', async () => {
    await seed.app.createQueue('paged');
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) ids.push(await jobIn(seed, 'paged', 'created', { i }));
    // Three of them share one created_on, which is exactly where an OFFSET-less cursor slips.
    await seed.admin.query(
      `UPDATE "${seed.schema}".job SET created_on = '2026-01-01T00:00:00.123456Z' WHERE name = 'paged' AND id = ANY($1::uuid[])`,
      [ids.slice(2, 5)]
    );

    const seen: string[] = [];
    let cursor: string | null = null;
    const pages: string[][] = [];
    do {
      const res = await board.agent
        .get(`/api/pg-boss/queues/paged/jobs?limit=2${cursor ? `&cursor=${cursor}` : ''}`)
        .expect(200);
      pages.push(res.body.jobs.map((job: { id: string }) => job.id));
      seen.push(...pages[pages.length - 1]);
      cursor = res.body.nextCursor;
    } while (cursor);

    expect(new Set(seen).size).toBe(7);
    expect([...seen].sort()).toEqual([...ids].sort());

    const second = await board.agent.get('/api/pg-boss/queues/paged/jobs?limit=2').expect(200);
    const third = await board.agent
      .get(`/api/pg-boss/queues/paged/jobs?limit=2&cursor=${second.body.nextCursor}`)
      .expect(200);
    const back = await board.agent
      .get(`/api/pg-boss/queues/paged/jobs?limit=2&cursor=${third.body.prevCursor}`)
      .expect(200);

    expect(second.body.prevCursor).toBeNull();
    expect(back.body.jobs).toEqual(second.body.jobs);
    expect(back.body.prevCursor).toBeNull();
  });

  it('filters by state, id and singleton key', async () => {
    await seed.app.createQueue('filtered');
    const failed = await jobIn(seed, 'filtered', 'failed');
    const keyed = await seed.app.send('filtered', {}, { singletonKey: 'k-1' });

    const byState = await board.agent
      .get('/api/pg-boss/queues/filtered/jobs?state=failed')
      .expect(200);
    const byId = await board.agent.get(`/api/pg-boss/queues/filtered/jobs?id=${keyed}`).expect(200);
    const byKey = await board.agent
      .get('/api/pg-boss/queues/filtered/jobs?singletonKey=k-1')
      .expect(200);

    expect(byState.body.jobs.map((job: { id: string }) => job.id)).toEqual([failed]);
    expect(byId.body.jobs.map((job: { id: string }) => job.id)).toEqual([keyed]);
    expect(byKey.body.jobs[0]).toMatchObject({ id: keyed, singletonKey: 'k-1', deferred: false });
  });

  it('reads a job with its data and output, and its dependencies', async () => {
    const id = await jobIn(seed, 'emails', 'failed', { to: 'a@b.c' });

    const res = await board.agent.get(`/api/pg-boss/queues/emails/jobs/${id}`).expect(200);
    expect(res.body.job).toMatchObject({
      id,
      queueName: 'emails',
      state: 'failed',
      data: { to: 'a@b.c' },
      output: { message: 'boom' },
      retryLimit: 0,
    });

    const deps = await board.agent
      .get(`/api/pg-boss/queues/emails/jobs/${id}/dependencies`)
      .expect(200);
    expect(deps.body).toEqual({ dependencies: [], dependents: [] });

    await board.agent
      .get('/api/pg-boss/queues/emails/jobs/00000000-0000-4000-8000-000000000000')
      .expect(404);
  });

  it('retries, cancels, resumes and deletes through the pg-boss API, with the states checked', async () => {
    const failed = await jobIn(seed, 'emails', 'failed');
    const created = await jobIn(seed, 'emails', 'created');
    const active = await jobIn(seed, 'emails', 'active');
    const state = async (id: string) =>
      (await board.agent.get(`/api/pg-boss/queues/emails/jobs/${id}`)).body.job.state;

    await board.agent.put(`/api/pg-boss/queues/emails/jobs/${failed}/retry`).expect(200);
    expect(await state(failed)).toBe('retry');

    const conflict = await board.agent
      .put(`/api/pg-boss/queues/emails/jobs/${created}/retry`)
      .expect(409);
    expect(conflict.body.error).toEqual({
      key: 'ERRORS.PGBOSS_JOB_STATE_CONFLICT',
      options: { action: 'retry', state: 'created' },
    });

    await board.agent.put(`/api/pg-boss/queues/emails/jobs/${created}/cancel`).expect(200);
    expect(await state(created)).toBe('cancelled');
    await board.agent.put(`/api/pg-boss/queues/emails/jobs/${created}/resume`).expect(200);
    expect(await state(created)).toBe('created');

    const refused = await board.agent
      .put(`/api/pg-boss/queues/emails/jobs/${active}/remove`)
      .expect(409);
    expect(refused.body.error).toEqual({ key: 'ERRORS.JOB_IS_ACTIVE' });

    await board.agent.put(`/api/pg-boss/queues/emails/jobs/${created}/remove`).expect(200);
    await board.agent.get(`/api/pg-boss/queues/emails/jobs/${created}`).expect(404);
  });

  it('never deletes an active job in bulk', async () => {
    const active = await jobIn(seed, 'emails', 'active');
    const done = await jobIn(seed, 'emails', 'completed');

    const res = await board.agent
      .put('/api/pg-boss/queues/emails/jobs/remove')
      .send({ ids: [active, done] })
      .expect(200);

    expect(res.body).toEqual({ requested: 2, affected: 1 });
    await board.agent.get(`/api/pg-boss/queues/emails/jobs/${active}`).expect(200);
  });

  it('retries every failed job, and clears the queued and stored ones', async () => {
    await seed.app.createQueue('sweep');
    for (let i = 0; i < 3; i++) await jobIn(seed, 'sweep', 'failed');
    await jobIn(seed, 'sweep', 'created');
    await jobIn(seed, 'sweep', 'completed');

    const retried = await board.agent.put('/api/pg-boss/queues/sweep/retry-failed').expect(200);
    expect(retried.body).toEqual({ requested: 3, affected: 3 });

    const queued = await board.agent.put('/api/pg-boss/queues/sweep/delete-queued').expect(200);
    expect(queued.body.affected).toBe(4);

    const stored = await board.agent.put('/api/pg-boss/queues/sweep/delete-stored').expect(200);
    expect(stored.body.affected).toBe(1);

    const counts = await board.agent.get('/api/pg-boss/queues/sweep/counts').expect(200);
    expect(Object.values(counts.body.counts).every((c: any) => c.count === 0)).toBe(true);
  });

  it('sends a job with options', async () => {
    const res = await board.agent
      .post('/api/pg-boss/queues/emails/jobs')
      .send({ data: { hello: 'world' }, options: { priority: 3, startAfter: 3600 } })
      .expect(200);

    const job = await board.agent.get(`/api/pg-boss/queues/emails/jobs/${res.body.id}`).expect(200);
    expect(job.body.job).toMatchObject({ priority: 3, deferred: true, data: { hello: 'world' } });
  });

  it('creates, lists and removes schedules, and rejects a bad expression with the parser text', async () => {
    const put = await board.agent
      .put('/api/pg-boss/queues/reports/schedules')
      .send({ key: 'nightly', cron: '0 3 * * *', tz: 'UTC', data: { full: true } })
      .expect(200);
    expect(put.body.schedule).toMatchObject({
      queueName: 'reports',
      key: 'nightly',
      kind: 'cron',
      expression: '0 3 * * *',
      data: { full: true },
    });
    expect(put.body.schedule.nextRuns).toHaveLength(HAS_PREVIEW ? 5 : 0);

    const listed = await board.agent.get('/api/pg-boss/schedules').expect(200);
    expect(listed.body.schedules.map((s: { key: string }) => s.key)).toEqual(['nightly']);

    const queue = await board.agent.get('/api/pg-boss/queues/reports').expect(200);
    expect(queue.body.queue.scheduleCount).toBe(1);

    const bad = await board.agent
      .put('/api/pg-boss/queues/reports/schedules')
      .send({ cron: 'not a cron' })
      .expect(400);
    expect(bad.body.error).toEqual({ key: 'ERRORS.PGBOSS_INVALID_SCHEDULE' });
    expect(typeof bad.body.message).toBe('string');

    await board.agent
      .put('/api/pg-boss/queues/reports/schedules/remove')
      .send({ key: 'nightly' })
      .expect(200);
    await board.agent
      .put('/api/pg-boss/queues/reports/schedules/remove')
      .send({ key: 'nightly' })
      .expect(404);
  });

  it('previews a schedule only where pg-boss can', async () => {
    const res = await board.agent
      .post('/api/pg-boss/schedules/preview')
      .send({ expression: '*/15 * * * *', count: 3 });

    if (HAS_PREVIEW) {
      expect(res.status).toBe(200);
      expect(res.body.runs).toHaveLength(3);
    } else {
      expect(res.status).toBe(409);
      expect(res.body.error).toEqual({ key: 'ERRORS.PGBOSS_PREVIEW_UNAVAILABLE' });
    }
  });

  it('reads and writes through the app instance alone', async () => {
    const viaInstance = mountBoard({ instance: seed.app, schema: seed.schema });
    const id = await jobIn(seed, 'emails', 'failed');

    await viaInstance.agent.get(`/api/pg-boss/queues/emails/jobs/${id}`).expect(200);
    await viaInstance.agent.put(`/api/pg-boss/queues/emails/jobs/${id}/retry`).expect(200);
    const info = await viaInstance.agent.get('/api/pg-boss/info').expect(200);
    await viaInstance.close();

    expect(info.body.writable).toBe(true);
  });

  it('asks the visibility guard per request, and can show pg-boss internals', async () => {
    const guarded = mountBoard({
      connection: POSTGRES_URL,
      schema: seed.schema,
      includeInternalQueues: true,
      visibilityGuard: (request, name) => name !== 'emails' || request.headers['x-team'] === 'mail',
    });

    const anonymous = await guarded.agent.get('/api/pg-boss/queues').expect(200);
    const mail = await guarded.agent.get('/api/pg-boss/queues').set('x-team', 'mail').expect(200);
    await guarded.agent.get('/api/pg-boss/queues/emails/jobs').expect(404);
    await guarded.close();

    const names = (res: any) => res.body.queues.map((queue: { name: string }) => queue.name);
    expect(names(anonymous)).not.toContain('emails');
    expect(names(mail)).toContain('emails');
  });
});
