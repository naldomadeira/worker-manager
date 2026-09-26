import { screen, waitFor, within } from '@testing-library/react';
import { createMemoryHistory } from 'history';
import {
  CommandPalette,
  useCommandPalette,
} from '../../src/components/CommandPalette/CommandPalette';
import { Menu } from '../../src/components/Menu/Menu';
import { Title } from '../../src/components/Title/Title';
import { SidebarProvider } from '../../src/components/ui/sidebar';
import { toNavQueue, usePgBossNavigation } from '../../src/engines/pgBoss/navigation';
import { BoardNavigationContext } from '../../src/hooks/useBoardNavigation';
import { useMenuState } from '../../src/hooks/useMenuState';
import { useSettingsStore } from '../../src/hooks/useSettings';
import {
  createPgBossWrapper,
  makePgBossInfo,
  makePgBossQueue,
  mockPgBossApi,
} from '../PgBossTestUtils';
import { render } from '../testUtils';

beforeEach(() => {
  useSettingsStore.setState({ pollingInterval: 0, sortQueues: false, sidebarCollapsed: false });
  useMenuState.setState({ state: {} });
  useCommandPalette.setState({ open: false });
});

const Shell = () => {
  const navigation = usePgBossNavigation();
  return (
    <BoardNavigationContext.Provider value={navigation}>
      <Title />
      <SidebarProvider>
        <Menu />
      </SidebarProvider>
      <CommandPalette />
    </BoardNavigationContext.Provider>
  );
};

function renderShell(overrides = {}, path = '/') {
  const pgBossApi = mockPgBossApi({
    getInfo: jest.fn(async () => makePgBossInfo({ delimiter: '.' })),
    getQueues: jest.fn(async () => ({
      queues: [
        makePgBossQueue('billing.invoices', {
          counts: { queued: 1, deferred: 0, ready: 1, active: 2, failed: 3, total: 12 },
        }),
        makePgBossQueue('billing.refunds'),
        makePgBossQueue('emails', { scheduleCount: 1 }),
      ],
    })),
    ...overrides,
  });
  const getQueues = jest.fn();
  const history = createMemoryHistory({ initialEntries: [path] });
  const { Wrapper } = createPgBossWrapper({ pgBossApi, api: { getQueues }, history });
  render(<Shell />, { wrapper: Wrapper });
  return { pgBossApi, getQueues };
}

it('maps a pg-boss queue onto the shell, never paused, with its cached totals', () => {
  expect(
    toNavQueue(
      makePgBossQueue('a.b', {
        counts: { queued: 1, deferred: 0, ready: 1, active: 2, failed: 3, total: 9 },
      }),
      '.'
    )
  ).toEqual({
    name: 'a.b',
    delimiter: '.',
    isPaused: false,
    counts: { active: 2, failed: 3 },
    total: 9,
  });
  expect(toNavQueue(makePgBossQueue('a.b'), '').delimiter).toBeUndefined();
});

it('fills the sidebar with pg-boss queues, grouped on the delimiter', async () => {
  const { getQueues } = renderShell();

  expect(await screen.findByRole('button', { name: /billing/ })).toBeTruthy();
  expect(await screen.findByRole('link', { name: /invoices/ })).toBeTruthy();
  expect(screen.getByRole('link', { name: /emails/ }).getAttribute('href')).toBe('/queue/emails');
  expect(screen.getByRole('link', { name: 'PGBOSS.SCHEDULES.TITLE' })).toBeTruthy();
  // The BullMQ queue list is never asked for on a pg-boss board.
  expect(getQueues).not.toHaveBeenCalled();
});

it('offers the schedules page to a board that can write, even before any schedule exists', async () => {
  renderShell({
    getQueues: jest.fn(async () => ({ queues: [makePgBossQueue('emails')] })),
  });

  expect(await screen.findByRole('link', { name: 'PGBOSS.SCHEDULES.TITLE' })).toBeTruthy();
});

it('hides the schedules page on a board without schedules that cannot write', async () => {
  renderShell({
    getInfo: jest.fn(async () => makePgBossInfo({ writable: false })),
    getQueues: jest.fn(async () => ({ queues: [makePgBossQueue('emails')] })),
  });

  await screen.findByRole('link', { name: /emails/ });
  await waitFor(() =>
    expect(screen.queryByRole('link', { name: 'PGBOSS.SCHEDULES.TITLE' })).toBeNull()
  );
});

it('lists pg-boss queues in the command palette with their totals', async () => {
  renderShell();
  await screen.findByRole('button', { name: /billing/ });

  useCommandPalette.setState({ open: true });
  const option = await screen.findByRole('option', { name: /billing.invoices/ });
  expect(option.textContent).toContain('12');
});

it("calls the schedules page by pg-boss's own term in the sidebar, breadcrumb and palette", async () => {
  renderShell({}, '/job-schedulers');

  // The sidebar entry, and the breadcrumb's current page, which is a link without an href.
  await waitFor(() =>
    expect(
      screen
        .getAllByRole('link', { name: 'PGBOSS.SCHEDULES.TITLE' })
        .map((link) => link.getAttribute('href'))
    ).toContain('/job-schedulers')
  );
  const breadcrumb = screen.getByRole('navigation', { name: 'HEADER.BREADCRUMB' });
  expect(within(breadcrumb).getByText('PGBOSS.SCHEDULES.TITLE')).toBeTruthy();

  useCommandPalette.setState({ open: true });
  expect(await screen.findByRole('option', { name: /PGBOSS.SCHEDULES.TITLE/ })).toBeTruthy();
  // BullMQ's "Job schedulers" never shows on a pg-boss board.
  expect(screen.queryByText('MENU.SCHEDULERS')).toBeNull();
});
