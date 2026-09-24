import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import type { Worker } from 'bullmq';
import { config } from '../config';
import { closeQueues, postgresQueues, redisFlowProducer, redisQueues } from './queues';
import { startWorkers } from './workers';

const pick = <T>(items: T[]) => items[Math.floor(Math.random() * items.length)];
const CUSTOMERS = ['acme', 'globex', 'initech', 'umbrella', 'hooli', 'stark'];

/**
 * Keeps the board busy: workers consume every queue, and a timer feeds them a mix of plain,
 * delayed, prioritised and flow jobs, plus a couple of job schedulers. Turn it off with
 * WM_TRAFFIC=false to inspect a frozen board.
 */
@Injectable()
export class TrafficService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Traffic');
  private workers: Worker[] = [];
  private timer?: NodeJS.Timeout;

  async onApplicationBootstrap() {
    await this.ensureSchedulers();

    if (!config.traffic) {
      this.logger.log('Synthetic traffic disabled (WM_TRAFFIC=false)');
      return;
    }

    this.workers = startWorkers();
    this.timer = setInterval(() => this.tick().catch((err) => this.logger.warn(err.message)), 900);
    this.logger.log(`Producing traffic on ${this.workers.length} queues`);
  }

  async onApplicationShutdown() {
    clearInterval(this.timer);
    await Promise.all(this.workers.map((worker) => worker.close()));
    await closeQueues();
  }

  private async ensureSchedulers() {
    await redisQueues.reports.upsertJobScheduler(
      'nightly-sales-report',
      { pattern: '0 3 * * *' },
      { name: 'sales-report', data: { range: 'yesterday' } }
    );
    await redisQueues.emails.upsertJobScheduler(
      'digest-every-minute',
      { every: 60_000 },
      { name: 'digest', data: { audience: 'subscribers' } }
    );
  }

  private async tick() {
    const customer = pick(CUSTOMERS);
    const roll = Math.random();

    await redisQueues.emails.add('welcome-email', {
      to: `${customer}@example.com`,
      template: 'welcome',
    });

    if (roll < 0.6) {
      await redisQueues.charges.add(
        'charge-card',
        { customer, amount: Math.round(Math.random() * 50000) / 100, currency: 'BRL' },
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 } }
      );
    }
    if (roll < 0.3) {
      await redisQueues.sms.add(
        'otp',
        { phone: '+55 11 9' + Math.floor(Math.random() * 1e8) },
        { priority: 1 }
      );
    }
    if (roll < 0.15) {
      await redisQueues.refunds.add('refund', { customer }, { delay: 15_000 });
    }
    if (roll < 0.1) {
      await redisQueues.reports.add('adhoc-report', {
        customer,
        rows: Math.floor(Math.random() * 1e5),
      });
    }
    if (roll < 0.08) {
      await redisFlowProducer.add({
        name: 'ship-order',
        queueName: redisQueues.orders.name,
        data: { customer },
        children: [
          { name: 'reserve-stock', queueName: redisQueues.orders.name, data: { customer } },
          { name: 'charge-order', queueName: redisQueues.charges.name, data: { customer } },
          { name: 'send-confirmation', queueName: redisQueues.emails.name, data: { customer } },
        ],
      });
    }

    if (postgresQueues.invoices && roll < 0.5) {
      await postgresQueues.invoices.add('issue-invoice', {
        customer,
        total: Math.round(Math.random() * 1e5) / 100,
      });
    }
    if (postgresQueues.exports && roll < 0.12) {
      await postgresQueues.exports.add('export-csv', {
        customer,
        table: pick(['orders', 'invoices', 'users']),
      });
    }
  }
}
