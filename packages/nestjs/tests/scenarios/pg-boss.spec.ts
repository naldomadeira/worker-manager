import { INestApplication, Module } from '@nestjs/common';
import { uiFixtureBasePath } from '@worker-manager/test-utils';
import {
  getWorkerManagerToken,
  WorkerManagerModule,
  type WorkerManagerPgBossBoard,
} from '../../src';
import { basic, boot, http, platforms } from '../support/app';
import { installPgBossSchema, POSTGRES_URL } from '../support/pg-boss';
import { uniqueName } from '../support/queues';

const PG_BOSS = 'PG_BOSS';
const auth = (username: string) => ({
  strategy: 'basic' as const,
  users: [{ username, password: 's3cret' }],
});
const admin = basic('admin', 's3cret');
const auditor = basic('auditor', 's3cret');

if (!POSTGRES_URL) {
  describe.skip('pg-boss scenario (skipped: POSTGRES_URL is not set)', () => {
    it('needs POSTGRES_URL', () => undefined);
  });
} else {
  describe.each(platforms)('pg-boss scenario on %s', (platform) => {
    const queue = uniqueName('pgboss');
    let seed: Awaited<ReturnType<typeof installPgBossSchema>>;
    let app: INestApplication;

    const job = async (id: string) =>
      JSON.parse(
        (
          await http(app)
            .get(`/pg-boss/api/pg-boss/queues/${queue}/jobs/${id}`)
            .set('Authorization', admin)
        ).text
      );

    beforeAll(async () => {
      seed = await installPgBossSchema(platform);
      await seed.boss.createQueue(queue);

      @Module({ providers: [{ provide: PG_BOSS, useValue: seed.boss }], exports: [PG_BOSS] })
      class PgBossModule {}

      @Module({
        imports: [
          PgBossModule,
          WorkerManagerModule.forRootAsync({
            name: 'jobs',
            imports: [PgBossModule],
            inject: [PG_BOSS],
            useFactory: (boss: any) => ({
              route: '/pg-boss',
              engine: 'pg-boss' as const,
              auth: auth('admin'),
              boardOptions: { uiBasePath: uiFixtureBasePath },
              pgBoss: { instance: boss, connection: POSTGRES_URL, schema: seed.schema },
            }),
          }),
          WorkerManagerModule.forRoot({
            name: 'audit',
            route: '/pg-boss-audit',
            engine: 'pg-boss',
            readOnly: true,
            auth: auth('auditor'),
            boardOptions: { uiBasePath: uiFixtureBasePath },
            pgBoss: { useExisting: PG_BOSS, schema: seed.schema },
          }),
        ],
      })
      class AppModule {}

      app = await boot(AppModule, platform);
    });

    afterAll(async () => {
      await app?.close();
      await seed?.teardown();
    });

    it('answers 401 without credentials and 200 with basic auth on both prefixes', async () => {
      for (const [prefix, user] of [
        ['/pg-boss', admin],
        ['/pg-boss-audit', auditor],
      ]) {
        expect((await http(app).get(`${prefix}/api/pg-boss/queues`)).status).toBe(401);
        const res = await http(app).get(`${prefix}/api/pg-boss/queues`).set('Authorization', user);
        expect({ prefix, status: res.status }).toEqual({ prefix, status: 200 });
      }
      expect(
        (await http(app).get('/pg-boss-audit/api/pg-boss/queues').set('Authorization', admin))
          .status
      ).toBe(401);
    });

    it('lists the pg-boss queues', async () => {
      const res = await http(app).get('/pg-boss/api/pg-boss/queues').set('Authorization', admin);
      expect(JSON.parse(res.text).queues.map((q: { name: string }) => q.name)).toEqual([queue]);
      const entry = await http(app).get('/pg-boss').set('Authorization', admin);
      expect(entry.text).toContain('"engine":"pg-boss"');
    });

    it('reports the job counts per state', async () => {
      const failed = await seed.boss.send(queue, { n: 1 });
      await seed.moveTo(queue, failed, 'failed');
      await seed.boss.send(queue, { n: 2 });

      const res = await http(app)
        .get(`/pg-boss/api/pg-boss/queues/${queue}/counts`)
        .set('Authorization', admin);
      const { counts } = JSON.parse(res.text);
      expect(counts.failed.count).toBeGreaterThanOrEqual(1);
      expect(counts.created.count).toBeGreaterThanOrEqual(1);
    });

    it('shows a job detail', async () => {
      const id = await seed.boss.send(queue, { invoice: 42 });
      const body = await job(id);
      expect(body.job).toMatchObject({ id, state: 'created', data: { invoice: 42 } });
    });

    it('retries a failed job', async () => {
      const id = await seed.boss.send(queue, {}, { retryLimit: 0 });
      await seed.moveTo(queue, id, 'failed');
      const res = await http(app)
        .put(`/pg-boss/api/pg-boss/queues/${queue}/jobs/${id}/retry`)
        .set('Authorization', admin);
      expect(res.status).toBe(200);
      expect((await job(id)).job.state).toBe('retry');
    });

    it('cancels an active job', async () => {
      const id = await seed.boss.send(queue, {});
      await seed.moveTo(queue, id, 'active');
      const res = await http(app)
        .put(`/pg-boss/api/pg-boss/queues/${queue}/jobs/${id}/cancel`)
        .set('Authorization', admin);
      expect(res.status).toBe(200);
      expect((await job(id)).job.state).toBe('cancelled');
    });

    it('deletes a job', async () => {
      const id = await seed.boss.send(queue, {});
      const res = await http(app)
        .put(`/pg-boss/api/pg-boss/queues/${queue}/jobs/${id}/remove`)
        .set('Authorization', admin);
      expect(res.status).toBe(200);
      expect(
        (
          await http(app)
            .get(`/pg-boss/api/pg-boss/queues/${queue}/jobs/${id}`)
            .set('Authorization', admin)
        ).status
      ).toBe(404);
    });

    it('blocks writes in read-only mode', async () => {
      const id = await seed.boss.send(queue, {});
      const info = await http(app)
        .get('/pg-boss-audit/api/pg-boss/info')
        .set('Authorization', auditor);
      expect(JSON.parse(info.text)).toMatchObject({ readOnly: true, writable: false });
      const res = await http(app)
        .put(`/pg-boss-audit/api/pg-boss/queues/${queue}/jobs/${id}/remove`)
        .set('Authorization', auditor);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect((await job(id)).job.state).toBe('created');
      expect(
        app.get<WorkerManagerPgBossBoard>(getWorkerManagerToken('audit')).engine
      ).toBeDefined();
    });
  });
}
