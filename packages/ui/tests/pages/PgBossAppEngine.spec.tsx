import { screen, waitFor } from '@testing-library/react';
import type { GetQueuesResponse } from '@worker-manager/api/typings/responses';
import { createMemoryHistory } from 'history';
import { App } from '../../src/App';
import { PgBossApiContext } from '../../src/engines/pgBoss/hooks/usePgBossApi';
import type { PgBossApi } from '../../src/engines/pgBoss/services/PgBossApi';
import { useSettingsStore } from '../../src/hooks/useSettings';
import { makePgBossQueue, mockPgBossApi } from '../PgBossTestUtils';
import { createWrapper, makeQueue, render } from '../testUtils';

jest.mock('../../src/utils/highlight/highlight', () => ({
  asyncHighlight: async (code: string) => code,
}));

// The app scrolls to the top on navigation, which jsdom does not implement.
beforeAll(() => {
  window.scrollTo = jest.fn() as never;
});

beforeEach(() => {
  useSettingsStore.setState({ pollingInterval: 0, jobsPerPage: 10, sidebarCollapsed: false });
});

function renderApp(uiConfig: Record<string, unknown>, path = '/') {
  const getQueues = jest.fn(() =>
    Promise.resolve<GetQueuesResponse>({ queues: [makeQueue('bull-queue')] })
  );
  const pgBossApi = mockPgBossApi({
    getQueues: jest.fn(async () => ({ queues: [makePgBossQueue('boss-queue')] })),
  });
  const { Wrapper } = createWrapper({
    api: { getQueues },
    history: createMemoryHistory({ initialEntries: [path] }),
    uiConfig: uiConfig as never,
  });
  const utils = render(
    <PgBossApiContext.Provider value={pgBossApi as unknown as PgBossApi}>
      <App />
    </PgBossApiContext.Provider>,
    { wrapper: Wrapper }
  );
  return { ...utils, getQueues, pgBossApi };
}

describe('a board without a pg-boss engine', () => {
  it.each([{}, { engine: 'bullmq' }])(
    'renders the BullMQ overview for uiConfig %j',
    async (config) => {
      const { container, getQueues, pgBossApi } = renderApp(config);

      await waitFor(() => expect(container.textContent).toContain('DASHBOARD.KPI.QUEUES'));
      expect(screen.getAllByRole('link', { name: /bull-queue/ }).length).toBeGreaterThan(0);
      expect(getQueues).toHaveBeenCalled();
      for (const method of Object.values(pgBossApi)) {
        expect(method).not.toHaveBeenCalled();
      }
      expect(container.textContent).not.toContain('PGBOSS.EXPERIMENTAL');
    }
  );

  it('keeps the BullMQ queue page on /queue/:name', async () => {
    const { getQueues } = renderApp({}, '/queue/bull-queue');

    await waitFor(() =>
      expect(getQueues).toHaveBeenCalledWith(expect.objectContaining({ activeQueue: 'bull-queue' }))
    );
    expect(await screen.findByRole('heading', { name: 'bull-queue' })).toBeTruthy();
  });
});

describe('a pg-boss board', () => {
  it('renders the pg-boss overview in the same shell and never asks for BullMQ queues', async () => {
    const { container, getQueues, pgBossApi } = renderApp({ engine: 'pg-boss' });

    await waitFor(() => expect(container.textContent).toContain('PGBOSS.KPI.READY'));
    expect(screen.getAllByRole('link', { name: /boss-queue/ }).length).toBeGreaterThan(0);
    expect(container.textContent).toContain('PGBOSS.EXPERIMENTAL');
    expect(pgBossApi.getQueues).toHaveBeenCalled();
    expect(getQueues).not.toHaveBeenCalled();
  });

  it('serves the pg-boss queue page on the BullMQ path', async () => {
    const { pgBossApi } = renderApp({ engine: 'pg-boss' }, '/queue/boss-queue');

    expect(await screen.findByRole('heading', { name: 'boss-queue' })).toBeTruthy();
    expect(pgBossApi.getCounts).toHaveBeenCalledWith('boss-queue');
  });
});
