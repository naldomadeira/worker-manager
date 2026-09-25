import { createWorkerManagerBoard } from '@worker-manager/api';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { ExpressAdapter } from '@worker-manager/express';
import type { Queue } from 'bullmq';
import { FlowProducer as FlowProducerV6, Queue as QueueV6 } from 'bullmq-v6';
import request from 'supertest';

// The adapter is compiled against whichever `bullmq` this package resolves (v5 in the default
// project, the floor in its replay), while the queues below come from bullmq@6. That is what a
// consumer gets with two majors installed, or a workspace link resolving the adapter's own copy,
// and the flow producer used to die on it with "Connection is not a constructor".
describe('Job flow across bullmq majors', () => {
  const connection = {
    host: process.env.REDIS_HOST || 'localhost',
    port: +(process.env.REDIS_PORT || 6379),
  };

  let run = 0;
  const parentName = () => `MixedFlowParent-${process.env.JEST_WORKER_ID}-${run}`;
  const childName = () => `MixedFlowChild-${process.env.JEST_WORKER_ID}-${run}`;

  let serverAdapter: ExpressAdapter;
  let parentQueue: QueueV6;
  let childQueue: QueueV6;
  let flowProducer: FlowProducerV6;

  beforeEach(async () => {
    run += 1;
    serverAdapter = new ExpressAdapter();
    parentQueue = new QueueV6(parentName(), { connection });
    childQueue = new QueueV6(childName(), { connection });
    flowProducer = new FlowProducerV6({ connection });
    await parentQueue.obliterate({ force: true }).catch(() => {});
    await childQueue.obliterate({ force: true }).catch(() => {});
  });

  afterEach(async () => {
    await parentQueue.obliterate({ force: true }).catch(() => {});
    await childQueue.obliterate({ force: true }).catch(() => {});
    await flowProducer.close();
    await parentQueue.close();
    await childQueue.close();
  });

  it('resolves the flow tree of a bullmq@6 queue through the bullmq this package resolved', async () => {
    const tree = await flowProducer.add({
      name: 'root',
      queueName: parentQueue.name,
      children: [{ name: 'leaf', queueName: childQueue.name, data: {} }],
    });

    createWorkerManagerBoard({
      queues: [
        new BullMQAdapter(parentQueue as unknown as Queue),
        new BullMQAdapter(childQueue as unknown as Queue),
      ],
      serverAdapter,
    });

    const childJobId = tree.children![0].job.id;
    const res = await request(serverAdapter.getRouter())
      .get(`/api/queues/${childQueue.name}/${childJobId}/flow`)
      .expect(200);

    expect(res.body.isFlowNode).toBe(true);
    expect(res.body.flowRoot.id).toBe(tree.job.id);
    expect(res.body.flowRoot.children).toHaveLength(1);
    expect(res.body.flowRoot.children[0].name).toBe('leaf');
  });
});
