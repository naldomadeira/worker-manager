import { quoteSchema, sql } from '../src/sql';
import { describeWithPostgres, installSchema, jobIn, mountBoard, POSTGRES_URL } from './support';

const MISSING = '00000000-0000-4000-8000-0000000000ff';
const MS_PER_MINUTE = 60_000;

describeWithPostgres('job lookup, queue depth and warnings', () => {
  let seed: Awaited<ReturnType<typeof installSchema>>;
  let board: ReturnType<typeof mountBoard>;

  beforeAll(async () => {
    seed = await installSchema('lookup');
    await seed.app.createQueue('emails');
    await seed.app.createQueue('parted', { partition: true });
    await seed.app.createQueue('private');
    await seed.app.createQueue('guarded');
    board = mountBoard({
      connection: POSTGRES_URL,
      schema: seed.schema,
      queues: (name) => name !== 'private',
      visibilityGuard: (request, name) => name !== 'guarded' || request.headers['x-team'] === 'ops',
    });
  });

  afterAll(async () => {
    await board?.close();
    await seed?.teardown();
  });

  const insertWarning = (type: string, message: string, data: unknown, minutesAgo: number) =>
    seed.admin.query(
      `INSERT INTO "${seed.schema}".warning (type, message, data, created_on)
       VALUES ($1, $2, $3, now() - $4 * interval '1 minute')`,
      [type, message, JSON.stringify(data), minutesAgo]
    );

  describe('GET /api/pg-boss/jobs/:jobId', () => {
    it('finds a job without its queue, on a shared and on a partitioned queue', async () => {
      const shared = await jobIn(seed, 'emails', 'failed');
      const parted = await jobIn(seed, 'parted', 'created');

      const one = await board.agent.get(`/api/pg-boss/jobs/${shared}`).expect(200);
      const two = await board.agent.get(`/api/pg-boss/jobs/${parted}`).expect(200);

      expect(one.body.job).toMatchObject({ id: shared, queueName: 'emails', state: 'failed' });
      expect(two.body.job).toMatchObject({ id: parted, queueName: 'parted', state: 'created' });
    });

    it('answers a job on a hidden queue exactly like one that does not exist', async () => {
      const allowlisted = await jobIn(seed, 'private', 'created');
      const guarded = await jobIn(seed, 'guarded', 'created');

      const missing = await board.agent.get(`/api/pg-boss/jobs/${MISSING}`).expect(404);
      const hidden = await board.agent.get(`/api/pg-boss/jobs/${allowlisted}`).expect(404);
      const refused = await board.agent.get(`/api/pg-boss/jobs/${guarded}`).expect(404);
      const allowed = await board.agent
        .get(`/api/pg-boss/jobs/${guarded}`)
        .set('x-team', 'ops')
        .expect(200);

      expect(missing.body.error).toEqual({ key: 'ERRORS.PGBOSS_JOB_NOT_FOUND' });
      expect(hidden.body).toEqual(missing.body);
      expect(refused.body).toEqual(missing.body);
      expect(allowed.body.job.queueName).toBe('guarded');
    });

    it('refuses an id that is not a uuid before it reaches the database', async () => {
      const res = await board.agent.get('/api/pg-boss/jobs/not-a-uuid').expect(400);

      expect(res.body.error).toEqual({
        key: 'ERRORS.INVALID_QUERY_PARAM',
        options: { field: 'jobId' },
      });
    });

    it('probes each queue on its (name, id) key rather than scanning the job table', async () => {
      // A handful of rows makes any plan cheap, so sequential scans are priced out to show the
      // shape the lookup takes on a real table: both key columns in the index condition.
      const client = await seed.admin.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL enable_seqscan = off');
        const { rows } = await client.query(`EXPLAIN ${sql(quoteSchema(seed.schema)).findJob}`, [
          ['emails', 'parted'],
          MISSING,
        ]);
        await client.query('ROLLBACK');
        const plan = rows.map((row) => row['QUERY PLAN']).join('\n');

        expect(plan).toMatch(/Index (Only )?Scan/);
        expect(plan).toMatch(/Index Cond: \(\(name = ANY \(.*\)\) AND \(id = /);
        expect(plan).not.toMatch(/Index Cond: \(id = /);
      } finally {
        client.release();
      }
    });
  });

  describe('GET /api/pg-boss/queues/:queueName/depth', () => {
    it("folds pg-boss's snapshots of the window into buckets", async () => {
      const t = Date.now() - 10 * MS_PER_MINUTE;
      for (const [offset, queued] of [
        [0, 4],
        [1000, 9],
      ]) {
        await seed.admin.query(
          `INSERT INTO "${seed.schema}".queue_stats (name, queued_count, total_count, captured_on)
           VALUES ('emails', $1, $1, to_timestamp($2 / 1000.0))`,
          [queued, t + offset]
        );
      }

      const max = await board.agent.get('/api/pg-boss/queues/emails/depth?range=1h').expect(200);
      const avg = await board.agent
        .get('/api/pg-boss/queues/emails/depth?range=1h&aggregate=avg')
        .expect(200);
      const info = await board.agent.get('/api/pg-boss/info').expect(200);

      expect(max.body.bucketSeconds).toBe(60);
      expect(max.body.to - max.body.from).toBe(3_600_000);
      expect(max.body.points.map((point: { queued: number }) => point.queued)).toContain(9);
      expect(max.body.points[0]).toEqual({
        ts: expect.any(Number),
        deferred: 0,
        queued: expect.any(Number),
        ready: 0,
        active: 0,
        failed: 0,
        total: expect.any(Number),
      });
      expect(avg.body.points.length).toBe(max.body.points.length);
      expect(info.body.persistQueueStats).toBe(true);
    });

    it('is empty for a queue with no snapshots, 404 for a hidden one, 400 for a bad range', async () => {
      const empty = await board.agent.get('/api/pg-boss/queues/parted/depth').expect(200);
      await board.agent.get('/api/pg-boss/queues/private/depth').expect(404);
      const bad = await board.agent.get('/api/pg-boss/queues/emails/depth?range=2y').expect(400);

      expect(empty.body.points).toEqual([]);
      expect(bad.body.error).toEqual({
        key: 'ERRORS.INVALID_QUERY_PARAM',
        options: { field: 'range' },
      });
    });
  });

  describe('GET /api/pg-boss/warnings', () => {
    beforeAll(async () => {
      await seed.admin.query(`DELETE FROM "${seed.schema}".warning`);
      await insertWarning(
        'queue_backlog',
        'Warning: large queue backlog: queue "emails" has 12 jobs',
        { name: 'emails', queuedCount: 12 },
        1
      );
      await insertWarning(
        'queue_backlog',
        'Warning: large queue backlog: queue "private" has 50 jobs',
        { name: 'private', queuedCount: 50 },
        2
      );
      await insertWarning(
        'slow_query',
        'Warning: slow query',
        { elapsed: 31, sql: 'SELECT 1', values: ['private', 3] },
        3
      );
      await insertWarning('invalid_schedule', 'Invalid schedule', { queue: 'guarded', key: '' }, 4);
      await insertWarning('clock_skew', 'Warning: clock skew', { seconds: 12 }, 5);
      await insertWarning('slow_query', 'Warning: slow query', { elapsed: 40, sql: 'SELECT 2' }, 6);
    });

    const types = (res: any) =>
      res.body.warnings.map((warning: { type: string; queueName: string | null }) => [
        warning.type,
        warning.queueName,
      ]);

    it('lists warnings newest first, leaving out any that names a hidden queue', async () => {
      const res = await board.agent.get('/api/pg-boss/warnings').expect(200);
      const ops = await board.agent.get('/api/pg-boss/warnings').set('x-team', 'ops').expect(200);

      expect(types(res)).toEqual([
        ['queue_backlog', 'emails'],
        ['clock_skew', null],
        ['slow_query', null],
      ]);
      expect(types(ops)).toEqual([
        ['queue_backlog', 'emails'],
        ['invalid_schedule', 'guarded'],
        ['clock_skew', null],
        ['slow_query', null],
      ]);
      expect(JSON.stringify(res.body)).not.toContain('private');
      expect(JSON.stringify(ops.body)).not.toContain('private');
      expect(res.body.warnings[0]).toMatchObject({
        message: 'Warning: large queue backlog: queue "emails" has 12 jobs',
        data: { name: 'emails', queuedCount: 12 },
        createdOn: expect.any(String),
      });
    });

    it('pages by date across the hidden ones, forwards and back', async () => {
      const first = await board.agent.get('/api/pg-boss/warnings?limit=2').expect(200);
      const second = await board.agent
        .get(`/api/pg-boss/warnings?limit=2&cursor=${first.body.nextCursor}`)
        .expect(200);
      const back = await board.agent
        .get(`/api/pg-boss/warnings?limit=2&cursor=${second.body.prevCursor}`)
        .expect(200);

      expect(types(first)).toEqual([
        ['queue_backlog', 'emails'],
        ['clock_skew', null],
      ]);
      expect(first.body.prevCursor).toBeNull();
      expect(types(second)).toEqual([['slow_query', null]]);
      expect(second.body.nextCursor).toBeNull();
      expect(back.body.warnings).toEqual(first.body.warnings);
    });

    it('filters by type and reports that warnings are persisted', async () => {
      const slow = await board.agent.get('/api/pg-boss/warnings?type=slow_query').expect(200);
      const info = await board.agent.get('/api/pg-boss/info').expect(200);

      expect(types(slow)).toEqual([['slow_query', null]]);
      expect(info.body.persistWarnings).toBe(true);
      expect(info.body.features.warnings).toBe(true);
    });
  });
});
