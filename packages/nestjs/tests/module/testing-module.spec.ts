import { Inject, INestApplication, Injectable, Module } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { uiFixtureBasePath } from '@worker-manager/test-utils';
import { Queue } from 'bullmq';
import {
  WORKER_MANAGER_ADAPTER,
  WORKER_MANAGER_INSTANCE,
  WorkerManagerModule,
  type WorkerManagerBoard,
} from '../../src';
import { basic, http, queueNames, platforms, type Platform } from '../support/app';
import { connection, uniqueName } from '../support/queues';

const httpAdapter = (platform: Platform) =>
  platform === 'express' ? new ExpressAdapter() : new FastifyAdapter();

describe.each(platforms)('WorkerManagerModule in a TestingModule on %s', (platform) => {
  let app: INestApplication | undefined;
  const queues: Queue[] = [];

  const newQueue = async (label: string) => {
    const queue = new Queue(uniqueName(label), { connection });
    queue.on('error', () => undefined);
    await queue.waitUntilReady();
    queues.push(queue);
    return queue;
  };

  const start = async (AppModule: any) => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(httpAdapter(platform) as any, { logger: false });
    await app.init();
    if (platform === 'fastify') await app.getHttpAdapter().getInstance().ready();
    return moduleRef;
  };

  afterEach(async () => {
    await app?.close();
    app = undefined;
    await Promise.all(queues.splice(0).map((queue) => queue.close()));
  });

  it('picks the server adapter once createNestApplication() provides the platform', async () => {
    const queue = await newQueue('testing-async');

    @Module({
      imports: [
        WorkerManagerModule.forRootAsync({
          useFactory: () => ({
            boardOptions: { uiBasePath: uiFixtureBasePath },
            auth: { strategy: 'basic', users: [{ username: 'ops', password: 'pw' }] },
            queues: [{ queue, adapter: BullMQAdapter }],
          }),
        }),
      ],
    })
    class AppModule {}

    await start(AppModule);

    expect((await http(app!).get('/queues/api/queues')).status).toBe(401);
    const res = await http(app!).get('/queues/api/queues').set('Authorization', basic('ops', 'pw'));
    expect(res.status).toBe(200);
    expect(queueNames(res)).toEqual([queue.name]);
    expect((await http(app!).get('/queues').set('Authorization', basic('ops', 'pw'))).status).toBe(
      200
    );
  });

  it('applies queues added to the injected board before the application exists', async () => {
    const early = await newQueue('testing-early');
    const feature = await newQueue('testing-feature');

    @Injectable()
    class EarlyRegistrar {
      constructor(@Inject(WORKER_MANAGER_INSTANCE) board: WorkerManagerBoard) {
        board.addQueue(new BullMQAdapter(early));
      }
    }

    @Module({
      imports: [
        WorkerManagerModule.forRoot({
          route: '/ops',
          boardOptions: { uiBasePath: uiFixtureBasePath },
        }),
        WorkerManagerModule.forFeature({ queue: feature, adapter: BullMQAdapter }),
      ],
      providers: [EarlyRegistrar],
    })
    class AppModule {}

    const moduleRef = await start(AppModule);

    const res = await http(app!).get('/ops/api/queues');
    expect(res.status).toBe(200);
    expect(queueNames(res).sort()).toEqual([early.name, feature.name].sort());
    expect(moduleRef.get(WORKER_MANAGER_ADAPTER)).toBe(app!.get(WORKER_MANAGER_ADAPTER));
  });
});
