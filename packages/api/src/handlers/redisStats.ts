import { parse as parseRedisInfo } from 'redis-info';
import { DATASTORES } from '../constants/datastores';
import { errorResponse } from '../errors';
import { BaseAdapter } from '../queueAdapters/base';
import { GetRedisStatsResponse } from '../schemas/responses';
import { WorkerManagerRequest, ControllerHandlerReturnType, RedisStats } from '../types';

async function getStats(queue: BaseAdapter): Promise<RedisStats | null> {
  const redisInfoRaw = await queue.getRedisInfo();

  // No `INFO` means the queue is not on Redis, which only BullMQ v6 can manage. Its own
  // datastore answers a smaller set of the same questions.
  if (redisInfoRaw === null) {
    return queue.getDatastoreStats();
  }

  const redisInfo = parseRedisInfo(redisInfoRaw);

  return {
    backend: DATASTORES.redis,
    version: redisInfo.redis_version,
    mode: redisInfo.redis_mode,
    port: +redisInfo.tcp_port,
    os: redisInfo.os,
    uptime: +redisInfo.uptime_in_seconds,
    memory: {
      total: +redisInfo.maxmemory || +redisInfo.total_system_memory,
      used: +redisInfo.used_memory,
      fragmentationRatio: +redisInfo.mem_fragmentation_ratio,
      peak: +redisInfo.used_memory_peak,
    },
    clients: {
      connected: +redisInfo.connected_clients,
      blocked: +redisInfo.blocked_clients,
    },
  };
}

async function firstVisibleQueue(
  queues: Iterable<BaseAdapter>,
  req: WorkerManagerRequest
): Promise<BaseAdapter | null> {
  for (const queue of queues) {
    if (await queue.isVisible(req)) {
      return queue;
    }
  }
  return null;
}

export async function redisStatsHandler(
  req: WorkerManagerRequest
): Promise<ControllerHandlerReturnType<GetRedisStatsResponse>> {
  const { queues: workerManagerQueues, uiConfig } = req;

  if (uiConfig.hideRedisDetails) {
    return errorResponse(403, 'ERRORS.FORBIDDEN');
  }

  if (workerManagerQueues.size === 0) {
    return { body: {} };
  }

  const queue = await firstVisibleQueue(workerManagerQueues.values(), req);

  // Every queue is hidden from this request, so there is no datastore it may ask about.
  if (!queue) {
    return errorResponse(404, 'ERRORS.QUEUE_NOT_FOUND');
  }

  const body = await getStats(queue);

  // A datastore that is neither Redis nor one we can question.
  if (body === null) {
    return errorResponse(404, 'ERRORS.REDIS_STATS_UNAVAILABLE');
  }

  return {
    body,
  };
}
