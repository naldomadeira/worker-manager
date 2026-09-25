import type { PgBossJobsParams } from '../services/PgBossApi';

/** Every pg-boss query sits under one root, so a write can refresh the board in one call. */
export const pgBossKeys = {
  all: ['pgBoss'] as const,
  info: ['pgBoss', 'info'] as const,
  queues: ['pgBoss', 'queues'] as const,
  queue: (name: string) => ['pgBoss', 'queue', name] as const,
  counts: (name: string) => ['pgBoss', 'counts', name] as const,
  jobs: (name: string, params: PgBossJobsParams) => ['pgBoss', 'jobs', name, params] as const,
  job: (name: string, id: string) => ['pgBoss', 'job', name, id] as const,
  dependencies: (name: string, id: string) => ['pgBoss', 'dependencies', name, id] as const,
  schedules: (queueName: string | undefined) => ['pgBoss', 'schedules', queueName ?? null] as const,
};
