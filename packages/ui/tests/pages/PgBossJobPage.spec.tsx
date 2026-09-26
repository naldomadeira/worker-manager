import { fireEvent, screen, waitFor } from '@testing-library/react';
import { createMemoryHistory } from 'history';
import { Route } from 'react-router-dom';
import { Title } from '../../src/components/Title/Title';
import { usePgBossNavigation } from '../../src/engines/pgBoss/navigation';
import { PgBossJobPage } from '../../src/engines/pgBoss/pages/PgBossJobPage';
import { BoardNavigationContext } from '../../src/hooks/useBoardNavigation';
import { useSettingsStore } from '../../src/hooks/useSettings';
import {
  createPgBossWrapper,
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
    confirmJobActions: false,
    useCollapsibleJson: false,
  });
});

function renderPage(job = makePgBossJob(), overrides = {}) {
  const pgBossApi = mockPgBossApi({ getJob: jest.fn(async () => ({ job })), ...overrides });
  const history = createMemoryHistory({
    initialEntries: [`/queue/${job.queueName}/${job.id}?state=${job.state}`],
  });
  const { Wrapper } = createPgBossWrapper({ pgBossApi, history });
  const utils = render(
    <Route path="/queue/:name/:jobId">
      <PgBossJobPage />
    </Route>,
    { wrapper: Wrapper }
  );
  return { ...utils, history, pgBossApi, job };
}

it('shows the job with its data first, and its timeline', async () => {
  const { container } = renderPage();

  await screen.findByRole('tab', { name: 'PGBOSS.JOB.TABS.DATA' });
  expect(screen.getByRole('tab', { name: 'PGBOSS.JOB.TABS.DATA' }).getAttribute('data-state')).toBe(
    'active'
  );
  await waitFor(() => expect(container.textContent).toContain('ada@example.com'));
  expect(container.textContent).toContain('PGBOSS.JOB.CREATED_ON');
  expect(screen.queryByRole('tab', { name: 'PGBOSS.JOB.TABS.DEAD_LETTER' })).toBeNull();
});

it('opens a failed job on its output, rendered as the stack it failed with', async () => {
  const job = makePgBossJob({
    state: 'failed',
    output: { message: 'boom', stack: 'Error: boom\n    at handler (worker.js:1:1)' },
  });
  const { container } = renderPage(job);

  const output = await screen.findByRole('tab', { name: 'PGBOSS.JOB.TABS.OUTPUT' });
  expect(output.getAttribute('data-state')).toBe('active');
  await waitFor(() => expect(container.textContent).toContain('at handler (worker.js:1:1)'));
});

it('lists the jobs a job waits on as links', async () => {
  const dependency = { queueName: 'imports', id: '00000000-0000-4000-8000-0000000000aa' };
  const { pgBossApi, job } = renderPage(makePgBossJob({ pendingDependencies: 1 }), {
    getDependencies: jest.fn(async () => ({ dependencies: [dependency], dependents: [] })),
  });

  const tab = await screen.findByRole('tab', { name: 'PGBOSS.JOB.TABS.DEPENDENCIES' });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);

  const link = await screen.findByRole('link', { name: new RegExp(dependency.id) });
  expect(link.getAttribute('href')).toBe(`/queue/imports/${dependency.id}`);
  expect(pgBossApi.getDependencies).toHaveBeenCalledWith(job.queueName, job.id);
  expect(screen.getByText('PGBOSS.JOB.PENDING_DEPENDENCIES')).toBeTruthy();
});

it('shows where a dead-lettered job came from', async () => {
  const job = makePgBossJob({
    deadLetterSource: {
      queueName: 'emails-main',
      id: '00000000-0000-4000-8000-0000000000bb',
      createdOn: null,
      retryCount: 3,
    },
  });
  renderPage(job);

  const tab = await screen.findByRole('tab', { name: 'PGBOSS.JOB.TABS.DEAD_LETTER' });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
  expect(await screen.findByRole('link', { name: 'emails-main' })).toBeTruthy();
});

it('goes back to the queue once the job is deleted', async () => {
  const job = makePgBossJob({ state: 'completed' });
  const { history, pgBossApi } = renderPage(job);

  fireEvent.click(await screen.findByRole('button', { name: 'PGBOSS.ACTIONS.DELETE.LABEL' }));

  await waitFor(() =>
    expect(pgBossApi.jobCommand).toHaveBeenCalledWith('delete', job.queueName, job.id)
  );
  await waitFor(() => expect(history.location.pathname).toBe(`/queue/${job.queueName}`));
  expect(history.location.search).toBe('?state=completed');
});

it('says the job is gone when it no longer exists', async () => {
  const job = makePgBossJob();
  const { container } = renderPage(job, {
    getJob: jest.fn(async () => ({ error: { key: 'ERRORS.JOB_NOT_FOUND' } })),
  });

  await waitFor(() => expect(container.textContent).toContain('JOB.NOT_FOUND'));
});

describe('breadcrumb', () => {
  const realMatchMedia = window.matchMedia;
  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });

  const setMobile = (matches: boolean) => {
    window.matchMedia = ((query: string) => ({
      ...realMatchMedia(query),
      matches,
    })) as typeof window.matchMedia;
  };

  // The header and the page together, the way the shell lays them out.
  const Shell = () => (
    <BoardNavigationContext.Provider value={usePgBossNavigation()}>
      <Title />
      <Route path="/queue/:name/:jobId">
        <PgBossJobPage />
      </Route>
    </BoardNavigationContext.Provider>
  );

  function renderShell() {
    const job = makePgBossJob({ state: 'failed' });
    const pgBossApi = mockPgBossApi({
      getJob: jest.fn(async () => ({ job })),
      getQueues: jest.fn(async () => ({ queues: [makePgBossQueue(job.queueName)] })),
    });
    const history = createMemoryHistory({
      initialEntries: [`/queue/${job.queueName}/${job.id}?state=failed`],
    });
    const { Wrapper } = createPgBossWrapper({ pgBossApi, history });
    render(<Shell />, { wrapper: Wrapper });
    return { job };
  }

  it('shows one breadcrumb, the header one, whose queue crumb goes back to the same state', async () => {
    setMobile(false);
    const { job } = renderShell();

    await screen.findByRole('tab', { name: 'PGBOSS.JOB.TABS.OUTPUT' });
    const back = await screen.findByRole('link', { name: job.queueName });
    expect(back.getAttribute('href')).toBe(`/queue/${job.queueName}?state=failed`);
    expect(screen.getAllByRole('navigation', { name: /breadcrumb/i })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: job.queueName })).toHaveLength(1);
  });

  it('draws its own way back to the queue on a phone, where the header has no breadcrumb', async () => {
    setMobile(true);
    const { job } = renderShell();

    await screen.findByRole('tab', { name: 'PGBOSS.JOB.TABS.OUTPUT' });
    expect(screen.getAllByRole('navigation', { name: /breadcrumb/i })).toHaveLength(1);
    const back = screen.getByRole('link', { name: job.queueName });
    expect(back.getAttribute('href')).toBe(`/queue/${job.queueName}?state=failed`);
  });
});
