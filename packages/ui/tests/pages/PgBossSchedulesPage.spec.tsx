import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createMemoryHistory } from 'history';
import { PgBossSchedulesPage } from '../../src/engines/pgBoss/pages/PgBossSchedulesPage';
import { useSettingsStore } from '../../src/hooks/useSettings';
import {
  createPgBossWrapper,
  makePgBossInfo,
  makePgBossQueue,
  makePgBossSchedule,
  mockPgBossApi,
} from '../PgBossTestUtils';
import { render } from '../testUtils';

jest.mock('../../src/components/JsonEditor/JsonEditor', () => ({
  JsonEditor: ({ doc, name, id }: { doc: unknown; name: string; id: string }) => (
    <input type="hidden" id={id} name={name} defaultValue={JSON.stringify(doc)} />
  ),
}));

beforeEach(() => {
  useSettingsStore.setState({ pollingInterval: 0, confirmJobActions: false });
});

const nightly = makePgBossSchedule({
  queueName: 'reports',
  key: 'nightly',
  expression: '0 3 * * *',
  timezone: 'Europe/Lisbon',
  nextRuns: [new Date(Date.now() + 3_600_000).toISOString()],
  lastJobId: '00000000-0000-4000-8000-0000000000cc',
  data: { report: 'daily' },
  options: { priority: 5, missed: 'once' },
});

function renderPage(overrides = {}, entry = '/job-schedulers') {
  const pgBossApi = mockPgBossApi({
    getQueues: jest.fn(async () => ({ queues: [makePgBossQueue('reports')] })),
    getSchedules: jest.fn(async () => ({ schedules: [nightly] })),
    ...overrides,
  });
  const history = createMemoryHistory({ initialEntries: [entry] });
  const { Wrapper } = createPgBossWrapper({ pgBossApi, history });
  return { ...render(<PgBossSchedulesPage />, { wrapper: Wrapper }), pgBossApi, history };
}

it('lists each schedule with its expression, time zone and last job', async () => {
  const { container } = renderPage();

  const row = (await screen.findByText('0 3 * * *')).closest('tr')!;
  expect(row.textContent).toContain('nightly');
  expect(row.textContent).toContain('Europe/Lisbon');
  expect(row.textContent).toContain('PGBOSS.SCHEDULES.KIND_CRON');
  expect(within(row).getByRole('link', { name: '00000000' }).getAttribute('href')).toBe(
    `/queue/reports/${nightly.lastJobId}`
  );
  expect(container.textContent).not.toContain('PGBOSS.SCHEDULES.NO_NEXT_RUNS');
});

it('asks the server for one queue when the URL filters by it', async () => {
  const { pgBossApi } = renderPage({}, '/job-schedulers?queueName=reports');

  await screen.findByText('0 3 * * *');
  expect(pgBossApi.getSchedules).toHaveBeenCalledWith('reports');
});

it('sends a job from the template when run now', async () => {
  const { pgBossApi } = renderPage();

  fireEvent.click(await screen.findByRole('button', { name: 'PGBOSS.SCHEDULES.RUN_NOW' }));

  await waitFor(() =>
    expect(pgBossApi.sendJob).toHaveBeenCalledWith('reports', {
      data: { report: 'daily' },
      options: { priority: 5 },
    })
  );
});

it('edits a schedule, keeping its queue and key', async () => {
  const { pgBossApi } = renderPage();

  fireEvent.click(await screen.findByRole('button', { name: 'PGBOSS.SCHEDULES.EDIT' }));
  const expression = await screen.findByLabelText('PGBOSS.SCHEDULES.EXPRESSION');
  expect((screen.getByLabelText('PGBOSS.SCHEDULES.KEY') as HTMLInputElement).disabled).toBe(true);
  fireEvent.change(expression, { target: { value: '*/5 * * * *' } });
  fireEvent.click(screen.getByRole('button', { name: 'PGBOSS.SCHEDULES.SAVE' }));

  await waitFor(() =>
    expect(pgBossApi.upsertSchedule).toHaveBeenCalledWith('reports', {
      key: 'nightly',
      cron: '*/5 * * * *',
      tz: 'Europe/Lisbon',
      data: { report: 'daily' },
      options: { priority: 5 },
      missed: 'once',
    })
  );
});

it('previews the next runs of an expression', async () => {
  const run = '2026-06-01T03:00:00.000Z';
  const { pgBossApi } = renderPage({ previewSchedule: jest.fn(async () => ({ runs: [run] })) });

  fireEvent.click(await screen.findByRole('button', { name: /PGBOSS.SCHEDULES.CREATE/ }));
  fireEvent.change(await screen.findByLabelText('PGBOSS.SCHEDULES.EXPRESSION'), {
    target: { value: '0 3 * * *' },
  });
  fireEvent.click(screen.getByRole('button', { name: /PGBOSS.SCHEDULES.PREVIEW/ }));

  await waitFor(() =>
    expect(pgBossApi.previewSchedule).toHaveBeenCalledWith({
      expression: '0 3 * * *',
      tz: undefined,
    })
  );
  expect((await screen.findByRole('status')).textContent).toContain('PGBOSS.SCHEDULES.NEXT_RUNS');
});

it('confirms before removing a schedule', async () => {
  const { pgBossApi } = renderPage();

  fireEvent.click(await screen.findByRole('button', { name: 'PGBOSS.SCHEDULES.REMOVE' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog.textContent).toContain('PGBOSS.SCHEDULES.REMOVE_CONFIRM');
  fireEvent.click(within(dialog).getByRole('button', { name: 'CONFIRM.CONFIRM_BTN' }));

  await waitFor(() => expect(pgBossApi.removeSchedule).toHaveBeenCalledWith('reports', 'nightly'));
});

it('offers no writes on a board that cannot write', async () => {
  renderPage({ getInfo: jest.fn(async () => makePgBossInfo({ writable: false })) });

  await screen.findByText('0 3 * * *');
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'PGBOSS.SCHEDULES.EDIT' })).toBeNull()
  );
  expect(screen.queryByRole('button', { name: 'PGBOSS.SCHEDULES.RUN_NOW' })).toBeNull();
  expect(screen.queryByRole('button', { name: /PGBOSS.SCHEDULES.CREATE/ })).toBeNull();
});

it('shows the empty state without schedules', async () => {
  const { container } = renderPage({ getSchedules: jest.fn(async () => ({ schedules: [] })) });

  await waitFor(() => expect(container.textContent).toContain('PGBOSS.SCHEDULES.EMPTY'));
});
