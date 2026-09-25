import { createWorkerManagerBoard } from '@worker-manager/api';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { ExpressAdapter } from '@worker-manager/express';
import { Queue } from 'bullmq';
import request from 'supertest';

describe('Redis stats', () => {
  const connection = {
    host: process.env.REDIS_HOST || 'localhost',
    port: +(process.env.REDIS_PORT || 6379),
  };

  let queue: Queue;

  beforeEach(async () => {
    queue = new Queue('StatsQueue', { connection });
    await queue.waitUntilReady();
  });

  afterEach(async () => {
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
  });

  function setupBoard(adapter: BullMQAdapter) {
    const serverAdapter = new ExpressAdapter();
    createWorkerManagerBoard({ queues: [adapter], serverAdapter });
    return request(serverAdapter.getRouter());
  }

  it('labels a redis-backed queue as such', async () => {
    const res = await setupBoard(new BullMQAdapter(queue)).get('/api/redis/stats').expect(200);

    expect(res.body.backend).toBe('redis');
    expect(res.body.memory.used).toEqual(expect.any(Number));
  });

  it('answers with a translatable error when the datastore can say nothing', async () => {
    // No real backend behaves this way today: BullMQ v6 on PostgreSQL reports its own stats,
    // and everything else is Redis. This covers whatever datastore BullMQ adds next.
    const adapter = new BullMQAdapter(queue);
    jest.spyOn(adapter, 'getRedisInfo').mockResolvedValue(null);
    jest.spyOn(adapter, 'getDatastoreStats').mockResolvedValue(null);

    const res = await setupBoard(adapter).get('/api/redis/stats').expect(404);

    expect(res.body.error).toEqual({ key: 'ERRORS.REDIS_STATS_UNAVAILABLE' });
  });

  it('asks the first queue the request may see', async () => {
    const other = new Queue('StatsVisibleQueue', { connection });
    const hidden = new BullMQAdapter(queue);
    hidden.setVisibilityGuard(() => false);
    const hiddenInfo = jest.spyOn(hidden, 'getRedisInfo');
    const visible = new BullMQAdapter(other);
    const visibleInfo = jest.spyOn(visible, 'getRedisInfo');

    try {
      const serverAdapter = new ExpressAdapter();
      createWorkerManagerBoard({ queues: [hidden, visible], serverAdapter });

      const res = await request(serverAdapter.getRouter()).get('/api/redis/stats').expect(200);

      expect(res.body.backend).toBe('redis');
      expect(hiddenInfo).not.toHaveBeenCalled();
      expect(visibleInfo).toHaveBeenCalledTimes(1);
    } finally {
      await other.obliterate({ force: true }).catch(() => undefined);
      await other.close();
    }
  });

  it('reports no queue when every queue is hidden from the request', async () => {
    const adapter = new BullMQAdapter(queue);
    adapter.setVisibilityGuard(() => false);

    const res = await setupBoard(adapter).get('/api/redis/stats').expect(404);

    expect(res.body.error).toEqual({ key: 'ERRORS.QUEUE_NOT_FOUND' });
  });
});
