import { BullModule, InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { WorkerManagerModule } from '@worker-manager/nestjs';
import { Job, Queue } from 'bullmq';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Processor('emails')
export class EmailsProcessor extends WorkerHost {
  async process(job: Job<{ to: string }>) {
    await sleep(500);
    return { sent: job.data.to };
  }
}

@Processor('reports')
export class ReportsProcessor extends WorkerHost {
  async process(job: Job<{ month: number }>) {
    for (let step = 1; step <= 4; step++) {
      await sleep(500);
      await job.updateProgress(step * 25);
    }
    if (Math.random() < 0.2) throw new Error('Report generation failed');
    return { month: job.data.month };
  }
}

@Injectable()
export class JobProducer implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout;

  constructor(
    @InjectQueue('emails') private readonly emails: Queue,
    @InjectQueue('reports') private readonly reports: Queue
  ) {}

  onModuleInit() {
    this.timer = setInterval(async () => {
      await this.emails.add('welcome', { to: `user${Date.now() % 1000}@example.com` });
      await this.reports.add('monthly', { month: new Date().getMonth() + 1 });
    }, 3000);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }
}

@Module({
  imports: [
    BullModule.registerQueue({ name: 'emails' }, { name: 'reports' }),
    WorkerManagerModule.forFeature(
      { name: 'emails', adapter: BullMQAdapter },
      { name: 'reports', adapter: BullMQAdapter }
    ),
  ],
  providers: [EmailsProcessor, ReportsProcessor, JobProducer],
})
export class QueuesModule {}
