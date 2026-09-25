/// <reference types="jest" />
import type {
  PgBossInfo,
  PgBossJob,
  PgBossQueueSummary,
  PgBossSchedule,
  PgBossStateCounts,
} from '@worker-manager/api/typings/app';
import type { MemoryHistory } from 'history';
import type { PropsWithChildren } from 'react';
import { ConfirmModal } from '../src/components/ConfirmModal/ConfirmModal';
import { PgBossApiContext } from '../src/engines/pgBoss/hooks/usePgBossApi';
import type { PgBossApi } from '../src/engines/pgBoss/services/PgBossApi';
import { useConfirm } from '../src/hooks/useConfirm';
import { createWrapper, type MockApi } from './testUtils';

export const EPOCH = '2026-01-01T00:00:00.000Z';

export function makePgBossQueue(
  name: string,
  overrides: Partial<PgBossQueueSummary> = {}
): PgBossQueueSummary {
  return {
    name,
    policy: 'standard',
    partition: false,
    counts: { queued: 0, deferred: 0, ready: 0, active: 0, failed: 0, total: 0 },
    statsCapturedOn: new Date().toISOString(),
    readyHistory: [],
    deadLetter: null,
    retryLimit: 2,
    retryDelay: 0,
    retryBackoff: false,
    retryDelayMax: null,
    expireInSeconds: 900,
    retentionSeconds: 1_209_600,
    deleteAfterSeconds: 604_800,
    warningQueueSize: 0,
    backlogged: false,
    heartbeatSeconds: null,
    notify: false,
    singletonsActive: null,
    scheduleCount: 0,
    createdOn: EPOCH,
    updatedOn: EPOCH,
    ...overrides,
  };
}

let sequence = 0;

/** A UUID the server would accept, distinct per call. */
export function jobId(): string {
  sequence += 1;
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

export function makePgBossJob(overrides: Partial<PgBossJob> = {}): PgBossJob {
  return {
    id: jobId(),
    queueName: 'emails',
    state: 'created',
    priority: 0,
    retryCount: 0,
    retryLimit: 2,
    createdOn: EPOCH,
    startAfter: EPOCH,
    startedOn: null,
    completedOn: null,
    singletonKey: null,
    groupId: null,
    deferred: false,
    blocked: false,
    deadLetterSource: null,
    data: { to: 'ada@example.com' },
    output: null,
    policy: 'standard',
    retryDelay: 0,
    retryBackoff: false,
    retryDelayMax: null,
    expireInSeconds: 900,
    deleteAfterSeconds: 604_800,
    keepUntil: EPOCH,
    singletonOn: null,
    groupTier: null,
    heartbeatSeconds: null,
    heartbeatOn: null,
    deadLetter: null,
    blocking: false,
    pendingDependencies: 0,
    ...overrides,
  };
}

export function makePgBossInfo(overrides: Partial<PgBossInfo> = {}): PgBossInfo {
  const writable = overrides.writable ?? true;
  return {
    schema: 'pgboss',
    delimiter: '',
    installed: true,
    schemaVersion: 42,
    supportedRange: { min: 35, max: 42 },
    readable: true,
    writable,
    readOnly: false,
    unavailableReason: null,
    writesDisabledReason: null,
    persistQueueStats: false,
    datastore: null,
    capabilities: {
      send: writable,
      retry: writable,
      cancel: writable,
      resume: writable,
      delete: writable,
      scheduleWrite: writable,
      schedulePreview: true,
      bulk: writable,
    },
    ...overrides,
  };
}

export function makePgBossSchedule(overrides: Partial<PgBossSchedule> = {}): PgBossSchedule {
  return {
    queueName: 'emails',
    key: '',
    kind: 'cron',
    expression: '0 * * * *',
    timezone: 'UTC',
    data: null,
    options: {},
    createdOn: EPOCH,
    updatedOn: EPOCH,
    lastJobId: null,
    nextRuns: [],
    ...overrides,
  };
}

export function makeCounts(
  counts: Partial<Record<keyof PgBossStateCounts, number | null>> = {},
  capped: (keyof PgBossStateCounts)[] = []
): PgBossStateCounts {
  const states = ['created', 'retry', 'active', 'completed', 'cancelled', 'failed'] as const;
  return Object.fromEntries(
    states.map((state) => [
      state,
      { count: counts[state] === undefined ? 0 : counts[state], capped: capped.includes(state) },
    ])
  ) as PgBossStateCounts;
}

export type MockPgBossApi = { [K in keyof PgBossApi]: jest.Mock };

/** A client whose every read answers something harmless; a spec overrides what it is about. */
export function mockPgBossApi(overrides: Partial<MockPgBossApi> = {}): MockPgBossApi {
  const ok = { requested: 1, affected: 1 };
  return {
    getInfo: jest.fn(async () => makePgBossInfo()),
    getQueues: jest.fn(async () => ({ queues: [] })),
    getQueue: jest.fn(async (name: string) => ({ queue: makePgBossQueue(name) })),
    getCounts: jest.fn(async () => ({ counts: makeCounts(), cap: 10_000 })),
    getJobs: jest.fn(async () => ({ jobs: [], nextCursor: null, prevCursor: null })),
    getJob: jest.fn(async () => ({ job: makePgBossJob() })),
    getDependencies: jest.fn(async () => ({ dependencies: [], dependents: [] })),
    getSchedules: jest.fn(async () => ({ schedules: [] })),
    previewSchedule: jest.fn(async () => ({ runs: [] })),
    sendJob: jest.fn(async () => ({ id: jobId() })),
    jobCommand: jest.fn(async () => ok),
    bulkCommand: jest.fn(async () => ok),
    retryFailed: jest.fn(async () => ok),
    deleteQueued: jest.fn(async () => ok),
    deleteStored: jest.fn(async () => ok),
    upsertSchedule: jest.fn(async () => ({ schedule: makePgBossSchedule() })),
    removeSchedule: jest.fn(async () => ok),
    ...overrides,
  };
}

/** The confirm dialog the board frame renders, for specs that answer a confirmation. */
export const ConfirmHost = () => {
  const { confirmProps } = useConfirm();
  return <ConfirmModal {...confirmProps} />;
};

export function createPgBossWrapper({
  pgBossApi,
  api = {},
  history,
}: {
  pgBossApi: MockPgBossApi;
  api?: MockApi;
  history?: MemoryHistory;
}) {
  const { Wrapper: Base, ...rest } = createWrapper({
    api,
    history,
    uiConfig: { engine: 'pg-boss' } as never,
  });

  const Wrapper = ({ children }: PropsWithChildren<unknown>) => (
    <Base>
      <PgBossApiContext.Provider value={pgBossApi as unknown as PgBossApi}>
        {children}
        <ConfirmHost />
      </PgBossApiContext.Provider>
    </Base>
  );

  return { Wrapper, ...rest };
}
