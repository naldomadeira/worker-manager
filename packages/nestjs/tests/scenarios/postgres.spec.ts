import { INestApplication, Module } from '@nestjs/common';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { uiFixtureBasePath } from '@worker-manager/test-utils';
import { WorkerManagerModule } from '../../src';
import { basic, boot, http } from '../support/app';
import { uniqueName } from '../support/queues';

const POSTGRES_URL = process.env.POSTGRES_URL;
const admin = basic('admin', 's3cret');

if (!POSTGRES_URL) {
  describe.skip('Postgres scenario (skipped: POSTGRES_URL is not set)', () => {
    it('needs POSTGRES_URL', () => undefined);
  });
} else {
  describe('Postgres scenario (bullmq@6)', () => {
    let app: INestApplication;
    let queue: any;

    beforeAll(async () => {
      const bullmq: any = await import('bullmq-v6');
      const { Queue, createPostgresBackend } = bullmq.Queue ? bullmq : bullmq.default;
      queue = new Queue(
        uniqueName('pg'),
        { connection: { connectionString: POSTGRES_URL } },
        createPostgresBackend
      );
      await queue.waitUntilReady();
      await queue.add('invoice', { id: 42 });

      @Module({
        imports: [
          WorkerManagerModule.forRoot({
            auth: { strategy: 'basic', users: [{ username: 'admin', password: 's3cret' }] },
            boardOptions: { uiBasePath: uiFixtureBasePath },
            queues: [{ queue, adapter: BullMQAdapter }],
          }),
        ],
      })
      class AppModule {}

      app = await boot(AppModule);
    });

    afterAll(async () => {
      await app?.close();
      await queue?.obliterate({ force: true }).catch(() => undefined);
      await queue?.close();
    });

    it('lists the queue with its counts', async () => {
      expect((await http(app).get('/queues/api/queues')).status).toBe(401);
      const res = await http(app).get('/queues/api/queues').set('Authorization', admin);
      const entry = JSON.parse(res.text).queues.find(
        (q: { name: string }) => q.name === queue.name
      );
      expect(entry.counts.waiting).toBe(1);
      expect(entry.statuses).not.toContain('paused');
    });

    it('adds a job through the API', async () => {
      const res = await http(app)
        .post(`/queues/api/queues/${encodeURIComponent(queue.name)}/add`)
        .set('Authorization', admin)
        .send({ name: 'from-board', data: {} });
      expect(res.status).toBeLessThan(300);
      expect((await queue.getJobCounts('waiting')).waiting).toBe(2);
    });

    it('reports postgres datastore stats', async () => {
      const res = await http(app).get('/queues/api/redis/stats').set('Authorization', admin);
      expect(res.status).toBe(200);
      expect(JSON.parse(res.text).backend).toBe('postgres');
    });
  });
}
