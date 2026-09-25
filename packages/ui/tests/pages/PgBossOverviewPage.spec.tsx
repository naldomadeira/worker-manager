import { fireEvent, screen, waitFor } from '@testing-library/react';
import { createMemoryHistory } from 'history';
import { PgBossOverviewPage } from '../../src/engines/pgBoss/pages/PgBossOverviewPage';
import { useQueueSearch } from '../../src/hooks/useQueueSearch';
import { useSettingsStore } from '../../src/hooks/useSettings';
import {
  createPgBossWrapper,
  makePgBossInfo,
  makePgBossQueue,
  mockPgBossApi,
} from '../PgBossTestUtils';
import { render } from '../testUtils';

beforeEach(() => {
  useSettingsStore.setState({ pollingInterval: 0, confirmQueueActions: false });
  useQueueSearch.getState().setSearchTerm('');
});

function renderPage(pgBossApi = mockPgBossApi(), initialEntries = ['/']) {
  const history = createMemoryHistory({ initialEntries });
  const { Wrapper } = createPgBossWrapper({ pgBossApi, history });
  return { ...render(<PgBossOverviewPage />, { wrapper: Wrapper }), history, pgBossApi };
}

const queues = [
  makePgBossQueue('emails', {
    counts: { queued: 7, deferred: 2, ready: 5, active: 3, failed: 4, total: 40 },
  }),
  makePgBossQueue('reports', {
    counts: { queued: 1, deferred: 0, ready: 1, active: 0, failed: 0, total: 9 },
    backlogged: true,
    warningQueueSize: 1,
  }),
];

it('shows a card per queue and the board totals from the cached counters', async () => {
  const pgBossApi = mockPgBossApi({ getQueues: jest.fn(async () => ({ queues })) });
  const { container } = renderPage(pgBossApi);

  await screen.findByRole('link', { name: 'emails' });
  expect(screen.getByRole('link', { name: 'reports' })).toBeTruthy();
  expect(container.textContent).toContain('PGBOSS.KPI.READY');
  expect(container.textContent).toContain('PGBOSS.KPI.TOTAL');
  expect(container.textContent).toContain('PGBOSS.QUEUE.BACKLOGGED');
  expect(screen.getAllByRole('link', { name: /PGBOSS.STATE.FAILED/ })[0].getAttribute('href')).toBe(
    '/queue/emails?state=failed'
  );
});

it('filters the cards to the queues a KPI tile counts', async () => {
  const pgBossApi = mockPgBossApi({ getQueues: jest.fn(async () => ({ queues })) });
  renderPage(pgBossApi, ['/?filter=failed']);

  await screen.findByRole('link', { name: 'emails' });
  expect(screen.queryByRole('link', { name: 'reports' })).toBeNull();
});

it('warns when no pg-boss instance has ever written the counters', async () => {
  const pgBossApi = mockPgBossApi({
    getQueues: jest.fn(async () => ({
      queues: [makePgBossQueue('emails', { statsCapturedOn: null })],
    })),
  });
  const { container } = renderPage(pgBossApi);

  await waitFor(() => expect(container.textContent).toContain('PGBOSS.STATS.NEVER'));
});

it('warns when the counters are older than five minutes', async () => {
  const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const pgBossApi = mockPgBossApi({
    getQueues: jest.fn(async () => ({
      queues: [makePgBossQueue('emails', { statsCapturedOn: old })],
    })),
  });
  const { container } = renderPage(pgBossApi);

  await waitFor(() => expect(container.textContent).toContain('PGBOSS.STATS.STALE'));
});

it('explains why writes are off and offers no queue actions', async () => {
  const pgBossApi = mockPgBossApi({
    getInfo: jest.fn(async () =>
      makePgBossInfo({
        writable: false,
        writesDisabledReason: { key: 'ERRORS.PGBOSS_WRITER_UNAVAILABLE' },
      })
    ),
    getQueues: jest.fn(async () => ({ queues })),
  });
  const { container } = renderPage(pgBossApi);

  await waitFor(() => expect(container.textContent).toContain('PGBOSS.BANNER.WRITES_DISABLED'));
  expect(container.textContent).toContain('ERRORS.PGBOSS_WRITER_UNAVAILABLE');
  expect(screen.queryByRole('button', { name: 'PGBOSS.ACTIONS.QUEUE_ACTIONS' })).toBeNull();
});

it('marks a read-only board without the writes-disabled banner', async () => {
  const pgBossApi = mockPgBossApi({
    getInfo: jest.fn(async () =>
      makePgBossInfo({
        writable: false,
        readOnly: true,
        writesDisabledReason: { key: 'ERRORS.QUEUE_READ_ONLY' },
      })
    ),
    getQueues: jest.fn(async () => ({ queues })),
  });
  const { container } = renderPage(pgBossApi);

  await waitFor(() => expect(container.textContent).toContain('PGBOSS.BANNER.READ_ONLY'));
  expect(container.textContent).not.toContain('PGBOSS.BANNER.WRITES_DISABLED');
  expect(screen.queryByRole('button', { name: 'PGBOSS.ACTIONS.QUEUE_ACTIONS' })).toBeNull();
});

it('retries every failed job of a queue from its menu', async () => {
  const pgBossApi = mockPgBossApi({ getQueues: jest.fn(async () => ({ queues })) });
  renderPage(pgBossApi);

  const [menu] = await screen.findAllByRole('button', { name: 'PGBOSS.ACTIONS.QUEUE_ACTIONS' });
  fireEvent.pointerDown(menu, { button: 0, pointerType: 'mouse' });
  fireEvent.click(
    await screen.findByRole('menuitem', { name: 'PGBOSS.ACTIONS.RETRY_FAILED.LABEL' })
  );

  await waitFor(() => expect(pgBossApi.retryFailed).toHaveBeenCalledWith('emails'));
});

it('shows the empty state when there are no queues', async () => {
  const { container } = renderPage();

  await waitFor(() => expect(container.textContent).toContain('PGBOSS.EMPTY.QUEUES'));
});

it('shows the load error when the queues cannot be read', async () => {
  const pgBossApi = mockPgBossApi({
    getQueues: jest.fn(async () => ({ error: { key: 'ERRORS.PGBOSS_QUERY_TIMEOUT' } })),
  });
  const { container } = renderPage(pgBossApi);

  await screen.findByRole('alert');
  expect(container.textContent).toContain('ERRORS.PGBOSS_QUERY_TIMEOUT');
});
