import { waitFor } from '@testing-library/react';
import type { AppQueue } from '@worker-manager/api/typings/app';
import type { GetQueuesResponse } from '@worker-manager/api/typings/responses';
import { createMemoryHistory } from 'history';
import { useSettingsStore } from '../../src/hooks/useSettings';
import { QueuePage } from '../../src/pages/QueuePage/QueuePage';
import { createWrapper, makeQueue, render } from '../testUtils';

jest.mock('../../src/utils/highlight/highlight', () => ({
  asyncHighlight: async (code: string) => code,
}));

beforeEach(() => {
  useSettingsStore.setState({ pollingInterval: 0, jobsPerPage: 10 });
});

function renderPage(overrides: Partial<AppQueue> = {}) {
  const queues = [makeQueue('reports', { jobSchedulerCount: 2, ...overrides })];
  const getQueues = jest.fn(() => Promise.resolve<GetQueuesResponse>({ queues }));
  const { Wrapper } = createWrapper({
    api: { getQueues },
    history: createMemoryHistory({ initialEntries: ['/queue/reports'] }),
  });

  const { container } = render(<QueuePage />, { wrapper: Wrapper });

  const schedulersLink = () => container.querySelector('a[href*="/job-schedulers"]');

  return { container, schedulersLink };
}

it('renders the schedulers link in the status tab row', async () => {
  const { container, schedulersLink } = renderPage();

  await waitFor(() => expect(schedulersLink()).toBeTruthy());
  expect(
    container.querySelector('[data-slot="status-bar"] a[href*="/job-schedulers"]')
  ).toBeTruthy();
  expect(
    container.querySelector('[data-slot="queue-toolbar"] a[href*="/job-schedulers"]')
  ).toBeNull();
});

it('keeps the schedulers link on a read only queue', async () => {
  const { schedulersLink } = renderPage({ readOnlyMode: true });

  await waitFor(() => expect(schedulersLink()).toBeTruthy());
});

it('shows the load error, with a retry, when the queue list cannot be fetched', async () => {
  const getQueues = jest.fn(() =>
    Promise.resolve({ error: { key: 'ERRORS.REDIS_UNAVAILABLE' } } as unknown as GetQueuesResponse)
  );
  const { Wrapper } = createWrapper({
    api: { getQueues },
    history: createMemoryHistory({ initialEntries: ['/queue/reports'] }),
  });

  const { container, getByRole } = render(<QueuePage />, { wrapper: Wrapper });

  await waitFor(() => expect(getByRole('alert')).toBeTruthy());
  expect(container.textContent).toContain('DASHBOARD.LOAD_ERROR');
  expect(container.textContent).toContain('ERRORS.REDIS_UNAVAILABLE');
  expect(container.textContent).not.toContain('QUEUE.NOT_FOUND');
  expect(getByRole('button', { name: 'DASHBOARD.RETRY' })).toBeTruthy();
});

it('puts the attempt count and the failure reason on a collapsed failed job card', async () => {
  useSettingsStore.setState({ pollingInterval: 0, jobsPerPage: 10, collapseJob: true });
  const job = {
    id: 42,
    name: 'send-email',
    timestamp: Date.now(),
    progress: 0,
    attempts: 2,
    failedReason: 'upstream answered 503',
    stacktrace: [],
    opts: { attempts: 5 },
    data: {},
    returnValue: null,
    isFailed: true,
  };
  const { container } = renderPage({
    jobs: [job],
    counts: { ...makeQueue('reports').counts, failed: 1 },
  });

  await waitFor(() => expect(container.textContent).toContain('JOB.ATTEMPTS_OF'));
  expect(container.querySelector('[title="upstream answered 503"]')?.textContent).toBe(
    'upstream answered 503'
  );
});
