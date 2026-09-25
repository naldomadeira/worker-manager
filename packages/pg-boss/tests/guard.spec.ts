import { SCHEMA_MAX, SCHEMA_MIN } from '../src';
import {
  adminPool,
  describeWithPostgres,
  EXPECTED_SCHEMA,
  installSchema,
  mountBoard,
  POSTGRES_URL,
} from './support';

describeWithPostgres('schema guard', () => {
  it('reports a missing installation and creates nothing', async () => {
    const admin = adminPool();
    const schema = `wm_pgb_${process.env.JEST_WORKER_ID ?? '1'}_absent`;
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    const { agent, close } = mountBoard({ connection: POSTGRES_URL, schema });

    const info = await agent.get('/api/pg-boss/info').expect(200);
    const queues = await agent.get('/api/pg-boss/queues').expect(409);
    const write = await agent.put('/api/pg-boss/queues/any/delete-stored').expect(409);
    const { rows } = await admin.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [schema]);
    await close();
    await admin.end();

    expect(info.body).toMatchObject({
      installed: false,
      readable: false,
      writable: false,
      unavailableReason: { key: 'ERRORS.PGBOSS_NOT_INSTALLED' },
    });
    expect(queues.body.error).toEqual({ key: 'ERRORS.PGBOSS_NOT_INSTALLED' });
    expect(write.body.error).toEqual({ key: 'ERRORS.PGBOSS_NOT_INSTALLED' });
    expect(rows).toEqual([]);
  });

  describe('against an installed schema', () => {
    let seed: Awaited<ReturnType<typeof installSchema>>;

    beforeAll(async () => {
      seed = await installSchema('guard');
      await seed.app.createQueue('guarded');
    });

    afterAll(() => seed?.teardown());

    const setVersion = (version: number) =>
      seed.admin.query(`UPDATE "${seed.schema}".version SET version = $1`, [version]);

    afterEach(() => setVersion(EXPECTED_SCHEMA));

    it('stops reading a schema outside the supported range', async () => {
      await setVersion(SCHEMA_MIN - 1);
      const { agent, close } = mountBoard({ connection: POSTGRES_URL, schema: seed.schema });

      const res = await agent.get('/api/pg-boss/queues').expect(409);
      await close();

      expect(res.body.error).toEqual({
        key: 'ERRORS.PGBOSS_SCHEMA_UNSUPPORTED',
        options: { found: SCHEMA_MIN - 1, min: SCHEMA_MIN, max: SCHEMA_MAX },
      });
    });

    it('keeps reading but stops writing when the database is on another version than the writer', async () => {
      const other = EXPECTED_SCHEMA === SCHEMA_MIN ? SCHEMA_MIN + 1 : SCHEMA_MIN;
      await setVersion(other);
      const { agent, close } = mountBoard({ connection: POSTGRES_URL, schema: seed.schema });

      await agent.get('/api/pg-boss/queues').expect(200);
      const info = await agent.get('/api/pg-boss/info').expect(200);
      const write = await agent.put('/api/pg-boss/queues/guarded/delete-queued').expect(409);
      await close();

      const reason = {
        key: 'ERRORS.PGBOSS_SCHEMA_MISMATCH',
        options: { found: other, expected: EXPECTED_SCHEMA },
      };
      expect(info.body).toMatchObject({
        readable: true,
        writable: false,
        writesDisabledReason: reason,
        capabilities: { send: false, retry: false, bulk: false },
      });
      expect(write.body.error).toEqual({ key: 'ERRORS.PGBOSS_WRITES_DISABLED' });
      expect(write.body.message).toEqual(reason);
    });

    it('leaves the mutations out of a read-only board', async () => {
      const { agent, close } = mountBoard(
        { connection: POSTGRES_URL, schema: seed.schema },
        { readOnly: true }
      );

      await agent.get('/api/pg-boss/queues/guarded').expect(200);
      await agent.put('/api/pg-boss/queues/guarded/delete-queued').expect(404);
      await agent.post('/api/pg-boss/queues/guarded/jobs').send({}).expect(404);
      const info = await agent.get('/api/pg-boss/info').expect(200);
      await close();

      expect(info.body).toMatchObject({ readOnly: true, writable: false });
    });
  });
});
