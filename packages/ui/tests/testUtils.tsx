import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { AppQueue, UIConfig } from '@worker-manager/api/typings/app';
import { createMemoryHistory, MemoryHistory } from 'history';
import { PropsWithChildren } from 'react';
import { Router } from 'react-router-dom';
import { ApiContext } from '../src/hooks/useApi';
import { UIConfigContext } from '../src/hooks/useUIConfig';
import type { Api } from '../src/services/Api';

/** What the API reports per library, mirrored from `packages/api/tests/api/capabilities.spec.ts`. */
export function capabilitiesFor(
  type: AppQueue['type'],
  { globalRateLimit = type === 'bullmq' }: { globalRateLimit?: boolean } = {}
): AppQueue['capabilities'] {
  const isBullMQ = type === 'bullmq';
  return {
    pause: true,
    logs: true,
    progress: true,
    flows: isBullMQ,
    promote: true,
    updateData: true,
    changeDelay: isBullMQ,
    changePriority: isBullMQ,
    removeUnprocessedChildren: isBullMQ,
    completedRetry: isBullMQ,
    globalConcurrency: isBullMQ,
    globalRateLimit,
    nativeMetrics: true,
    workers: true,
    jobSchedulers: { update: isBullMQ, run: isBullMQ, kinds: ['every', 'cron'] },
    jobOptionsSchema: type,
  };
}

export function makeQueue(name: string, overrides: Partial<AppQueue> = {}): AppQueue {
  const type = overrides.type ?? 'bullmq';
  const supportsGlobalRateLimit = overrides.supportsGlobalRateLimit ?? type === 'bullmq';
  return {
    delimiter: '.',
    name,
    counts: {
      active: 0,
      completed: 0,
      delayed: 0,
      failed: 0,
      paused: 0,
      prioritized: 0,
      waiting: 0,
      'waiting-children': 0,
      latest: 0,
    },
    jobs: [],
    statuses: ['waiting', 'completed', 'failed'],
    pagination: { pageCount: 1, range: { start: 0, end: 9 } },
    readOnlyMode: false,
    allowRetries: true,
    allowCompletedRetries: true,
    isPaused: false,
    type,
    library: type,
    datastore: 'redis',
    capabilities: capabilitiesFor(type, { globalRateLimit: supportsGlobalRateLimit }),
    globalConcurrency: null,
    activeRateLimitTtl: 0,
    supportsGlobalRateLimit,
    jobSchedulerCount: 0,
    hasWorkers: true,
    ...overrides,
  };
}

export function makeQueueWithFailed(
  name: string,
  failed: number,
  overrides: Partial<AppQueue> = {}
): AppQueue {
  const queue = makeQueue(name, overrides);
  return { ...queue, counts: { ...queue.counts, failed } };
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export type MockApi = Partial<{
  [K in keyof Api]: Api[K] extends (...args: infer A) => unknown ? (...args: A) => unknown : Api[K];
}>;

interface WrapperOptions {
  api: MockApi;
  history?: MemoryHistory;
  uiConfig?: UIConfig;
}

export function createWrapper({
  api,
  history = createMemoryHistory(),
  uiConfig = {},
}: WrapperOptions) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const Wrapper = ({ children }: PropsWithChildren<unknown>) => (
    <QueryClientProvider client={queryClient}>
      <Router history={history}>
        <ApiContext.Provider value={api as unknown as Api}>
          <UIConfigContext.Provider value={uiConfig}>{children}</UIConfigContext.Provider>
        </ApiContext.Provider>
      </Router>
    </QueryClientProvider>
  );

  return { Wrapper, queryClient, history };
}

export { render };
