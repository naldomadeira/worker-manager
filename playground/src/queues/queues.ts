import { createPostgresBackend, FlowProducer, Queue } from 'bullmq';
import { config } from '../config';

/**
 * Every queue the playground shows, created at import time so the NestJS module can register
 * them statically. Names use `.` as a delimiter so the board's grouped overview has something
 * to group.
 */
export function redisConnection() {
  const url = new URL(config.redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined,
  };
}

const redis = () => ({ connection: redisConnection() });

export const redisQueues = {
  emails: new Queue('notifications.emails', redis()),
  sms: new Queue('notifications.sms', redis()),
  reports: new Queue('reports.generate', redis()),
  charges: new Queue('payments.charge', redis()),
  refunds: new Queue('payments.refund', redis()),
  orders: new Queue('orders.pipeline', redis()),
};

export const redisFlowProducer = new FlowProducer(redis());

/** Queue names whose data lives in PostgreSQL, so workers and producers pick the right backend. */
export const postgresQueueNames = new Set<string>();

/** `migrate: true` lets BullMQ create its schema on first connect, so a fresh database works. */
export const postgresConnection = () => ({ connectionString: config.postgresUrl, migrate: true });

function postgresQueue(name: string) {
  postgresQueueNames.add(name);
  // BullMQ v6 takes the backend as a factory; the connection is then the Postgres URL.
  return new Queue(name, { connection: postgresConnection() } as any, createPostgresBackend);
}

/** BullMQ v6 queues stored in PostgreSQL. Empty when POSTGRES_URL is not set. */
export const postgresQueues = config.postgresUrl
  ? {
      invoices: postgresQueue('pg.invoices'),
      exports: postgresQueue('pg.data-exports'),
    }
  : {};

export const allQueues: Queue[] = [...Object.values(redisQueues), ...Object.values(postgresQueues)];

export async function closeQueues() {
  await redisFlowProducer.close();
  await Promise.all(allQueues.map((queue) => queue.close()));
}
