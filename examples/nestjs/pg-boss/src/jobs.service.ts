import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Job } from 'pg-boss';
import { boss } from './boss';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout;

  async onModuleInit() {
    await boss.createQueue('invoices', { retryLimit: 1 });
    await boss.createQueue('notifications');

    await boss.work('invoices', async ([job]: Job<{ amount: number }>[]) => {
      await sleep(1000);
      if (job.data.amount > 900) throw new Error('Amount needs manual approval');
      return { paid: job.data.amount };
    });
    await boss.work('notifications', async ([job]: Job<{ channel: string }>[]) => {
      await sleep(300);
      return { delivered: job.data.channel };
    });

    await boss.schedule('notifications', '* * * * *', { channel: 'digest' });

    this.timer = setInterval(async () => {
      await boss.send('invoices', { amount: Math.floor(Math.random() * 1000) });
      await boss.send('notifications', { channel: Math.random() < 0.5 ? 'sms' : 'email' });
    }, 3000);
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await boss.stop({ graceful: true });
  }
}
