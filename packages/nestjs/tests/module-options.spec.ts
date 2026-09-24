import 'reflect-metadata';
import { Injectable, INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { ExpressAdapter as WorkerManagerExpressAdapter } from '@worker-manager/express';
import { FastifyAdapter as WorkerManagerFastifyAdapter } from '@worker-manager/fastify';
import { uiFixtureBasePath } from '@worker-manager/test-utils';
import { Queue } from 'bullmq';
import request from 'supertest';
import {
  WORKER_MANAGER_INSTANCE,
  WorkerManagerModule,
  type WorkerManagerModuleOptions,
  type WorkerManagerOptionsFactory,
} from '../src';

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: +(process.env.REDIS_PORT || 6379),
};

const basic = (user: string, password: string) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

type Platform = 'express' | 'fastify';

const platforms: Array<[Platform, any]> = [
  ['express', WorkerManagerExpressAdapter],
  ['fastify', WorkerManagerFastifyAdapter],
];

let counter = 0;
const uniqueName = (label: string) =>
  `nest-opts-${label}-${process.env.JEST_WORKER_ID}-${counter++}`;

async function boot(platform: Platform, AppModule: any): Promise<INestApplication> {
  const httpAdapter = platform === 'express' ? new ExpressAdapter() : new FastifyAdapter();
  const app = await NestFactory.create(AppModule, httpAdapter as any, { logger: false });
  await app.init();
  if (platform === 'fastify') {
    await app.getHttpAdapter().getInstance().ready();
  }

  return app;
}

describe.each(platforms)('WorkerManagerModule options on %s', (platform, BoardAdapter) => {
  const queues: Queue[] = [];
  let app: INestApplication | undefined;

  const makeQueue = async (label: string) => {
    const queue = new Queue(uniqueName(label), { connection });
    queue.on('error', () => undefined);
    queues.push(queue);
    await queue.waitUntilReady();
    return queue;
  };

  const rootModule = (options: WorkerManagerModuleOptions) => {
    @Module({ imports: [WorkerManagerModule.forRoot(options)] })
    class AppModule {}
    return AppModule;
  };

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    await Promise.all(queues.map((queue) => queue.close()));
    queues.length = 0;
  });

  describe('auth: basic', () => {
    const auth = {
      strategy: 'basic' as const,
      users: [{ username: 'admin', password: 's3cret', roles: ['ops'] }],
    };

    it('answers 401 with a challenge without credentials, on the API, the page and assets', async () => {
      app = await boot(
        platform,
        rootModule({ adapter: BoardAdapter, auth, boardOptions: { uiBasePath: uiFixtureBasePath } })
      );
      const server = app.getHttpServer();

      for (const path of ['/queues/api/queues', '/queues', '/queues/static/test-asset.txt']) {
        const res = await request(server).get(path);
        expect({ path, status: res.status }).toEqual({ path, status: 401 });
        expect(res.headers['www-authenticate']).toMatch(/^Basic /);
      }
      const res = await request(server).get('/queues/api/queues');
      expect(JSON.parse(res.text).error).toEqual({ key: 'ERRORS.UNAUTHORIZED' });
    });

    it('serves the board and /auth/me with valid credentials', async () => {
      const queue = await makeQueue('auth');
      app = await boot(
        platform,
        rootModule({
          adapter: BoardAdapter,
          auth,
          boardOptions: { uiBasePath: uiFixtureBasePath },
          queues: [{ queue, adapter: BullMQAdapter }],
        })
      );
      const server = app.getHttpServer();

      const api = await request(server)
        .get('/queues/api/queues')
        .set('Authorization', basic('admin', 's3cret'));
      expect(api.status).toBe(200);
      expect(JSON.parse(api.text).queues.map((q: { name: string }) => q.name)).toEqual([
        queue.name,
      ]);

      const me = await request(server)
        .get('/queues/auth/me')
        .set('Authorization', basic('admin', 's3cret'));
      expect(JSON.parse(me.text)).toEqual({
        strategy: 'basic',
        user: { username: 'admin', roles: ['ops'] },
        logoutUrl: null,
      });

      const wrong = await request(server)
        .get('/queues/api/queues')
        .set('Authorization', basic('admin', 'nope'));
      expect(wrong.status).toBe(401);
    });

    it('protects the board under a Nest global prefix', async () => {
      const httpAdapter = platform === 'express' ? new ExpressAdapter() : new FastifyAdapter();
      app = await NestFactory.create(
        rootModule({
          adapter: BoardAdapter,
          auth,
          boardOptions: { uiBasePath: uiFixtureBasePath },
        }),
        httpAdapter as any,
        { logger: false }
      );
      app.setGlobalPrefix('api/v1');
      await app.init();
      if (platform === 'fastify') await app.getHttpAdapter().getInstance().ready();
      const server = app.getHttpServer();

      expect((await request(server).get('/api/v1/queues/api/queues')).status).toBe(401);
      const me = await request(server)
        .get('/api/v1/queues/auth/me')
        .set('Authorization', basic('admin', 's3cret'));
      expect(me.status).toBe(200);
    });
  });

  it('picks the server adapter from the Nest platform when none is given', async () => {
    const queue = await makeQueue('detect');
    app = await boot(
      platform,
      rootModule({
        boardOptions: { uiBasePath: uiFixtureBasePath },
        queues: [{ queue, adapter: BullMQAdapter }],
      })
    );

    const res = await request(app.getHttpServer()).get('/queues/api/queues');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text).queues.map((q: { name: string }) => q.name)).toEqual([queue.name]);
  });

  it('registers nothing with enabled: false, and forFeature becomes a no-op', async () => {
    const queue = await makeQueue('disabled');

    @Module({
      imports: [
        WorkerManagerModule.forRoot({ enabled: false, adapter: BoardAdapter }),
        WorkerManagerModule.forFeature({ queue, adapter: BullMQAdapter }),
      ],
    })
    class AppModule {}

    app = await boot(platform, AppModule);

    expect((await request(app.getHttpServer()).get('/queues/api/queues')).status).toBe(404);
    expect(app.get(WORKER_MANAGER_INSTANCE)).toBeNull();
  });

  it('applies readOnly to every queue unless the queue overrides it', async () => {
    const locked = await makeQueue('locked');
    const writable = await makeQueue('writable');
    const fromFeature = await makeQueue('feature');

    @Module({
      imports: [
        WorkerManagerModule.forRoot({
          adapter: BoardAdapter,
          readOnly: true,
          boardOptions: { uiBasePath: uiFixtureBasePath },
          queues: [
            { queue: locked, adapter: BullMQAdapter },
            { queue: writable, adapter: BullMQAdapter, options: { readOnlyMode: false } },
          ],
        }),
        WorkerManagerModule.forFeature({ queue: fromFeature, adapter: BullMQAdapter }),
      ],
    })
    class AppModule {}

    app = await boot(platform, AppModule);

    const res = await request(app.getHttpServer()).get('/queues/api/queues');
    const byName = Object.fromEntries(
      (JSON.parse(res.text).queues as Array<{ name: string; readOnlyMode: boolean }>).map((q) => [
        q.name,
        q.readOnlyMode,
      ])
    );
    expect(byName).toEqual({
      [locked.name]: true,
      [writable.name]: false,
      [fromFeature.name]: true,
    });

    const pause = await request(app.getHttpServer()).put(`/queues/api/queues/${locked.name}/pause`);
    expect(pause.status).toBe(405);
  });

  it('maps the title/logo/theme shortcuts into uiConfig', async () => {
    app = await boot(
      platform,
      rootModule({
        adapter: BoardAdapter,
        route: '/board',
        title: 'Ops Queues',
        boardOptions: { uiBasePath: uiFixtureBasePath, uiConfig: { boardTitle: 'ignored' } },
      })
    );

    const res = await request(app.getHttpServer()).get('/board');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Ops Queues');
  });

  it('builds its options from a useClass factory in forRootAsync', async () => {
    @Injectable()
    class BoardConfig implements WorkerManagerOptionsFactory {
      createWorkerManagerOptions(): WorkerManagerModuleOptions {
        return {
          adapter: BoardAdapter,
          boardOptions: { uiBasePath: uiFixtureBasePath },
          auth: { strategy: 'basic', users: [{ username: 'cfg', password: 'from-class' }] },
        };
      }
    }

    @Module({ imports: [WorkerManagerModule.forRootAsync({ useClass: BoardConfig })] })
    class AppModule {}

    app = await boot(platform, AppModule);
    const server = app.getHttpServer();

    expect((await request(server).get('/queues/api/queues')).status).toBe(401);
    const ok = await request(server)
      .get('/queues/api/queues')
      .set('Authorization', basic('cfg', 'from-class'));
    expect(ok.status).toBe(200);
  });

  it('builds its options from a useExisting provider in forRootAsync', async () => {
    @Injectable()
    class SharedConfig implements WorkerManagerOptionsFactory {
      createWorkerManagerOptions(): WorkerManagerModuleOptions {
        return { boardOptions: { uiBasePath: uiFixtureBasePath }, route: '/ops' };
      }
    }

    @Module({ providers: [SharedConfig], exports: [SharedConfig] })
    class ConfigModule {}

    @Module({
      imports: [
        WorkerManagerModule.forRootAsync({ imports: [ConfigModule], useExisting: SharedConfig }),
      ],
    })
    class AppModule {}

    app = await boot(platform, AppModule);

    expect((await request(app.getHttpServer()).get('/ops/api/queues')).status).toBe(200);
  });
});
