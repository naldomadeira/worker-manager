import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createMemoryHistory } from 'history';
import { Route } from 'react-router-dom';
import { PgBossQueuePage } from '../../src/engines/pgBoss/pages/PgBossQueuePage';
import { useSettingsStore } from '../../src/hooks/useSettings';
import { toastManager } from '../../src/services/toastManager';
import {
  createPgBossWrapper,
  makePgBossInfo,
  makePgBossJob,
  mockPgBossApi,
} from '../PgBossTestUtils';
import { render } from '../testUtils';

jest.mock('../../src/utils/highlight/highlight', () => ({
  asyncHighlight: async (code: string) => code,
}));

beforeEach(() => {
  useSettingsStore.setState({
    pollingInterval: 0,
    jobsPerPage: 10,
    confirmJobActions: false,
    confirmQueueActions: false,
  });
});

function renderPage(pgBossApi = mockPgBossApi(), entry = '/queue/emails?state=failed') {
  const history = createMemoryHistory({ initialEntries: [entry] });
  const { Wrapper } = createPgBossWrapper({ pgBossApi, history });
  const utils = render(
    <Route path="/queue/:name">
      <PgBossQueuePage />
    </Route>,
    { wrapper: Wrapper }
  );
  return { ...utils, history, pgBossApi };
}

const page = (...jobs: ReturnType<typeof makePgBossJob>[]) =>
  jest.fn(async () => ({ jobs, nextCursor: 'next-1', prevCursor: null }));

it('selects jobs one by one and all on the page, and counts them in a sticky bar', async () => {
  const jobs = [makePgBossJob({ state: 'failed' }), makePgBossJob({ state: 'failed' })];
  renderPage(mockPgBossApi({ getJobs: page(...jobs) }));

  const [first] = await screen.findAllByRole('checkbox', { name: 'PGBOSS.BULK.SELECT_JOB' });
  expect(screen.queryByRole('toolbar', { name: 'PGBOSS.BULK.TOOLBAR' })).toBeNull();

  fireEvent.click(first);
  const bar = await screen.findByRole('toolbar', { name: 'PGBOSS.BULK.TOOLBAR' });
  expect(bar.textContent).toContain('PGBOSS.BULK.SELECTED');

  fireEvent.click(screen.getByRole('checkbox', { name: 'PGBOSS.BULK.SELECT_ALL' }));
  await waitFor(() =>
    expect(
      screen
        .getAllByRole('checkbox', { name: 'PGBOSS.BULK.SELECT_JOB' })
        .every((box) => box.getAttribute('aria-checked') === 'true')
    ).toBe(true)
  );

  fireEvent.click(within(bar).getByRole('button', { name: 'PGBOSS.BULK.CLEAR' }));
  await waitFor(() =>
    expect(screen.queryByRole('toolbar', { name: 'PGBOSS.BULK.TOOLBAR' })).toBeNull()
  );
});

it('offers only the commands the state tab accepts, confirms with the count, and toasts the result', async () => {
  const jobs = [makePgBossJob({ state: 'failed' }), makePgBossJob({ state: 'failed' })];
  const pgBossApi = mockPgBossApi({
    getJobs: page(...jobs),
    bulkCommand: jest.fn(async () => ({ requested: 2, affected: 1 })),
  });
  const toast = jest.spyOn(toastManager, 'update');
  renderPage(pgBossApi);

  fireEvent.click(await screen.findByRole('checkbox', { name: 'PGBOSS.BULK.SELECT_ALL' }));
  const bar = await screen.findByRole('toolbar', { name: 'PGBOSS.BULK.TOOLBAR' });
  const labels = within(bar)
    .getAllByRole('button')
    .map((button) => button.textContent || button.getAttribute('aria-label'));
  expect(labels).toEqual([
    'PGBOSS.ACTIONS.RETRY.LABEL',
    'PGBOSS.ACTIONS.DELETE.LABEL',
    'PGBOSS.BULK.CLEAR',
  ]);

  fireEvent.click(within(bar).getByRole('button', { name: 'PGBOSS.ACTIONS.RETRY.LABEL' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog.textContent).toContain('PGBOSS.BULK.RETRY.CONFIRM');
  expect(pgBossApi.bulkCommand).not.toHaveBeenCalled();

  fireEvent.click(within(dialog).getByRole('button', { name: 'CONFIRM.CONFIRM_BTN' }));
  await waitFor(() =>
    expect(pgBossApi.bulkCommand).toHaveBeenCalledWith(
      'retry',
      'emails',
      jobs.map((job) => job.id)
    )
  );
  await waitFor(() =>
    expect(toast).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'success',
        title: 'PGBOSS.BULK.RETRY.DONE',
        description: 'PGBOSS.ACTIONS.AFFECTED',
      })
    )
  );
  await waitFor(() =>
    expect(screen.queryByRole('toolbar', { name: 'PGBOSS.BULK.TOOLBAR' })).toBeNull()
  );
  toast.mockRestore();
});

it('warns that cancelling running jobs leaves their handlers running', async () => {
  const jobs = [makePgBossJob({ state: 'active' })];
  const pgBossApi = mockPgBossApi({ getJobs: page(...jobs) });
  renderPage(pgBossApi, '/queue/emails?state=active');

  fireEvent.click(await screen.findByRole('checkbox', { name: 'PGBOSS.BULK.SELECT_JOB' }));
  const bar = await screen.findByRole('toolbar', { name: 'PGBOSS.BULK.TOOLBAR' });
  fireEvent.click(within(bar).getByRole('button', { name: 'PGBOSS.ACTIONS.CANCEL.LABEL' }));

  const dialog = await screen.findByRole('alertdialog');
  expect(dialog.textContent).toContain('PGBOSS.BULK.CANCEL.CONFIRM');
  expect(dialog.textContent).toContain('PGBOSS.ACTIONS.CANCEL_ACTIVE_WARNING');
});

it('keeps only what every selected job accepts on the tab of all states', async () => {
  const failed = makePgBossJob({ state: 'failed' });
  const cancelled = makePgBossJob({ state: 'cancelled' });
  renderPage(mockPgBossApi({ getJobs: page(failed, cancelled) }), '/queue/emails');

  fireEvent.click(await screen.findByRole('checkbox', { name: 'PGBOSS.BULK.SELECT_ALL' }));
  const bar = await screen.findByRole('toolbar', { name: 'PGBOSS.BULK.TOOLBAR' });

  expect(within(bar).queryByRole('button', { name: 'PGBOSS.ACTIONS.RETRY.LABEL' })).toBeNull();
  expect(within(bar).queryByRole('button', { name: 'PGBOSS.ACTIONS.RESUME.LABEL' })).toBeNull();
  expect(within(bar).getByRole('button', { name: 'PGBOSS.ACTIONS.DELETE.LABEL' })).toBeTruthy();
});

it('clears the selection when the page or the tab changes', async () => {
  const pgBossApi = mockPgBossApi({ getJobs: page(makePgBossJob({ state: 'failed' })) });
  const { history } = renderPage(pgBossApi);

  fireEvent.click(await screen.findByRole('checkbox', { name: 'PGBOSS.BULK.SELECT_ALL' }));
  await screen.findByRole('toolbar', { name: 'PGBOSS.BULK.TOOLBAR' });

  fireEvent.click(screen.getByRole('button', { name: /PGBOSS.PAGINATION.NEXT/ }));
  await waitFor(() => expect(history.location.search).toContain('cursor=next-1'));
  await waitFor(() =>
    expect(screen.queryByRole('toolbar', { name: 'PGBOSS.BULK.TOOLBAR' })).toBeNull()
  );

  fireEvent.click(await screen.findByRole('checkbox', { name: 'PGBOSS.BULK.SELECT_ALL' }));
  await screen.findByRole('toolbar', { name: 'PGBOSS.BULK.TOOLBAR' });
  history.push('/queue/emails?state=completed');
  await waitFor(() =>
    expect(screen.queryByRole('toolbar', { name: 'PGBOSS.BULK.TOOLBAR' })).toBeNull()
  );
});

it.each([
  ['a read-only board', makePgBossInfo({ writable: false, readOnly: true })],
  [
    'a schema guard that turned writes off',
    makePgBossInfo({
      writable: false,
      writesDisabledReason: {
        key: 'ERRORS.PGBOSS_SCHEMA_UNTESTED',
        options: { found: 43, max: 42 },
      },
    }),
  ],
])('offers no selection on %s', async (_label, info) => {
  const pgBossApi = mockPgBossApi({
    getInfo: jest.fn(async () => info),
    getJobs: page(makePgBossJob({ state: 'failed' })),
  });
  const { container } = renderPage(pgBossApi);

  await waitFor(() => expect(container.querySelector('[data-job-state="failed"]')).toBeTruthy());
  await waitFor(() => expect(pgBossApi.getInfo).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.queryByRole('checkbox')).toBeNull();
});
