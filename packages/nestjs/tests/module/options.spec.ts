import { Injectable, INestApplication, Module } from '@nestjs/common';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { ExpressAdapter as WorkerManagerExpressAdapter } from '@worker-manager/express';
import { FastifyAdapter as WorkerManagerFastifyAdapter } from '@worker-manager/fastify';
import { uiFixtureBasePath } from '@worker-manager/test-utils';
import { Queue } from 'bullmq';
import {
  WORKER_MANAGER_INSTANCE,
  WorkerManagerModule,
  type WorkerManagerModuleOptions,
  type WorkerManagerOptionsFactory,
} from '../../src';
import { basic, boot, http, type Platform } from '../support/app';
import { connection, uniqueName } from '../support/queues';

const adapters: Array<[Platform, any]> = [
  ['express', WorkerManagerExpressAdapter],
  ['fastify', WorkerManagerFastifyAdapter],
];

describe.each(adapters)('WorkerManagerModule options on %s', (platform, BoardAdapter) => {
  let app: INestApplication | undefined;

  const rootModule = (options: WorkerManagerModuleOptions) => {
    @Module({ imports: [WorkerManagerModule.forRoot(options)] })
    class AppModule {}
    return AppModule;
  };

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('protects the board under a Nest global prefix', async () => {
    app = await boot(
      rootModule({
        adapter: BoardAdapter,
        auth: { strategy: 'basic', users: [{ username: 'admin', password: 's3cret' }] },
        boardOptions: { uiBasePath: uiFixtureBasePath },
      }),
      platform,
      (nest) => nest.setGlobalPrefix('api/v1')
    );

    expect((await http(app).get('/api/v1/queues/api/queues')).status).toBe(401);
    const me = await http(app)
      .get('/api/v1/queues/auth/me')
      .set('Authorization', basic('admin', 's3cret'));
    expect(me.status).toBe(200);
  });

  it('registers nothing with enabled: false, and forFeature becomes a no-op', async () => {
    const queue = new Queue(uniqueName('disabled'), { connection });
    queue.on('error', () => undefined);
    await queue.waitUntilReady();

    @Module({
      imports: [
        WorkerManagerModule.forRoot({ enabled: false, adapter: BoardAdapter }),
        WorkerManagerModule.forFeature({ queue, adapter: BullMQAdapter }),
      ],
    })
    class AppModule {}

    try {
      app = await boot(AppModule, platform);
      expect((await http(app).get('/queues/api/queues')).status).toBe(404);
      expect(app.get(WORKER_MANAGER_INSTANCE)).toBeNull();
    } finally {
      await queue.close();
    }
  });

  it('maps the title shortcut into uiConfig', async () => {
    app = await boot(
      rootModule({
        adapter: BoardAdapter,
        route: '/board',
        title: 'Ops Queues',
        boardOptions: { uiBasePath: uiFixtureBasePath, uiConfig: { boardTitle: 'ignored' } },
      }),
      platform
    );

    const res = await http(app).get('/board');
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

    app = await boot(AppModule, platform);

    expect((await http(app).get('/queues/api/queues')).status).toBe(401);
    const ok = await http(app)
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

    app = await boot(AppModule, platform);

    expect((await http(app).get('/ops/api/queues')).status).toBe(200);
  });
});
