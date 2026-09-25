import { Module } from '@nestjs/common';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { WorkerManagerModule } from '@worker-manager/nestjs';
import { JobsService, invoices, notifications } from './queues';

@Module({
  imports: [
    WorkerManagerModule.forRoot({
      route: '/queues',
      title: 'NestJS + PostgreSQL',
      auth: {
        strategy: 'basic',
        users: [
          {
            username: process.env.BOARD_USERNAME ?? 'admin',
            password: process.env.BOARD_PASSWORD ?? 'admin',
          },
        ],
      },
      queues: [
        { queue: invoices, adapter: BullMQAdapter },
        { queue: notifications, adapter: BullMQAdapter },
      ],
    }),
  ],
  providers: [JobsService],
})
export class AppModule {}
