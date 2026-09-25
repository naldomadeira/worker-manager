import { PgBoss, type Queue } from 'pg-boss';
import { config } from '../config';

export const PGBOSS_SCHEMA = 'pgboss';

/**
 * The pg-boss queues, one per queue policy the board has to render, plus the dead letter queue
 * that `payments.capture` hands its exhausted jobs to. Names use `.` like the BullMQ side, and the
 * board groups them on it.
 */
export const pgBossQueueNames = {
  emails: 'mail.send',
  reports: 'reports.nightly',
  sync: 'billing.sync',
  payments: 'payments.capture',
  deadLetter: 'payments.dead-letter',
} as const;

/** Created in this order, so the dead letter queue exists before the queue that points at it. */
export const pgBossQueues: Array<Omit<Queue, 'name'> & { name: string }> = [
  { name: pgBossQueueNames.deadLetter, policy: 'standard' },
  {
    name: pgBossQueueNames.emails,
    policy: 'standard',
    retryLimit: 3,
    retryDelay: 2,
    retryBackoff: true,
  },
  { name: pgBossQueueNames.reports, policy: 'singleton', retryLimit: 1, retryDelay: 5 },
  { name: pgBossQueueNames.sync, policy: 'stately', retryLimit: 2, retryDelay: 3 },
  {
    name: pgBossQueueNames.payments,
    policy: 'standard',
    retryLimit: 1,
    retryDelay: 1,
    deadLetter: pgBossQueueNames.deadLetter,
  },
];

/**
 * The app's own pg-boss instance, created at import time so the board can take it in
 * `forRoot({ pgBoss: { instance } })`. Nothing connects until `PgBossService` starts it, which
 * happens before the app listens. `migrate: true` installs the schema on a fresh database; the
 * board itself never migrates anything.
 */
export const pgBoss: PgBoss | null = config.pgBoss
  ? new PgBoss({ connectionString: config.postgresUrl, schema: PGBOSS_SCHEMA, migrate: true })
  : null;
