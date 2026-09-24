import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { GetQueuesResponse } from '@worker-manager/api/typings/responses';
import { Menu } from '../../src/components/Menu/Menu';
import { SidebarProvider } from '../../src/components/ui/sidebar';
import { useMenuState } from '../../src/hooks/useMenuState';
import { useSettingsStore } from '../../src/hooks/useSettings';
import { createWrapper, render, makeQueue } from '../testUtils';

beforeEach(() => {
  useSettingsStore.setState({
    pollingInterval: 0,
    jobsPerPage: 10,
    confirmQueueActions: false,
    sortQueues: false,
    sidebarCollapsed: false,
  });
  useMenuState.setState({ state: {} });
});

// The sidebar reads its expanded state from the shell's SidebarProvider, as it does in the app.
function renderInShell(Wrapper: ReturnType<typeof createWrapper>['Wrapper']) {
  render(
    <SidebarProvider>
      <Menu />
    </SidebarProvider>,
    { wrapper: Wrapper }
  );
}

function renderMenu(hasHistoryProvider: boolean | undefined, jobSchedulerCount = 0) {
  const getQueues = jest.fn(() =>
    Promise.resolve<GetQueuesResponse>({ queues: [makeQueue('test', { jobSchedulerCount })] })
  );

  const api = { getQueues };
  const { Wrapper } = createWrapper({
    api,
    uiConfig: hasHistoryProvider === undefined ? {} : { hasHistoryProvider },
  });
  renderInShell(Wrapper);
  return api;
}

it('renders the metrics-history nav link when hasHistoryProvider is true', async () => {
  renderMenu(true);

  const link = await screen.findByText('MENU.METRICS_HISTORY');
  expect(link.getAttribute('href')).toContain('metrics-history');
});

it('does not render the metrics-history nav link when hasHistoryProvider is false', async () => {
  renderMenu(false);

  // Wait for the queues list to settle so we're not just observing a pre-render gap.
  await waitFor(() => expect(screen.getByText('MENU.QUEUES')).toBeTruthy());
  expect(screen.queryByText('MENU.METRICS_HISTORY')).toBeNull();
});

it('does not render the metrics-history nav link when hasHistoryProvider is undefined', async () => {
  renderMenu(undefined);

  await waitFor(() => expect(screen.getByText('MENU.QUEUES')).toBeTruthy());
  expect(screen.queryByText('MENU.METRICS_HISTORY')).toBeNull();
});

it('renders the schedulers nav link once a queue has a scheduler', async () => {
  renderMenu(false, 2);

  const link = await screen.findByText('MENU.SCHEDULERS');
  expect(link.getAttribute('href')).toContain('job-schedulers');
});

it('does not render the schedulers nav link when nothing is scheduled', async () => {
  renderMenu(false, 0);

  expect(screen.queryByText('MENU.SCHEDULERS')).toBeNull();
});

it('collapses and reopens a queue group when its header is clicked', async () => {
  const getQueues = jest.fn(() =>
    Promise.resolve<GetQueuesResponse>({ queues: [makeQueue('billing.invoices')] })
  );
  const { Wrapper } = createWrapper({ api: { getQueues }, uiConfig: {} });
  renderInShell(Wrapper);

  const group = await screen.findByText('billing');
  expect(screen.queryByText('invoices')).toBeTruthy();

  fireEvent.click(group);
  await waitFor(() => expect(screen.queryByText('invoices')).toBeNull());

  fireEvent.click(screen.getByText('billing'));
  await waitFor(() => expect(screen.queryByText('invoices')).toBeTruthy());
});

it('drives expand-all and collapse-all from the current group state', async () => {
  const getQueues = jest.fn(() =>
    Promise.resolve<GetQueuesResponse>({ queues: [makeQueue('billing.invoices')] })
  );
  const { Wrapper } = createWrapper({ api: { getQueues }, uiConfig: {} });
  renderInShell(Wrapper);

  const expand = await screen.findByTitle('MENU.EXPAND_ALL');
  const collapse = screen.getByTitle('MENU.COLLAPSE_ALL');
  expect(expand.hasAttribute('disabled')).toBe(true);
  expect(collapse.hasAttribute('disabled')).toBe(false);

  fireEvent.click(collapse);
  await waitFor(() => expect(screen.queryByText('invoices')).toBeNull());
  expect(expand.hasAttribute('disabled')).toBe(false);
  expect(collapse.hasAttribute('disabled')).toBe(true);

  fireEvent.click(expand);
  await waitFor(() => expect(screen.queryByText('invoices')).toBeTruthy());
});
