import { SCHEMA_MAX, SCHEMA_MIN } from '../src';
import { ALL_COLUMNS, type SchemaColumns } from '../src/sql';
import { assessSchema } from '../src/versionGuard';
import {
  adminPool,
  describeWithPostgres,
  EXPECTED_SCHEMA,
  installSchema,
  mountBoard,
  POSTGRES_URL,
} from './support';

const without = (...gone: string[]): SchemaColumns => ({
  has: (table, column) => !gone.includes(`${table}.${column}`) && !gone.includes(table),
  hasTable: (table) => !gone.includes(table),
});

describe('assessSchema', () => {
  it('refuses a schema older than the floor, or one with no version', () => {
    for (const version of [SCHEMA_MIN - 1, null]) {
      expect(assessSchema(version, ALL_COLUMNS)).toMatchObject({
        readable: false,
        unavailableReason: {
          key: 'ERRORS.PGBOSS_SCHEMA_UNSUPPORTED',
          options: { found: version, min: SCHEMA_MIN, max: SCHEMA_MAX },
        },
      });
    }
  });

  it('keeps reading a schema newer than the ceiling, and marks it untested', () => {
    expect(assessSchema(SCHEMA_MAX + 3, ALL_COLUMNS)).toMatchObject({
      readable: true,
      untested: true,
      unavailableReason: null,
      disabledFeatures: [],
    });
    expect(assessSchema(SCHEMA_MAX, ALL_COLUMNS).untested).toBe(false);
  });

  it('turns off what a schema lacks, and names only what this version should have had', () => {
    const older = assessSchema(40, without('schedule.kind', 'schedule.last_job_id'));
    const newer = assessSchema(
      SCHEMA_MAX + 1,
      without('schedule.kind', 'warning', 'queue.ready_history')
    );

    expect(older.features.scheduleKind).toBe(false);
    expect(older.disabledFeatures).toEqual([]);
    expect(newer.readable).toBe(true);
    expect(newer.features).toMatchObject({
      scheduleKind: false,
      warnings: false,
      readyHistory: false,
      queueDepth: true,
    });
    expect(newer.disabledFeatures).toEqual(['readyHistory', 'scheduleKind', 'warnings']);
  });

  it('stops reading a schema that lost a column no read can do without', () => {
    expect(assessSchema(SCHEMA_MAX + 1, without('job.state', 'queue.policy'))).toMatchObject({
      readable: false,
      unavailableReason: {
        key: 'ERRORS.PGBOSS_SCHEMA_INCOMPATIBLE',
        options: { found: SCHEMA_MAX + 1, missing: 'queue.policy, job.state' },
      },
    });
  });
});

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

    describe('on a schema newer than the tested ceiling', () => {
      const newer = SCHEMA_MAX + 1;

      beforeEach(async () => {
        await setVersion(newer);
        await seed.admin.query(
          `ALTER TABLE "${seed.schema}".job ADD COLUMN IF NOT EXISTS wm_future_column text`
        );
      });

      afterEach(() =>
        seed.admin.query(`ALTER TABLE "${seed.schema}".job DROP COLUMN IF EXISTS wm_future_column`)
      );

      it('keeps reading, and keeps writes off with a reason that says why', async () => {
        const id = await seed.app.send('guarded', { n: 1 });
        const { agent, close } = mountBoard({ connection: POSTGRES_URL, schema: seed.schema });

        const queues = await agent.get('/api/pg-boss/queues').expect(200);
        const job = await agent.get(`/api/pg-boss/queues/guarded/jobs/${id}`).expect(200);
        const info = await agent.get('/api/pg-boss/info').expect(200);
        const write = await agent.put('/api/pg-boss/queues/guarded/delete-queued').expect(409);
        await close();

        const reason = {
          key: 'ERRORS.PGBOSS_SCHEMA_UNTESTED',
          options: { found: newer, max: SCHEMA_MAX },
        };
        expect(queues.body.queues.map((queue: { name: string }) => queue.name)).toContain(
          'guarded'
        );
        expect(job.body.job).toMatchObject({ id, data: { n: 1 } });
        expect(info.body).toMatchObject({
          schemaVersion: newer,
          readable: true,
          untested: true,
          writable: false,
          writesDisabledReason: reason,
          // The floor's tables relabelled as a newer schema miss what schema 41 added.
          disabledFeatures: EXPECTED_SCHEMA >= 41 ? [] : ['scheduleKind'],
          capabilities: { send: false, delete: false, bulk: false },
        });
        expect(write.body.error).toEqual({ key: 'ERRORS.PGBOSS_WRITES_DISABLED' });
        expect(write.body.message).toEqual(reason);
      });

      it('writes through the app instance once the board allows an untested schema', async () => {
        const { agent, close } = mountBoard({
          instance: seed.app,
          schema: seed.schema,
          allowUntestedSchema: true,
        });

        const info = await agent.get('/api/pg-boss/info').expect(200);
        await agent.put('/api/pg-boss/queues/guarded/delete-queued').expect(200);
        await close();

        expect(info.body).toMatchObject({
          untested: true,
          writable: true,
          writesDisabledReason: null,
        });
      });

      it('still holds an unstarted writer to its own schema version when allowed', async () => {
        const { agent, close } = mountBoard({
          connection: POSTGRES_URL,
          schema: seed.schema,
          allowUntestedSchema: true,
        });

        const info = await agent.get('/api/pg-boss/info').expect(200);
        await close();

        expect(info.body.writesDisabledReason).toEqual({
          key: 'ERRORS.PGBOSS_SCHEMA_MISMATCH',
          options: { found: newer, expected: EXPECTED_SCHEMA },
        });
      });
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

  it('reads around what a schema lacks, and turns only that off', async () => {
    const seed = await installSchema('guard_cols');
    try {
      await seed.app.createQueue('lean');
      const id = await seed.app.send('lean', { n: 1 });
      await seed.admin.query(
        `ALTER TABLE "${seed.schema}".queue DROP COLUMN ready_history CASCADE;
         DROP TABLE "${seed.schema}".warning CASCADE;
         DROP TABLE "${seed.schema}".job_dependency CASCADE;`
      );
      const { agent, close } = mountBoard({ connection: POSTGRES_URL, schema: seed.schema });

      const info = await agent.get('/api/pg-boss/info').expect(200);
      const queue = await agent.get('/api/pg-boss/queues/lean').expect(200);
      const job = await agent.get(`/api/pg-boss/queues/lean/jobs/${id}`).expect(200);
      const dependencies = await agent
        .get(`/api/pg-boss/queues/lean/jobs/${id}/dependencies`)
        .expect(200);
      const warnings = await agent.get('/api/pg-boss/warnings').expect(409);
      await close();

      expect(info.body).toMatchObject({
        readable: true,
        untested: false,
        writable: true,
        persistWarnings: false,
        features: { readyHistory: false, warnings: false, dependencies: false, queueDepth: true },
      });
      expect(info.body.disabledFeatures).toEqual(['readyHistory', 'dependencies', 'warnings']);
      expect(queue.body.queue.readyHistory).toEqual([]);
      expect(job.body.job).toMatchObject({ id, data: { n: 1 } });
      expect(dependencies.body).toEqual({ dependencies: [], dependents: [] });
      expect(warnings.body.error).toEqual({
        key: 'ERRORS.PGBOSS_FEATURE_UNAVAILABLE',
        options: { feature: 'warnings' },
      });
    } finally {
      await seed.teardown();
    }
  });
});
