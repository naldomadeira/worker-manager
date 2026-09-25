import type { WorkerManagerRequest } from '@worker-manager/api/typings/app';
import type pg from 'pg';

// pg-boss's published `CommandResponse` declares no members, though every command resolves
// `{ jobs, requested, affected }` at runtime.
interface CommandResult {
  affected?: number;
}

/**
 * The part of a `PgBoss` instance the engine uses. Structural rather than imported, so the
 * package builds as CommonJS without pulling pg-boss's ESM types in, and so any 12.x instance
 * fits whatever minor it is on.
 */
export interface PgBossLike {
  getDb(): { executeSql(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
  send(name: string, data?: object | null, options?: object): Promise<string | null>;
  cancel(name: string, id: string | string[]): Promise<CommandResult>;
  resume(name: string, id: string | string[]): Promise<CommandResult>;
  retry(name: string, id: string | string[]): Promise<CommandResult>;
  deleteJob(name: string, id: string | string[]): Promise<CommandResult>;
  deleteQueuedJobs(name: string): Promise<void>;
  deleteStoredJobs(name: string): Promise<void>;
  schedule(name: string, cron: string, data?: object | null, options?: object): Promise<void>;
  unschedule(name: string, key?: string): Promise<void>;
  /** 12.31 and later. */
  previewSchedule?(cron: string, options?: { tz?: string; count?: number }): Date[];
  on?(event: 'error', listener: (error: unknown) => void): unknown;
}

export interface PgBossModule {
  PgBoss: new (options: Record<string, unknown>) => PgBossLike;
  getConstructionPlans(schema?: string): string;
}

export type PgBossConnection = string | pg.PoolConfig | pg.Pool;

export interface PgBossBoardOptions {
  /** The app's own instance, already started. Preferred for writes. */
  instance?: PgBossLike;
  /** Read through this (and write, when there is no instance). A pool of the app's is borrowed, not closed. */
  connection?: PgBossConnection;
  /** Default `pgboss`. */
  schema?: string;
  /** Allowlist of queue names, or a predicate. Everything else answers 404. */
  queues?: string[] | ((name: string) => boolean);
  /** Show pg-boss's own `__pgboss__*` queues. Default false. */
  includeInternalQueues?: boolean;
  /** Groups queue names in the sidebar, for example `'.'`. */
  delimiter?: string;
  /** `statement_timeout` of every read, in milliseconds. Default 5000. */
  queryTimeoutMs?: number;
  /** Per-state counts stop at this many jobs and report `capped`. Default 10000. */
  countCap?: number;
  /** Decides per request whether a queue exists for the caller. */
  visibilityGuard?: (
    request: WorkerManagerRequest,
    queueName: string
  ) => boolean | Promise<boolean>;
}
