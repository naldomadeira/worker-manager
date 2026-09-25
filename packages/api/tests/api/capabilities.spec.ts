import { createWorkerManagerBoard } from '@worker-manager/api';
import { BullAdapter } from '@worker-manager/api/bullAdapter';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { ExpressAdapter } from '@worker-manager/express';
import Bull from 'bull';
import { Queue } from 'bullmq';
import request from 'supertest';

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: +(process.env.REDIS_PORT || 6379),
};

const BULL_CAPABILITIES = {
  pause: true,
  logs: true,
  progress: true,
  flows: false,
  promote: true,
  updateData: true,
  changeDelay: false,
  changePriority: false,
  removeUnprocessedChildren: false,
  completedRetry: false,
  globalConcurrency: false,
  globalRateLimit: false,
  nativeMetrics: true,
  workers: true,
  jobSchedulers: { update: false, run: false, kinds: ['every', 'cron'] },
  jobOptionsSchema: 'bull',
};

const BULLMQ_CAPABILITIES = {
  pause: true,
  logs: true,
  progress: true,
  flows: true,
  promote: true,
  updateData: true,
  changeDelay: true,
  changePriority: true,
  removeUnprocessedChildren: true,
  completedRetry: true,
  globalConcurrency: true,
  globalRateLimit: true,
  nativeMetrics: true,
  workers: true,
  jobSchedulers: { update: true, run: true, kinds: ['every', 'cron'] },
  jobOptionsSchema: 'bullmq',
};

async function listQueues(adapters: any[], uiConfig = {}) {
  const serverAdapter = new ExpressAdapter();
  createWorkerManagerBoard({ queues: adapters, serverAdapter, options: { uiConfig } });
  const res = await request(serverAdapter.getRouter()).get('/api/queues').expect(200);
  return res.body.queues as any[];
}

describe('queue capabilities', () => {
  let bullQueue: Bull.Queue;
  let bullmqQueue: Queue;

  beforeAll(() => {
    bullQueue = new Bull('CapabilitiesBull', { redis: connection });
    bullmqQueue = new Queue('CapabilitiesBullMQ', { connection });
  });

  afterAll(async () => {
    await bullQueue.close();
    await bullmqQueue.close();
  });

  it('reports what Bull can do', async () => {
    const [queue] = await listQueues([new BullAdapter(bullQueue)]);

    expect(queue.library).toBe('bull');
    expect(queue.datastore).toBe('redis');
    expect(queue.capabilities).toEqual(BULL_CAPABILITIES);
  });

  it('reports what BullMQ can do', async () => {
    const [queue] = await listQueues([new BullMQAdapter(bullmqQueue)]);

    expect(queue.library).toBe('bullmq');
    expect(queue.datastore).toBe('redis');
    // Probed, not versioned: the 5.56 peer floor predates Queue#setGlobalRateLimit.
    expect(queue.capabilities).toEqual({
      ...BULLMQ_CAPABILITIES,
      globalRateLimit: typeof (bullmqQueue as any).setGlobalRateLimit === 'function',
    });
  });

  it('keeps the deprecated fields in step with the capabilities', async () => {
    const queues = await listQueues([new BullAdapter(bullQueue), new BullMQAdapter(bullmqQueue)]);

    for (const queue of queues) {
      expect(queue.supportsGlobalRateLimit).toBe(queue.capabilities.globalRateLimit);
      expect(queue.capabilities.jobOptionsSchema).toBe(queue.type);
    }
  });

  it('turns workers off with showWorkers', async () => {
    const [queue] = await listQueues([new BullMQAdapter(bullmqQueue)], { showWorkers: false });

    expect(queue.capabilities.workers).toBe(false);
    expect(queue.hasWorkers).toBeNull();
  });

  it('answers a non-flow response when an adapter turns flows off', async () => {
    class NoFlowsAdapter extends BullMQAdapter {
      public override getCapabilities() {
        return { ...super.getCapabilities(), flows: false };
      }
    }
    const job = await bullmqQueue.add('lonely', {});
    const serverAdapter = new ExpressAdapter();
    createWorkerManagerBoard({ queues: [new NoFlowsAdapter(bullmqQueue)], serverAdapter });

    const res = await request(serverAdapter.getRouter())
      .get(`/api/queues/CapabilitiesBullMQ/${job.id}/flow`)
      .expect(200);

    expect(res.body).toEqual({ nodeId: job.id, isFlowNode: false, flowRoot: null });
    await job.remove();
  });
});
