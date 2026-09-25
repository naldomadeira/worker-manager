import { createWorkerManagerBoard } from '@worker-manager/api';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { ExpressAdapter } from '@worker-manager/express';
import { type ConnectionOptions, FlowProducer, Queue } from 'bullmq';
import IORedis from 'ioredis';
import request from 'supertest';

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: +(process.env.REDIS_PORT || 6379),
};

// Regression test for https://github.com/felixmosh/bull-board/issues/1229
describe('queues with the same name but a different prefix', () => {
  let serverAdapter: ExpressAdapter;
  const queueList: Queue[] = [];

  beforeEach(() => {
    serverAdapter = new ExpressAdapter();
    queueList.length = 0;
  });

  afterEach(async () => {
    for (const queue of queueList) {
      await queue.close();
    }
  });

  it('keeps both queues as distinct board entries', async () => {
    const emailsTenantA = new Queue('emails', { connection, prefix: 'tenant-a' });
    const emailsTenantB = new Queue('emails', { connection, prefix: 'tenant-b' });
    queueList.push(emailsTenantA, emailsTenantB);

    createWorkerManagerBoard({
      queues: [
        new BullMQAdapter(emailsTenantA, { prefix: 'tenant-a:' }),
        new BullMQAdapter(emailsTenantB, { prefix: 'tenant-b:' }),
      ],
      serverAdapter,
    });

    await request(serverAdapter.getRouter())
      .get('/api/queues')
      .expect('Content-Type', /json/)
      .expect(200)
      .then((res) => {
        const respQueues = JSON.parse(res.text).queues as Array<{ name: string }>;
        const names = respQueues.map((queue) => queue.name).sort();

        expect(names).toEqual(['tenant-a:emails', 'tenant-b:emails']);
      });
  });

  it("reads flows through each queue's own prefix when both share one connection", async () => {
    const client = new IORedis({ ...connection, maxRetriesPerRequest: null });
    const shared = client as unknown as ConnectionOptions;
    const run = `${process.env.JEST_WORKER_ID}-${Date.now()}`;
    const defaultQueue = new Queue(`prefix-flow-default-${run}`, { connection: shared });
    const tenantQueue = new Queue(`prefix-flow-tenant-${run}`, {
      connection: shared,
      prefix: 'tenant-b',
    });
    const defaultFlow = new FlowProducer({ connection: shared });
    const tenantFlow = new FlowProducer({ connection: shared, prefix: 'tenant-b' });

    try {
      const defaultTree = await defaultFlow.add({
        name: 'root',
        queueName: defaultQueue.name,
        children: [{ name: 'leaf', queueName: defaultQueue.name, data: {} }],
      });
      const tenantTree = await tenantFlow.add({
        name: 'root',
        queueName: tenantQueue.name,
        children: [{ name: 'leaf', queueName: tenantQueue.name, data: {} }],
      });

      createWorkerManagerBoard({
        queues: [
          new BullMQAdapter(defaultQueue),
          new BullMQAdapter(tenantQueue, { prefix: 'tenant-b:' }),
        ],
        serverAdapter,
      });
      const router = request(serverAdapter.getRouter());

      const first = await router
        .get(`/api/queues/${defaultQueue.name}/${defaultTree.job.id}/flow`)
        .expect(200);
      expect(first.body.flowRoot.children[0].id).toBe(defaultTree.children![0].job.id);

      const second = await router
        .get(`/api/queues/tenant-b:${tenantQueue.name}/${tenantTree.job.id}/flow`)
        .expect(200);
      expect(second.body.flowRoot.id).toBe(tenantTree.job.id);
      expect(second.body.flowRoot.queueName).toBe(`tenant-b:${tenantQueue.name}`);
      expect(second.body.flowRoot.children[0].id).toBe(tenantTree.children![0].job.id);
    } finally {
      await defaultQueue.obliterate({ force: true }).catch(() => undefined);
      await tenantQueue.obliterate({ force: true }).catch(() => undefined);
      await defaultFlow.close();
      await tenantFlow.close();
      await defaultQueue.close();
      await tenantQueue.close();
      await client.quit();
    }
  });
});
