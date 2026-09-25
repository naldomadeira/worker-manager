import { createWorkerManagerBoard } from '@worker-manager/api';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { ExpressAdapter } from '@worker-manager/express';
import { Queue } from 'bullmq';
import request from 'supertest';
import {
  assertResolvedMajor,
  destroyQueue,
  EXPECTED_MAJOR,
  isV6,
  makeQueue,
  uniqueName,
} from './helpers';

const EXPECTED = {
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

async function listed(queue: Queue) {
  const serverAdapter = new ExpressAdapter();
  createWorkerManagerBoard({ queues: [new BullMQAdapter(queue)], serverAdapter });
  const res = await request(serverAdapter.getRouter()).get('/api/queues').expect(200);
  return res.body.queues[0];
}

describe(`capabilities on bullmq@${EXPECTED_MAJOR}`, () => {
  assertResolvedMajor();

  let queue: Queue;

  beforeEach(async () => {
    queue = await makeQueue('capabilities');
  });

  afterEach(() => destroyQueue(queue));

  it('reports the same capabilities on Redis in both majors', async () => {
    const body = await listed(queue);

    expect(body.library).toBe('bullmq');
    expect(body.datastore).toBe('redis');
    expect(body.capabilities).toEqual(EXPECTED);
  });
});

const POSTGRES_URL = process.env.POSTGRES_URL;

if (!isV6() || !POSTGRES_URL) {
  describe.skip(`capabilities on PostgreSQL (skipped: ${isV6() ? 'POSTGRES_URL is not set' : `bullmq@${EXPECTED_MAJOR} has no pluggable backends`})`, () => {
    it('needs bullmq@6 and POSTGRES_URL', () => undefined);
  });
} else {
  describe(`capabilities on PostgreSQL with bullmq@${EXPECTED_MAJOR}`, () => {
    let queue: Queue;

    beforeEach(async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createPostgresBackend } = require('bullmq');
      queue = new Queue(
        uniqueName('pg-capabilities'),
        { connection: POSTGRES_URL } as any,
        createPostgresBackend
      );
      await queue.waitUntilReady();
    });

    afterEach(async () => {
      await queue?.obliterate({ force: true }).catch(() => undefined);
      await queue?.close();
    });

    it('reports postgres as the datastore and keeps every capability', async () => {
      const body = await listed(queue);

      expect(body.datastore).toBe('postgres');
      expect(body.capabilities).toEqual(EXPECTED);
    });
  });
}
