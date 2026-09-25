import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import type { Job } from 'pg-boss';
import { config } from '../config';
import { pgBoss, pgBossQueueNames, pgBossQueues } from './pgboss';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const random = (min: number, max: number) => Math.round(min + Math.random() * (max - min));
const pick = <T>(items: T[]) => items[Math.floor(Math.random() * items.length)];
const CUSTOMERS = ['acme', 'globex', 'initech', 'umbrella', 'hooli', 'stark'];

/** Failure rate per queue. Retries come from each queue's `retryLimit`. */
const FAILURE_RATE: Record<string, number> = {
  [pgBossQueueNames.emails]: 0.15,
  [pgBossQueueNames.reports]: 0.1,
  [pgBossQueueNames.sync]: 0.2,
  [pgBossQueueNames.payments]: 0.45,
};

/** How long a job of each queue takes, in milliseconds. */
const LATENCY: Record<string, [number, number]> = {
  [pgBossQueueNames.emails]: [200, 900],
  [pgBossQueueNames.reports]: [3000, 6000],
  [pgBossQueueNames.sync]: [800, 2500],
  [pgBossQueueNames.payments]: [300, 1200],
};

/**
 * Starts the pg-boss instance, creates the queues and the two schedules (a cron expression and
 * an RFC 5545 recurrence rule), and, unless WM_TRAFFIC=false, runs workers that complete, fail
 * and retry plus a timer that keeps sending jobs. The dead letter queue has no worker, so what
 * lands there stays visible.
 */
@Injectable()
export class PgBossService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('PgBoss');
  private timer?: NodeJS.Timeout;

  async onModuleInit() {
    const boss = pgBoss;
    if (!boss) return;

    boss.on('error', (error) => this.logger.warn(error.message));
    await boss.start();

    for (const { name, ...options } of pgBossQueues) {
      if (!(await boss.getQueue(name))) await boss.createQueue(name, options);
    }

    await boss.schedule(
      pgBossQueueNames.reports,
      '*/2 * * * *',
      { report: 'sales', range: 'last-2-minutes' },
      { key: 'sales-every-2-minutes', tz: 'UTC' }
    );
    await boss.schedule(
      pgBossQueueNames.emails,
      'FREQ=MINUTELY;INTERVAL=3',
      { template: 'digest', audience: 'subscribers' },
      { key: 'digest-rrule', tz: 'UTC' }
    );

    if (!config.traffic) {
      this.logger.log('pg-boss traffic disabled (WM_TRAFFIC=false)');
      return;
    }

    for (const { name } of pgBossQueues) {
      if (name === pgBossQueueNames.deadLetter) continue;
      const localConcurrency = name === pgBossQueueNames.reports ? 1 : 3;
      await boss.work(name, { pollingIntervalSeconds: 1, localConcurrency }, (jobs) =>
        this.process(jobs)
      );
    }
    this.timer = setInterval(() => this.tick().catch((err) => this.logger.warn(err.message)), 1500);
    this.logger.log(`Producing pg-boss traffic on ${pgBossQueues.length - 1} queues`);
  }

  async onApplicationShutdown() {
    clearInterval(this.timer);
    await pgBoss?.stop({ graceful: true, timeout: 5000 });
  }

  private async process(jobs: Job<unknown>[]) {
    for (const job of jobs) {
      const [min, max] = LATENCY[job.name] ?? [200, 800];
      await sleep(random(min, max));
      if (Math.random() < (FAILURE_RATE[job.name] ?? 0.05)) {
        throw new Error(`${job.name}: upstream service answered 503`);
      }
    }
    return { ok: true, processedAt: new Date().toISOString() };
  }

  private async tick() {
    const boss = pgBoss!;
    const customer = pick(CUSTOMERS);
    const roll = Math.random();

    await boss.send(pgBossQueueNames.emails, {
      to: `${customer}@example.com`,
      template: 'welcome',
    });

    if (roll < 0.5) {
      await boss.send(
        pgBossQueueNames.payments,
        { customer, amount: Math.round(Math.random() * 50000) / 100, currency: 'BRL' },
        { priority: roll < 0.1 ? 10 : 0 }
      );
    }
    // Stately: one job per state per key, so most of these are dropped by pg-boss on purpose.
    if (roll < 0.4) {
      await boss.send(pgBossQueueNames.sync, { customer }, { singletonKey: customer });
    }
    if (roll < 0.08) {
      await boss.send(pgBossQueueNames.reports, { report: 'adhoc', customer });
    }
    if (roll < 0.1) {
      await boss.send(
        pgBossQueueNames.emails,
        { to: `${customer}@example.com`, template: 'reminder' },
        { startAfter: 60 }
      );
    }
  }
}
