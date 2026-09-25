import fastifyCookie from '@fastify/cookie';
import secureSession from '@fastify/secure-session';
import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { createWorkerManagerBoard } from '@worker-manager/api';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { FastifyAdapter } from '@worker-manager/fastify';
import { Queue } from 'bullmq';
import { FastifyInstance } from 'fastify';
import { InjectTestQueue, TEST_QUEUE_NAME, TestProcessor } from './test.processor';

@Module({
  imports: [ConfigModule],
})
export class QueueModule implements NestModule {
  static register(): DynamicModule {
    const testQueue = BullModule.registerQueue({
      name: TEST_QUEUE_NAME,
    });

    if (!testQueue.providers || !testQueue.exports) {
      throw new Error('Unable to build queue');
    }

    return {
      module: QueueModule,
      imports: [
        BullModule.forRoot({
          connection: {
            host: 'localhost',
            port: 15610,
          },
          defaultJobOptions: {
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 1000,
            },
          },
        }),
        testQueue,
      ],
      providers: [TestProcessor, ...testQueue.providers],
      exports: [...testQueue.exports],
    };
  }

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    @InjectTestQueue() private readonly testQueue: Queue
  ) {}

  configure() {
    const WORKER_MANAGER_PAGE_PATH = '/queues';
    const serverAdapter = new FastifyAdapter();
    serverAdapter.setBasePath(WORKER_MANAGER_PAGE_PATH);

    createWorkerManagerBoard({
      queues: [new BullMQAdapter(this.testQueue)],
      serverAdapter,
    });

    const fastify: FastifyInstance = this.adapterHost.httpAdapter.getInstance();

    fastify.register(fastifyCookie);

    (fastify as any).register(secureSession, {
      secret: process.env.WORKER_MANAGER_SESSION_SECRET,
      cookieName: 'session-cookie',
      cookie: {
        path: '/',
        maxAge: 604800, // 7 days
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
      },
    });

    // Apply preHandler middleware only to the prefix routes
    fastify.register(
      (instance) => {
        instance.addHook('preHandler', (req, res, next) => {
          if (!req.session.get('sev-data')) {
            return res.redirect('/login');
          }
          next();
        });
        instance.register(serverAdapter.registerPlugin());
      },
      { prefix: WORKER_MANAGER_PAGE_PATH }
    );
  }
}
