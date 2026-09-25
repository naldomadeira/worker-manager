import { createWorkerManagerBoard } from '@worker-manager/api';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { ExpressAdapter } from '@worker-manager/express';
import { Queue } from 'bullmq';
import request from 'supertest';

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: +(process.env.REDIS_PORT || 6379),
};

describe('queue names with URI-reserved characters', () => {
  const queueName = `Discount-100%-${process.env.JEST_WORKER_ID}`;
  let serverAdapter: ExpressAdapter;
  let queue: Queue;

  beforeEach(async () => {
    serverAdapter = new ExpressAdapter();
    queue = new Queue(queueName, { connection });
    await queue.obliterate({ force: true }).catch(() => undefined);
  });

  afterEach(async () => {
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
  });

  function setupBoard() {
    createWorkerManagerBoard({ queues: [new BullMQAdapter(queue)], serverAdapter });
    return request(serverAdapter.getRouter());
  }

  it('lists the queue and its jobs when it is the active queue', async () => {
    await queue.add('job', {});
    const agent = setupBoard();

    const res = await agent.get('/api/queues').query({ activeQueue: queueName }).expect(200);

    expect(res.body.queues).toHaveLength(1);
    expect(res.body.queues[0].name).toBe(queueName);
    expect(res.body.queues[0].jobs).toHaveLength(1);
  });

  it('filters job schedulers by the queue name', async () => {
    await queue.upsertJobScheduler('every-minute', { every: 60_000 }, { name: 'tick' });
    const agent = setupBoard();

    const res = await agent.get('/api/job-schedulers').query({ queueName }).expect(200);

    expect(res.body.schedulers).toHaveLength(1);
    expect(res.body.schedulers[0].queueName).toBe(queueName);
  });
});
