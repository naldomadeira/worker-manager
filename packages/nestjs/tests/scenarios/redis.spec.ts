import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { INestApplication, Module } from '@nestjs/common';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { uiFixtureBasePath } from '@worker-manager/test-utils';
import type { Queue } from 'bullmq';
import { WorkerManagerModule } from '../../src';
import { basic, boot, http, platforms, queueNames } from '../support/app';
import { connection, uniqueName } from '../support/queues';

const auth = {
  strategy: 'basic' as const,
  users: [{ username: 'admin', password: 's3cret', roles: ['ops'] }],
};
const admin = basic('admin', 's3cret');

const closeAll = async (app: INestApplication, names: string[]) => {
  for (const name of names) {
    await app.get<Queue>(getQueueToken(name), { strict: false }).obliterate({ force: true });
  }
  await app.close();
};

describe.each(platforms)('Redis scenario on %s', (platform) => {
  describe('basic auth', () => {
    const name = uniqueName('redis');
    let app: INestApplication;

    @Module({
      imports: [
        BullModule.forRoot({ connection }),
        BullModule.registerQueue({ name }),
        WorkerManagerModule.forRoot({ auth, boardOptions: { uiBasePath: uiFixtureBasePath } }),
        WorkerManagerModule.forFeature({ name, adapter: BullMQAdapter }),
      ],
    })
    class AppModule {}

    beforeAll(async () => {
      app = await boot(AppModule, platform);
    });

    afterAll(() => closeAll(app, [name]));

    it('answers 401 with a Basic challenge without valid credentials', async () => {
      for (const path of ['/queues/api/queues', '/queues', '/queues/static/test-asset.txt']) {
        const res = await http(app).get(path);
        expect({ path, status: res.status }).toEqual({ path, status: 401 });
        expect(res.headers['www-authenticate']).toMatch(/^Basic /);
      }
      const wrong = await http(app)
        .get('/queues/api/queues')
        .set('Authorization', basic('admin', 'x'));
      expect(wrong.status).toBe(401);
      expect(JSON.parse(wrong.text).error).toEqual({ key: 'ERRORS.UNAUTHORIZED' });
    });

    it('lists the queue with valid credentials', async () => {
      const res = await http(app).get('/queues/api/queues').set('Authorization', admin);
      expect(res.status).toBe(200);
      expect(queueNames(res)).toEqual([name]);
    });

    it('returns the user from /auth/me', async () => {
      const res = await http(app).get('/queues/auth/me').set('Authorization', admin);
      expect(JSON.parse(res.text)).toEqual({
        strategy: 'basic',
        user: { username: 'admin', roles: ['ops'] },
        logoutUrl: null,
      });
    });

    it('shows a job added through the API', async () => {
      const added = await http(app)
        .post(`/queues/api/queues/${name}/add`)
        .set('Authorization', admin)
        .send({ name: 'invoice', data: { id: 1 } });
      expect(added.status).toBeLessThan(300);

      const res = await http(app)
        .get(`/queues/api/queues?activeQueue=${name}&status=waiting`)
        .set('Authorization', admin);
      const queue = JSON.parse(res.text).queues.find((q: { name: string }) => q.name === name);
      expect(queue.jobs.map((job: { name: string }) => job.name)).toEqual(['invoice']);
    });

    it('pauses the queue', async () => {
      const res = await http(app)
        .put(`/queues/api/queues/${name}/pause`)
        .set('Authorization', admin);
      expect(res.status).toBeLessThan(300);
      expect(await app.get<Queue>(getQueueToken(name), { strict: false }).isPaused()).toBe(true);
    });
  });

  describe('readOnly', () => {
    const locked = uniqueName('locked');
    const writable = uniqueName('writable');
    let app: INestApplication;

    @Module({
      imports: [
        BullModule.forRoot({ connection }),
        BullModule.registerQueue({ name: locked }, { name: writable }),
        WorkerManagerModule.forRoot({
          readOnly: true,
          boardOptions: { uiBasePath: uiFixtureBasePath },
          queues: [{ name: writable, adapter: BullMQAdapter, options: { readOnlyMode: false } }],
        }),
        WorkerManagerModule.forFeature({ name: locked, adapter: BullMQAdapter }),
      ],
    })
    class AppModule {}

    beforeAll(async () => {
      app = await boot(AppModule, platform);
    });

    afterAll(() => closeAll(app, [locked, writable]));

    it('blocks writes unless the queue opts out', async () => {
      const res = await http(app).get('/queues/api/queues');
      const readOnly = Object.fromEntries(
        JSON.parse(res.text).queues.map((q: { name: string; readOnlyMode: boolean }) => [
          q.name,
          q.readOnlyMode,
        ])
      );
      expect(readOnly).toEqual({ [locked]: true, [writable]: false });
      expect((await http(app).put(`/queues/api/queues/${locked}/pause`)).status).toBe(405);
    });
  });
});
