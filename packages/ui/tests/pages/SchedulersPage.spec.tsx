import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { AppJobScheduler } from '@worker-manager/api/typings/app';
import type {
  GetJobSchedulersResponse,
  GetQueuesResponse,
} from '@worker-manager/api/typings/responses';
import { createMemoryHistory } from 'history';
import { useSettingsStore } from '../../src/hooks/useSettings';
import { SchedulersPage } from '../../src/pages/SchedulersPage/SchedulersPage';
import { createWrapper, makeQueue, render } from '../testUtils';

beforeEach(() => {
  useSettingsStore.setState({
    pollingInterval: 0,
    jobsPerPage: 10,
    confirmQueueActions: false,
  });
});

function makeScheduler(overrides: Partial<AppJobScheduler> = {}): AppJobScheduler {
  return {
    id: 'daily-report',
    queueName: 'reports',
    name: 'report',
    pattern: '0 3 * * *',
    next: Date.now() + 60_000,
    iterationCount: 4,
    ...overrides,
  };
}

function renderPage({
  schedulers = [makeScheduler()],
  queues = [makeQueue('reports')],
  path = '/job-schedulers',
  api: apiOverrides = {},
}: {
  schedulers?: AppJobScheduler[];
  queues?: ReturnType<typeof makeQueue>[];
  path?: string;
  api?: Record<string, unknown>;
} = {}) {
  const getJobSchedulers = jest.fn(() => Promise.resolve<GetJobSchedulersResponse>({ schedulers }));
  const getQueues = jest.fn(() => Promise.resolve<GetQueuesResponse>({ queues }));
  const history = createMemoryHistory({ initialEntries: [path] });
  const { Wrapper } = createWrapper({
    api: { getJobSchedulers, getQueues, ...apiOverrides },
    history,
  });

  render(<SchedulersPage />, { wrapper: Wrapper });

  return { getJobSchedulers, getQueues, history };
}

it('lists a scheduler with its schedule, queue and run count', async () => {
  renderPage();

  expect(await screen.findByText('daily-report')).toBeTruthy();
  expect(screen.getByText('0 3 * * *')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'reports' }).getAttribute('href')).toContain(
    '/queue/reports'
  );
  expect(screen.getByText('4')).toBeTruthy();
});

it('asks the API only for the queue named in the URL', async () => {
  const { getJobSchedulers } = renderPage({ path: '/job-schedulers?queueName=reports' });

  await waitFor(() => expect(getJobSchedulers).toHaveBeenCalledWith('reports'));
});

it('shows an empty state when nothing is scheduled', async () => {
  renderPage({ schedulers: [] });

  expect(await screen.findByText('SCHEDULERS.EMPTY')).toBeTruthy();
});

it('offers editing and removal for a writable BullMQ queue', async () => {
  renderPage();

  expect(await screen.findByLabelText('SCHEDULERS.ACTIONS.EDIT')).toBeTruthy();
  expect(screen.getByLabelText('SCHEDULERS.ACTIONS.REMOVE')).toBeTruthy();
});

it('hides editing for a legacy Bull queue, which has no upsert', async () => {
  renderPage({
    schedulers: [makeScheduler({ queueName: 'legacy' })],
    queues: [makeQueue('legacy', { type: 'bull' })],
  });

  expect(await screen.findByLabelText('SCHEDULERS.ACTIONS.REMOVE')).toBeTruthy();
  expect(screen.queryByLabelText('SCHEDULERS.ACTIONS.EDIT')).toBeNull();
});

it('hides both actions on a read only queue', async () => {
  renderPage({
    schedulers: [makeScheduler({ queueName: 'frozen' })],
    queues: [makeQueue('frozen', { readOnlyMode: true })],
  });

  await screen.findByText('daily-report');
  expect(screen.queryByLabelText('SCHEDULERS.ACTIONS.EDIT')).toBeNull();
  expect(screen.queryByLabelText('SCHEDULERS.ACTIONS.REMOVE')).toBeNull();
});

it('sends the edited schedule and keeps the scheduler it belongs to', async () => {
  const updateJobScheduler = jest.fn(() => Promise.resolve());
  renderPage({ api: { updateJobScheduler } });

  fireEvent.click(await screen.findByLabelText('SCHEDULERS.ACTIONS.EDIT'));

  const pattern = await screen.findByLabelText('SCHEDULERS.EDIT.PATTERN');
  fireEvent.change(pattern, { target: { value: '0 5 * * *' } });
  fireEvent.submit(pattern.closest('form') as HTMLFormElement);

  await waitFor(() =>
    expect(updateJobScheduler).toHaveBeenCalledWith('reports', 'daily-report', {
      pattern: '0 5 * * *',
    })
  );
});

it('removes a scheduler and refreshes the listing', async () => {
  const removeJobScheduler = jest.fn(() => Promise.resolve());
  const { getJobSchedulers } = renderPage({ api: { removeJobScheduler } });

  fireEvent.click(await screen.findByLabelText('SCHEDULERS.ACTIONS.REMOVE'));

  await waitFor(() => expect(removeJobScheduler).toHaveBeenCalledWith('reports', 'daily-report'));
  // The listing is invalidated afterwards, so what is on screen reflects the removal.
  await waitFor(() => expect(getJobSchedulers).toHaveBeenCalledTimes(2));
});

it('keeps the edit form open when the server refuses the schedule', async () => {
  const updateJobScheduler = jest.fn(() =>
    Promise.resolve({ error: { key: 'ERRORS.INVALID_SCHEDULER_PATTERN' } })
  );
  renderPage({ api: { updateJobScheduler } });

  fireEvent.click(await screen.findByLabelText('SCHEDULERS.ACTIONS.EDIT'));

  const pattern = await screen.findByLabelText('SCHEDULERS.EDIT.PATTERN');
  fireEvent.change(pattern, { target: { value: 'not a cron' } });
  fireEvent.submit(pattern.closest('form') as HTMLFormElement);

  await waitFor(() => expect(updateJobScheduler).toHaveBeenCalled());
  // The refused value is still there to correct.
  expect((screen.getByLabelText('SCHEDULERS.EDIT.PATTERN') as HTMLInputElement).value).toBe(
    'not a cron'
  );
});

it('links a run to its job, and only when there is a job to open', async () => {
  renderPage({
    schedulers: [
      makeScheduler({
        lastRun: Date.now() - 60_000,
        nextRunJobId: 'repeat:daily-report:1785258020382',
        // The previous run was trimmed away by removeOnComplete, so it cannot be linked.
        lastRunJobId: undefined,
      }),
    ],
  });

  await screen.findByText('daily-report');

  const jobHref = `/queue/reports/${encodeURIComponent('repeat:daily-report:1785258020382')}`;
  const linkedToJob = screen
    .getAllByRole('link')
    .filter((link) => link.getAttribute('href') === jobHref);

  // Exactly one: the next run. The last run has a time but no job left to open.
  expect(linkedToJob).toHaveLength(1);

  const [, , , , , lastRunCell] = screen.getAllByRole('cell');
  expect(within(lastRunCell).queryByRole('link')).toBeNull();
});

it('shows the last run only when the scheduler has one', async () => {
  renderPage({
    schedulers: [
      makeScheduler({ id: 'has-run', lastRun: Date.now() - 60_000 }),
      makeScheduler({ id: 'never-ran', iterationCount: 1 }),
    ],
  });

  await screen.findByText('has-run');

  const [hasRun, neverRan] = screen.getAllByRole('row').slice(1);
  // A scheduler that has not fired yet leaves the last run cell empty.
  expect(within(hasRun).queryByText('-')).toBeNull();
  expect(within(neverRan).getByText('-')).toBeTruthy();
});

describe('timeline view', () => {
  beforeEach(() => {
    useSettingsStore.setState({ schedulersView: 'table', schedulersTimelineZoom: 'day' });
  });

  it('switches to the timeline with the view toggle and remembers the choice', async () => {
    renderPage();

    await screen.findByText('daily-report');
    const toggle = screen.getByRole('radiogroup', { name: 'SCHEDULERS.VIEW.LABEL' });
    fireEvent.click(within(toggle).getByRole('radio', { name: /SCHEDULERS.VIEW.TIMELINE/ }));

    expect(await screen.findByRole('region', { name: 'SCHEDULERS.TIMELINE.LABEL' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(useSettingsStore.getState().schedulersView).toBe('timeline');
  });

  it('draws a row per scheduler, grouped by queue, with its next run and the zoom control', async () => {
    useSettingsStore.setState({ schedulersView: 'timeline' });
    renderPage({
      schedulers: [
        makeScheduler({
          id: 'hourly',
          every: 60 * 60_000,
          pattern: undefined,
          next: Date.now() + 60_000,
        }),
        makeScheduler({ id: 'nightly', pattern: '0 3 * * *', tz: 'UTC' }),
      ],
    });

    const timeline = await screen.findByRole('region', { name: 'SCHEDULERS.TIMELINE.LABEL' });
    expect(within(timeline).getByRole('group')).toBeTruthy();
    expect(within(timeline).getByText('hourly')).toBeTruthy();
    expect(within(timeline).getByText('nightly')).toBeTruthy();
    expect(timeline.querySelectorAll('[data-run=next]')).toHaveLength(2);
    expect(within(timeline).getByText('SCHEDULERS.TIMELINE.NOW')).toBeTruthy();

    const zoom = screen.getByRole('group', { name: 'SCHEDULERS.TIMELINE.ZOOM' });
    fireEvent.click(within(zoom).getByRole('button', { name: 'SCHEDULERS.TIMELINE.ZOOM_WEEK' }));
    expect(useSettingsStore.getState().schedulersTimelineZoom).toBe('week');
  });

  it('flags two schedulers starting in the same minute', async () => {
    useSettingsStore.setState({ schedulersView: 'timeline' });
    const next = Math.ceil((Date.now() + 60 * 60_000) / 60_000) * 60_000;
    renderPage({
      schedulers: [
        makeScheduler({ id: 'first', pattern: undefined, every: 6 * 60 * 60_000, next }),
        makeScheduler({ id: 'second', pattern: undefined, every: 12 * 60 * 60_000, next }),
      ],
    });

    const timeline = await screen.findByRole('region', { name: 'SCHEDULERS.TIMELINE.LABEL' });
    expect(within(timeline).getByText('SCHEDULERS.TIMELINE.OVERLAPS')).toBeTruthy();
    expect(timeline.querySelector('[data-lane=overlaps] [data-slot=gantt-point]')).toBeTruthy();
  });

  it('opens the edit form from a row, as the table does', async () => {
    useSettingsStore.setState({ schedulersView: 'timeline' });
    renderPage();

    const row = await screen.findByRole('button', { name: 'SCHEDULERS.TIMELINE.ROW_LABEL' });
    fireEvent.click(row);

    expect(await screen.findByLabelText('SCHEDULERS.EDIT.PATTERN')).toBeTruthy();
  });

  it('shows the timeline skeleton while the schedulers load', () => {
    useSettingsStore.setState({ schedulersView: 'timeline' });
    renderPage({ api: { getJobSchedulers: jest.fn(() => new Promise(() => {})) } });

    expect(screen.getByTestId('schedulers-timeline-skeleton')).toBeTruthy();
  });
});
