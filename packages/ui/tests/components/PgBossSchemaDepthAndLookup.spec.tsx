import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createMemoryHistory } from 'history';
import {
  CommandPalette,
  useCommandPalette,
} from '../../src/components/CommandPalette/CommandPalette';
import { Menu } from '../../src/components/Menu/Menu';
import { Title } from '../../src/components/Title/Title';
import { SidebarProvider } from '../../src/components/ui/sidebar';
import { PgBossFindJobForm } from '../../src/engines/pgBoss/components/PgBossFindJobForm';
import { PgBossQueueDepthCard } from '../../src/engines/pgBoss/components/PgBossQueueDepthCard';
import { PgBossSchemaBanner } from '../../src/engines/pgBoss/components/PgBossSchemaBanner';
import { usePgBossNavigation } from '../../src/engines/pgBoss/navigation';
import { BoardNavigationContext } from '../../src/hooks/useBoardNavigation';
import { useMenuState } from '../../src/hooks/useMenuState';
import { useSettingsStore } from '../../src/hooks/useSettings';
import {
  createPgBossWrapper,
  makePgBossInfo,
  makePgBossJob,
  makePgBossQueue,
  mockPgBossApi,
} from '../PgBossTestUtils';
import { render } from '../testUtils';

const JOB_ID = '5b2a4f1e-9c0d-4e8f-a1b2-c3d4e5f60718';

beforeEach(() => {
  useSettingsStore.setState({ pollingInterval: 0, sortQueues: false, sidebarCollapsed: false });
  useMenuState.setState({ state: {} });
  useCommandPalette.setState({ open: false });
});

describe('the schema banner', () => {
  const renderBanner = (info: ReturnType<typeof makePgBossInfo>) => {
    const { Wrapper } = createPgBossWrapper({ pgBossApi: mockPgBossApi() });
    return render(<PgBossSchemaBanner info={info} />, { wrapper: Wrapper });
  };

  it('stays away on a tested schema that has everything', () => {
    const { container } = renderBanner(makePgBossInfo());
    expect(container.querySelector('[data-testid="pgboss-schema-banner"]')).toBeNull();
  });

  it('says a newer schema is untested and names what it turned off', () => {
    renderBanner(
      makePgBossInfo({
        schemaVersion: 43,
        untested: true,
        disabledFeatures: ['queueDepth', 'warnings'],
      })
    );

    const banner = screen.getByTestId('pgboss-schema-banner');
    expect(banner.textContent).toContain('PGBOSS.BANNER.UNTESTED_SCHEMA');
    expect(banner.textContent).toContain('PGBOSS.BANNER.UNTESTED_HINT');
    expect(banner.textContent).toContain('PGBOSS.BANNER.FEATURES_DISABLED');
  });

  it('reports missing parts of a schema inside the tested range', () => {
    renderBanner(makePgBossInfo({ disabledFeatures: ['dependencies'] }));

    const banner = screen.getByTestId('pgboss-schema-banner');
    expect(banner.textContent).toContain('PGBOSS.BANNER.MISSING_FEATURES');
    expect(banner.textContent).not.toContain('PGBOSS.BANNER.UNTESTED_HINT');
  });
});

describe('the queue depth card', () => {
  const renderCard = (
    pgBossApi = mockPgBossApi(),
    info = makePgBossInfo({ persistQueueStats: true })
  ) => {
    const { Wrapper } = createPgBossWrapper({ pgBossApi });
    return render(<PgBossQueueDepthCard queueName="emails" info={info} />, { wrapper: Wrapper });
  };

  it('charts the last 24 hours by default and changes range on demand', async () => {
    const now = Date.now();
    const pgBossApi = mockPgBossApi({
      getQueueDepth: jest.fn(async (_name: string, range: string) => ({
        points: [
          { ts: now - 60_000, deferred: 0, queued: 4, ready: 3, active: 1, failed: 0, total: 5 },
        ],
        from: now - (range === '1h' ? 3_600_000 : 86_400_000),
        to: now,
        bucketSeconds: 900,
      })),
    });
    const { container } = renderCard(pgBossApi);

    await waitFor(() => expect(container.textContent).toContain('PGBOSS.KPI.READY'));
    expect(pgBossApi.getQueueDepth).toHaveBeenCalledWith('emails', '24h');
    fireEvent.click(screen.getByRole('button', { name: 'PGBOSS.DEPTH.RANGE_1H' }));
    await waitFor(() => expect(pgBossApi.getQueueDepth).toHaveBeenCalledWith('emails', '1h'));
  });

  it('says the window is empty', async () => {
    const { container } = renderCard();
    await waitFor(() => expect(container.textContent).toContain('PGBOSS.DEPTH.EMPTY'));
  });

  it('explains persistQueueStats before anything was ever recorded, and asks nothing', async () => {
    const pgBossApi = mockPgBossApi();
    const { container } = renderCard(pgBossApi, makePgBossInfo({ persistQueueStats: false }));

    expect(container.textContent).toContain('PGBOSS.DEPTH.NEVER');
    expect(container.textContent).toContain('PGBOSS.DEPTH.NEVER_HINT');
    expect(pgBossApi.getQueueDepth).not.toHaveBeenCalled();
  });

  it('says a schema without queue_stats has no history', () => {
    const pgBossApi = mockPgBossApi();
    const { container } = renderCard(
      pgBossApi,
      makePgBossInfo({ features: { ...makePgBossInfo().features, queueDepth: false } })
    );

    expect(container.textContent).toContain('PGBOSS.DEPTH.DISABLED');
    expect(pgBossApi.getQueueDepth).not.toHaveBeenCalled();
  });
});

describe('opening a job by id', () => {
  it('opens the job from the overview search box, and refuses what is not a UUID', async () => {
    const job = makePgBossJob({ id: JOB_ID, queueName: 'reports', state: 'failed' });
    const pgBossApi = mockPgBossApi({ findJob: jest.fn(async () => ({ job })) });
    const history = createMemoryHistory({ initialEntries: ['/'] });
    const { Wrapper } = createPgBossWrapper({ pgBossApi, history });
    render(<PgBossFindJobForm />, { wrapper: Wrapper });

    const input = screen.getByRole('textbox', { name: 'PGBOSS.FIND.LABEL' });
    fireEvent.change(input, { target: { value: 'not-an-id' } });
    fireEvent.click(screen.getByRole('button', { name: /PGBOSS.FIND.SUBMIT/ }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(pgBossApi.findJob).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: ` ${JOB_ID} ` } });
    fireEvent.click(screen.getByRole('button', { name: /PGBOSS.FIND.SUBMIT/ }));
    await waitFor(() => expect(pgBossApi.findJob).toHaveBeenCalledWith(JOB_ID));
    await waitFor(() => expect(history.location.pathname).toBe(`/queue/reports/${JOB_ID}`));
    expect(history.location.search).toBe('?state=failed');
  });

  it('stays put when no visible queue has the job', async () => {
    const pgBossApi = mockPgBossApi();
    const history = createMemoryHistory({ initialEntries: ['/'] });
    const { Wrapper } = createPgBossWrapper({ pgBossApi, history });
    render(<PgBossFindJobForm />, { wrapper: Wrapper });

    fireEvent.change(screen.getByRole('textbox', { name: 'PGBOSS.FIND.LABEL' }), {
      target: { value: JOB_ID },
    });
    fireEvent.click(screen.getByRole('button', { name: /PGBOSS.FIND.SUBMIT/ }));

    await waitFor(() => expect(pgBossApi.findJob).toHaveBeenCalled());
    expect(history.location.pathname).toBe('/');
  });
});

describe('the pg-boss shell', () => {
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

  const renderShell = (overrides = {}, path = '/') => {
    const pgBossApi = mockPgBossApi({
      getQueues: jest.fn(async () => ({ queues: [makePgBossQueue('emails')] })),
      ...overrides,
    });
    const history = createMemoryHistory({ initialEntries: [path] });
    const { Wrapper } = createPgBossWrapper({ pgBossApi, history });
    render(<Shell />, { wrapper: Wrapper });
    return { pgBossApi, history };
  };

  it('offers the warnings page in the sidebar and the command palette', async () => {
    renderShell();

    const link = await screen.findByRole('link', { name: 'PGBOSS.WARNINGS.TITLE' });
    expect(link.getAttribute('href')).toBe('/warnings');
    useCommandPalette.setState({ open: true });
    expect(await screen.findByRole('option', { name: /PGBOSS.WARNINGS.TITLE/ })).toBeTruthy();
  });

  it('names the warnings page in the breadcrumb', async () => {
    renderShell({}, '/warnings');

    const breadcrumb = await screen.findByRole('navigation', { name: 'HEADER.BREADCRUMB' });
    await waitFor(() => expect(within(breadcrumb).getByText('PGBOSS.WARNINGS.TITLE')).toBeTruthy());
  });

  it('leaves the warnings page out on a schema without the table', async () => {
    renderShell({
      getInfo: jest.fn(async () =>
        makePgBossInfo({ features: { ...makePgBossInfo().features, warnings: false } })
      ),
    });

    await screen.findByRole('link', { name: /emails/ });
    expect(screen.queryByRole('link', { name: 'PGBOSS.WARNINGS.TITLE' })).toBeNull();
  });

  it('offers to open a pasted job id from the command palette', async () => {
    const job = makePgBossJob({ id: JOB_ID, queueName: 'emails', state: 'created' });
    const { pgBossApi, history } = renderShell({ findJob: jest.fn(async () => ({ job })) });
    await screen.findByRole('link', { name: /emails/ });

    useCommandPalette.setState({ open: true });
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByRole('combobox');
    expect(within(dialog).queryByRole('option', { name: /PGBOSS.FIND.OPEN_JOB/ })).toBeNull();

    fireEvent.change(input, { target: { value: JOB_ID } });
    const option = await within(dialog).findByRole('option', { name: /PGBOSS.FIND.OPEN_JOB/ });
    fireEvent.click(option);

    await waitFor(() => expect(pgBossApi.findJob).toHaveBeenCalledWith(JOB_ID));
    await waitFor(() => expect(history.location.pathname).toBe(`/queue/emails/${JOB_ID}`));
    expect(useCommandPalette.getState().open).toBe(false);
  });
});
