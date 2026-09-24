import { createWorkerManagerBoard } from '@worker-manager/api';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { ExpressAdapter } from '@worker-manager/express';
import { Queue } from 'bullmq';
import request from 'supertest';

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: +(process.env.REDIS_PORT || 6379),
};

async function fetchJobDataSchema(serverAdapter: ExpressAdapter, queueName: string) {
  const res = await request(serverAdapter.getRouter())
    .get(`/api/queues/${encodeURIComponent(queueName)}/job-data-schema`)
    .expect(200);
  return JSON.parse(res.text);
}

describe('Job data schema', () => {
  let serverAdapter: ExpressAdapter;
  let queue: Queue;

  beforeEach(() => {
    serverAdapter = new ExpressAdapter();
  });

  afterEach(async () => {
    await queue.obliterate({ force: true }).catch(() => {});
    await queue.close();
  });

  it('exposes the configured job data schema on a dedicated endpoint', async () => {
    const jobDataSchema = {
      type: 'object',
      properties: {
        make: { type: 'string' },
        model: { type: 'string' },
      },
      required: ['make', 'model'],
    };
    queue = new Queue('WithSchema', { connection });
    createWorkerManagerBoard({
      queues: [new BullMQAdapter(queue, { jobDataSchema })],
      serverAdapter,
    });

    expect(await fetchJobDataSchema(serverAdapter, 'WithSchema')).toEqual(jobDataSchema);
  });

  it('returns an empty object when the queue does not configure a schema', async () => {
    queue = new Queue('NoSchema', { connection });
    createWorkerManagerBoard({ queues: [new BullMQAdapter(queue)], serverAdapter });

    expect(await fetchJobDataSchema(serverAdapter, 'NoSchema')).toEqual({});
  });

  it('keeps the schema out of the polled queues list', async () => {
    const jobDataSchema = { type: 'object', properties: { make: { type: 'string' } } };
    queue = new Queue('WithSchema', { connection });
    createWorkerManagerBoard({
      queues: [new BullMQAdapter(queue, { jobDataSchema })],
      serverAdapter,
    });

    const res = await request(serverAdapter.getRouter()).get('/api/queues').expect(200);
    const serialized = JSON.parse(res.text).queues.find((q: any) => q.name === 'WithSchema');
    expect(serialized.jobDataSchema).toBeUndefined();
  });
});
