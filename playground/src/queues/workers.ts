import { createPostgresBackend, Job, Worker } from 'bullmq';
import { allQueues, postgresConnection, postgresQueueNames, redisConnection } from './queues';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const random = (min: number, max: number) => Math.round(min + Math.random() * (max - min));

/** Failure rate per queue, so the board shows a believable mix of outcomes. */
const FAILURE_RATE: Record<string, number> = {
  'payments.charge': 0.18,
  'payments.refund': 0.08,
  'notifications.sms': 0.12,
  'reports.generate': 0.05,
  'pg.data-exports': 0.1,
};

async function process(job: Job) {
  const steps = random(3, 8);
  await job.log(`Started ${job.name} (${steps} steps)`);

  for (let step = 1; step <= steps; step++) {
    await sleep(random(150, 700));
    await job.updateProgress(Math.round((step / steps) * 100));
    await job.log(`Step ${step}/${steps} done`);
  }

  if (Math.random() < (FAILURE_RATE[job.queueName] ?? 0.03)) {
    throw new Error(
      `${job.queueName}: upstream service answered 503 on attempt ${job.attemptsMade + 1}`
    );
  }

  return { ok: true, processedAt: new Date().toISOString(), steps };
}

export function startWorkers(): Worker[] {
  return allQueues.map((queue) => {
    const concurrency = queue.name.startsWith('reports') ? 2 : 5;

    if (postgresQueueNames.has(queue.name)) {
      return new Worker(
        queue.name,
        process,
        { connection: postgresConnection(), concurrency } as any,
        createPostgresBackend as any
      );
    }

    return new Worker(queue.name, process, { connection: redisConnection(), concurrency });
  });
}
