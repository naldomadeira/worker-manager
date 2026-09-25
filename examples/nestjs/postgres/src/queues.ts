import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Queue, Worker, createPostgresBackend } from 'bullmq';

const connection = {
  connectionString: process.env.POSTGRES_URL ?? 'postgres://bullmq:bullmq@localhost:5450/bullmq',
  migrate: true,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const invoices = new Queue('invoices', { connection }, createPostgresBackend);
export const notifications = new Queue('notifications', { connection }, createPostgresBackend);

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout;
  private readonly workers = [
    new Worker(
      'invoices',
      async (job: Job<{ amount: number }>) => {
        await sleep(1000);
        if (job.data.amount > 900) throw new Error('Amount needs manual approval');
        return { paid: job.data.amount };
      },
      { connection },
      createPostgresBackend
    ),
    new Worker(
      'notifications',
      async (job: Job<{ channel: string }>) => {
        await sleep(300);
        return { delivered: job.data.channel };
      },
      { connection },
      createPostgresBackend
    ),
  ];

  onModuleInit() {
    this.timer = setInterval(async () => {
      await invoices.add('charge', { amount: Math.floor(Math.random() * 1000) });
      await notifications.add('push', { channel: Math.random() < 0.5 ? 'sms' : 'email' });
    }, 3000);
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await Promise.all(this.workers.map((worker) => worker.close()));
    await Promise.all([invoices.close(), notifications.close()]);
  }
}
