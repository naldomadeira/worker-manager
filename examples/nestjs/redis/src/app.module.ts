import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { WorkerManagerModule } from '@worker-manager/nestjs';
import { QueuesModule } from './queues.module';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6410),
      },
    }),
    WorkerManagerModule.forRoot({
      route: '/queues',
      title: 'NestJS + Redis',
      auth: {
        strategy: 'basic',
        users: [
          {
            username: process.env.BOARD_USERNAME ?? 'admin',
            password: process.env.BOARD_PASSWORD ?? 'admin',
          },
        ],
      },
    }),
    QueuesModule,
  ],
})
export class AppModule {}
