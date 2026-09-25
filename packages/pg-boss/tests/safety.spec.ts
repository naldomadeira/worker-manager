import pg from 'pg';
import { describeWithPostgres, installSchema, jobIn, mountBoard, POSTGRES_URL } from './support';

const DDL = /^\s*(CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COMMENT|REINDEX|VACUUM|CLUSTER)\b/i;

/** Every statement any session of `pool` runs, whatever path sent it. */
function recordStatements(pool: pg.Pool): string[] {
  const statements: string[] = [];
  pool.on('connect', (client) => {
    const query = client.query.bind(client) as (...args: any[]) => any;
    (client as any).query = (config: any, ...rest: any[]) => {
      statements.push(typeof config === 'string' ? config : (config?.text ?? ''));
      return query(config, ...rest);
    };
  });
  return statements;
}

describeWithPostgres('database safety', () => {
  let seed: Awaited<ReturnType<typeof installSchema>>;

  beforeAll(async () => {
    seed = await installSchema('safety');
    await seed.app.createQueue('audited');
  });

  afterAll(() => seed?.teardown());

  it('sends no DDL through a borrowed pool, reading and writing', async () => {
    const pool = new pg.Pool({ connectionString: POSTGRES_URL, max: 2 });
    const statements = recordStatements(pool);
    const { agent, close } = mountBoard({ connection: pool, schema: seed.schema });
    const failed = await jobIn(seed, 'audited', 'failed');

    await agent.get('/api/pg-boss/info').expect(200);
    await agent.get('/api/pg-boss/queues').expect(200);
    await agent.get('/api/pg-boss/queues/audited/counts').expect(200);
    await agent.get('/api/pg-boss/queues/audited/jobs').expect(200);
    await agent.get(`/api/pg-boss/queues/audited/jobs/${failed}`).expect(200);
    await agent.put(`/api/pg-boss/queues/audited/jobs/${failed}/retry`).expect(200);
    await agent.post('/api/pg-boss/queues/audited/jobs').send({ data: {} }).expect(200);
    await agent
      .put('/api/pg-boss/queues/audited/schedules')
      .send({ key: 'k', cron: '0 * * * *' })
      .expect(200);
    await agent.put('/api/pg-boss/queues/audited/schedules/remove').send({ key: 'k' }).expect(200);
    await agent.put('/api/pg-boss/queues/audited/delete-stored').expect(200);
    await close();
    await pool.end();

    expect(statements.length).toBeGreaterThan(10);
    expect(statements.filter((text) => DDL.test(text))).toEqual([]);
  });

  it('reads with nothing but SELECT granted, on a read-only board', async () => {
    const role = `wm_pgb_reader_${process.env.JEST_WORKER_ID ?? '1'}`;
    const { admin, schema } = seed;
    await admin.query(`DROP OWNED BY ${role}`).catch(() => undefined);
    await admin.query(`DROP ROLE IF EXISTS ${role}`);
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD 'reader'`);
    await admin.query(`GRANT USAGE ON SCHEMA "${schema}" TO ${role}`);
    await admin.query(`GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO ${role}`);
    const id = await jobIn(seed, 'audited', 'completed');

    const url = new URL(POSTGRES_URL!);
    url.username = role;
    url.password = 'reader';
    const { agent, close } = mountBoard({ connection: url.toString(), schema }, { readOnly: true });

    try {
      await agent.get('/api/pg-boss/info').expect(200);
      await agent.get('/api/pg-boss/queues').expect(200);
      await agent.get('/api/pg-boss/queues/audited/counts').expect(200);
      await agent.get('/api/pg-boss/queues/audited/jobs?state=completed').expect(200);
      await agent.get(`/api/pg-boss/queues/audited/jobs/${id}`).expect(200);
      await agent.get('/api/pg-boss/schedules').expect(200);
    } finally {
      await close();
      await admin.query(`DROP OWNED BY ${role}`);
      await admin.query(`DROP ROLE ${role}`);
    }
  });

  it('answers a read that outlives the timeout with a key, on every connection mode', async () => {
    const { admin, schema, app } = seed;
    const pool = new pg.Pool({ connectionString: POSTGRES_URL, max: 2 });
    const boards = [
      mountBoard({ connection: POSTGRES_URL, schema, queryTimeoutMs: 300 }),
      mountBoard({ connection: pool, schema, queryTimeoutMs: 300 }),
      mountBoard({ instance: app, schema, queryTimeoutMs: 300 }),
    ];
    // Warm the guard first, so the lock below only ever blocks the list itself.
    for (const board of boards) await board.agent.get('/api/pg-boss/info').expect(200);

    const locker = await admin.connect();
    await locker.query('BEGIN');
    await locker.query(`LOCK TABLE "${schema}".job IN ACCESS EXCLUSIVE MODE`);
    try {
      for (const board of boards) {
        const res = await board.agent.get('/api/pg-boss/queues/audited/jobs').expect(500);
        expect(res.body.error).toEqual({ key: 'ERRORS.PGBOSS_QUERY_TIMEOUT' });
      }
      const counts = await boards[0].agent.get('/api/pg-boss/queues/audited/counts').expect(200);
      expect(counts.body.counts.failed).toEqual({ count: null, capped: false });
    } finally {
      await locker.query('ROLLBACK');
      locker.release();
      for (const board of boards) await board.close();
      await pool.end();
    }
  });
});
