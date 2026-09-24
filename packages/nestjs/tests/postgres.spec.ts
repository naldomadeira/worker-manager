import 'reflect-metadata';
import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { uiFixtureBasePath } from '@worker-manager/test-utils';
import request from 'supertest';
import { BullBoardModule } from '../src';

/**
 * A BullMQ v6 queue backed by PostgreSQL has no Redis client and no DI token, so it reaches
 * the module as an instance through `queues`. Skipped, loudly, without a database: a silent
 * pass would look exactly like coverage.
 */
const POSTGRES_URL = process.env.POSTGRES_URL;

if (!POSTGRES_URL) {
  describe.skip('BullBoardModule with a PostgreSQL-backed queue (skipped: POSTGRES_URL is not set)', () => {
    it('needs POSTGRES_URL', () => undefined);
  });
} else {
  describe('BullBoardModule with a PostgreSQL-backed queue (bullmq@6)', () => {
    let app: INestApplication | undefined;
    let queue: any;

    beforeEach(async () => {
      const bullmq: any = await import('bullmq-v6');
      const { Queue, createPostgresBackend } = bullmq.Queue ? bullmq : bullmq.default;
      queue = new Queue(
        `nest-pg-${process.env.JEST_WORKER_ID}-${Date.now()}`,
        { connection: POSTGRES_URL },
        createPostgresBackend
      );
      await queue.waitUntilReady();
    });

    afterEach(async () => {
      if (app) await app.close();
      app = undefined;
      await queue?.obliterate({ force: true }).catch(() => undefined);
      await queue?.close();
    });

    it('serves the queue, its jobs and a datastore without Redis', async () => {
      await queue.add('invoice', { id: 42 });

      @Module({
        imports: [
          BullBoardModule.forRoot({
            boardOptions: { uiBasePath: uiFixtureBasePath },
            queues: [{ queue, adapter: BullMQAdapter }],
          }),
        ],
      })
      class AppModule {}

      app = await NestFactory.create(AppModule, new ExpressAdapter(), { logger: false });
      await app.init();
      const server = app.getHttpServer();

      const list = await request(server).get('/queues/api/queues').expect(200);
      const entry = JSON.parse(list.text).queues.find(
        (q: { name: string }) => q.name === queue.name
      );
      expect(entry).toBeDefined();
      expect(entry.counts.waiting).toBe(1);
      expect(entry.statuses).not.toContain('paused');

      const jobs = await request(server)
        .get(`/queues/api/queues?activeQueue=${encodeURIComponent(queue.name)}&status=waiting`)
        .expect(200);
      const active = JSON.parse(jobs.text).queues.find(
        (q: { name: string }) => q.name === queue.name
      );
      expect(active.jobs.map((job: { name: string }) => job.name)).toEqual(['invoice']);

      const stats = await request(server).get('/queues/api/redis/stats').expect(200);
      expect(JSON.parse(stats.text).backend).toBe('postgres');

      const added = await request(server)
        .post(`/queues/api/queues/${encodeURIComponent(queue.name)}/add`)
        .send({ name: 'from-board', data: { ok: true } });
      expect(added.status).toBeLessThan(300);
      expect((await queue.getJobCounts('waiting')).waiting).toBe(2);
    });
  });
}
