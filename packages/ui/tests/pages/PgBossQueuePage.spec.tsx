import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createMemoryHistory } from 'history';
import { Route } from 'react-router-dom';
import { PgBossQueuePage } from '../../src/engines/pgBoss/pages/PgBossQueuePage';
import { useSettingsStore } from '../../src/hooks/useSettings';
import {
  createPgBossWrapper,
  makeCounts,
  makePgBossInfo,
  makePgBossJob,
  makePgBossQueue,
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

function renderPage(pgBossApi = mockPgBossApi(), entry = '/queue/emails') {
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

it('tabs the six pg-boss states with their live counts, capped and timed out', async () => {
  const pgBossApi = mockPgBossApi({
    getCounts: jest.fn(async () => ({
      counts: makeCounts({ created: 3, failed: 10_001, completed: null }, ['failed']),
      cap: 10_000,
    })),
  });
  const { container } = renderPage(pgBossApi);

  await waitFor(() => expect(container.textContent).toContain('PGBOSS.COUNT.CAPPED'));
  const bar = container.querySelector('[data-slot="status-bar"]')!;
  for (const state of ['ALL', 'CREATED', 'RETRY', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'FAILED']) {
    expect(bar.textContent).toContain(`PGBOSS.STATE.${state}`);
  }
  expect(bar.textContent).toContain('PGBOSS.COUNT.UNKNOWN');
  expect(
    within(bar as HTMLElement).getByRole('link', { name: /PGBOSS.STATE.COMPLETED/ }).title
  ).toBe('PGBOSS.COUNT.TIMEOUT');
});

it('lists the jobs of the state in the URL', async () => {
  const job = makePgBossJob({ state: 'failed', retryCount: 2, retryLimit: 2 });
  const pgBossApi = mockPgBossApi({
    getJobs: jest.fn(async () => ({ jobs: [job], nextCursor: null, prevCursor: null })),
  });
  const { container } = renderPage(pgBossApi, '/queue/emails?state=failed');

  await waitFor(() => expect(container.textContent).toContain(job.id));
  expect(pgBossApi.getJobs).toHaveBeenCalledWith(
    'emails',
    expect.objectContaining({ state: 'failed', limit: 10 })
  );
  expect(container.textContent).toContain('PGBOSS.JOB.ATTEMPT');
});

it('pages forward and back to the first page by cursor', async () => {
  const pgBossApi = mockPgBossApi({
    getJobs: jest.fn(async (_name, params) => ({
      jobs: [makePgBossJob()],
      nextCursor: params.cursor ? null : 'next-1',
      prevCursor: params.cursor ? 'prev-1' : null,
    })),
  });
  const { history } = renderPage(pgBossApi);

  fireEvent.click(await screen.findByRole('button', { name: /PGBOSS.PAGINATION.NEXT/ }));
  await waitFor(() => expect(history.location.search).toBe('?cursor=next-1'));
  await waitFor(() =>
    expect(pgBossApi.getJobs).toHaveBeenLastCalledWith(
      'emails',
      expect.objectContaining({ cursor: 'next-1' })
    )
  );

  fireEvent.click(await screen.findByRole('button', { name: 'PGBOSS.PAGINATION.FIRST' }));
  await waitFor(() => expect(history.location.search).toBe(''));
});

it('offers the actions each state allows', async () => {
  const failed = makePgBossJob({ state: 'failed' });
  const active = makePgBossJob({ state: 'active', startedOn: new Date().toISOString() });
  const cancelled = makePgBossJob({ state: 'cancelled' });
  const pgBossApi = mockPgBossApi({
    getJobs: jest.fn(async () => ({
      jobs: [failed, active, cancelled],
      nextCursor: null,
      prevCursor: null,
    })),
  });
  const { container } = renderPage(pgBossApi);

  await waitFor(() => expect(container.querySelectorAll('[data-job-state]').length).toBe(3));
  const card = (state: string) =>
    within(container.querySelector(`[data-job-state="${state}"]`) as HTMLElement);
  const names = (state: string) =>
    card(state)
      .queryAllByRole('button')
      .map((button) => button.getAttribute('aria-label'));

  expect(names('failed')).toEqual([
    'PGBOSS.ACTIONS.RETRY.LABEL',
    'PGBOSS.ACTIONS.DUPLICATE.LABEL',
    'PGBOSS.ACTIONS.DELETE.LABEL',
  ]);
  expect(names('active')).toEqual(['PGBOSS.ACTIONS.CANCEL.LABEL']);
  expect(names('cancelled')).toEqual([
    'PGBOSS.ACTIONS.RESUME.LABEL',
    'PGBOSS.ACTIONS.DELETE.LABEL',
  ]);

  fireEvent.click(card('failed').getByRole('button', { name: 'PGBOSS.ACTIONS.RETRY.LABEL' }));
  await waitFor(() =>
    expect(pgBossApi.jobCommand).toHaveBeenCalledWith('retry', 'emails', failed.id)
  );
});

it('always confirms cancelling a running job, and says the handler keeps running', async () => {
  const active = makePgBossJob({ state: 'active' });
  const pgBossApi = mockPgBossApi({
    getJobs: jest.fn(async () => ({ jobs: [active], nextCursor: null, prevCursor: null })),
  });
  renderPage(pgBossApi);

  fireEvent.click(await screen.findByRole('button', { name: 'PGBOSS.ACTIONS.CANCEL.LABEL' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog.textContent).toContain('PGBOSS.ACTIONS.CANCEL_ACTIVE_WARNING');
  expect(pgBossApi.jobCommand).not.toHaveBeenCalled();

  fireEvent.click(within(dialog).getByRole('button', { name: 'CONFIRM.CONFIRM_BTN' }));
  await waitFor(() =>
    expect(pgBossApi.jobCommand).toHaveBeenCalledWith('cancel', 'emails', active.id)
  );
});

it('shows no controls on a read-only board', async () => {
  const pgBossApi = mockPgBossApi({
    getInfo: jest.fn(async () => makePgBossInfo({ writable: false, readOnly: true })),
    getJobs: jest.fn(async () => ({
      jobs: [makePgBossJob({ state: 'failed' })],
      nextCursor: null,
      prevCursor: null,
    })),
  });
  const { container } = renderPage(pgBossApi);

  await waitFor(() => expect(container.querySelector('[data-job-state="failed"]')).toBeTruthy());
  await waitFor(() => expect(container.textContent).toContain('PGBOSS.BANNER.READ_ONLY'));
  expect(screen.queryByRole('button', { name: 'PGBOSS.ACTIONS.RETRY.LABEL' })).toBeNull();
  expect(screen.queryByRole('button', { name: /PGBOSS.ACTIONS.SEND.LABEL/ })).toBeNull();
});

it('says the list is too slow when the query times out', async () => {
  const pgBossApi = mockPgBossApi({
    getJobs: jest.fn(async () => ({ error: { key: 'ERRORS.PGBOSS_QUERY_TIMEOUT' } })),
  });
  const { container } = renderPage(pgBossApi, '/queue/emails?state=completed');

  await waitFor(() => expect(container.textContent).toContain('PGBOSS.BANNER.SLOW_QUERY'));
});

it('refuses an id filter that is not a UUID, and filters by a valid one', async () => {
  const { history, pgBossApi } = renderPage();

  const input = await screen.findByRole('textbox', { name: 'PGBOSS.FILTER.ID' });
  fireEvent.change(input, { target: { value: '42' } });
  fireEvent.click(screen.getByRole('button', { name: 'PGBOSS.FILTER.APPLY' }));
  expect(await screen.findByText('PGBOSS.FILTER.INVALID_ID')).toBeTruthy();

  const id = '00000000-0000-4000-8000-00000000abcd';
  fireEvent.change(input, { target: { value: id } });
  fireEvent.click(screen.getByRole('button', { name: 'PGBOSS.FILTER.APPLY' }));
  await waitFor(() => expect(history.location.search).toBe(`?id=${id}`));
  await waitFor(() =>
    expect(pgBossApi.getJobs).toHaveBeenLastCalledWith('emails', expect.objectContaining({ id }))
  );
});

it('says so when the queue does not exist', async () => {
  const pgBossApi = mockPgBossApi({
    getQueue: jest.fn(async () => ({ error: { key: 'ERRORS.QUEUE_NOT_FOUND' } })),
  });
  const { container } = renderPage(pgBossApi, '/queue/missing');

  await waitFor(() => expect(container.textContent).toContain('PGBOSS.QUEUE.NOT_FOUND'));
});

it('links to the queue schedules when it has some', async () => {
  const pgBossApi = mockPgBossApi({
    getQueue: jest.fn(async (name: string) => ({
      queue: makePgBossQueue(name, { scheduleCount: 2 }),
    })),
  });
  renderPage(pgBossApi);

  const link = await screen.findByRole('link', { name: 'PGBOSS.SCHEDULES.TITLE' });
  expect(link.getAttribute('href')).toBe('/job-schedulers?queueName=emails');
});
