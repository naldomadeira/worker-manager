import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createMemoryHistory } from 'history';
import { PgBossRecentWarnings } from '../../src/engines/pgBoss/components/PgBossRecentWarnings';
import { PgBossWarningsPage } from '../../src/engines/pgBoss/pages/PgBossWarningsPage';
import { useSettingsStore } from '../../src/hooks/useSettings';
import {
  createPgBossWrapper,
  makePgBossInfo,
  makePgBossWarning,
  mockPgBossApi,
} from '../PgBossTestUtils';
import { render } from '../testUtils';

beforeEach(() => {
  useSettingsStore.setState({ pollingInterval: 0 });
});

function renderPage(pgBossApi = mockPgBossApi(), entry = '/warnings') {
  const history = createMemoryHistory({ initialEntries: [entry] });
  const { Wrapper } = createPgBossWrapper({ pgBossApi, history });
  return { ...render(<PgBossWarningsPage />, { wrapper: Wrapper }), history, pgBossApi };
}

const backlog = makePgBossWarning();
const slow = makePgBossWarning({
  type: 'slow_query',
  message: 'Warning: slow query',
  data: { elapsed: 31, sql: 'SELECT 1' },
  queueName: null,
});
const future = makePgBossWarning({
  type: 'shiny_new_type',
  message: 'Something new',
  data: null,
  queueName: null,
});

it('lists warnings with their type, queue and message, and links the queue', async () => {
  const pgBossApi = mockPgBossApi({
    getWarnings: jest.fn(async () => ({
      warnings: [backlog, slow, future],
      nextCursor: null,
      prevCursor: null,
    })),
  });
  const { container } = renderPage(pgBossApi);

  await waitFor(() => expect(container.querySelectorAll('[data-warning-type]').length).toBe(3));
  expect(pgBossApi.getWarnings).toHaveBeenCalledWith({ limit: 25 });
  const row = within(container.querySelector('[data-warning-type="queue_backlog"]') as HTMLElement);
  expect(row.getByText('PGBOSS.WARNINGS.TYPE.QUEUE_BACKLOG')).toBeTruthy();
  expect(row.getByRole('link', { name: 'emails' }).getAttribute('href')).toBe('/queue/emails');
  expect(row.getByText(backlog.message)).toBeTruthy();
  // A type pg-boss adds later still shows, under its own name.
  expect(screen.getByText('shiny_new_type')).toBeTruthy();
});

it('opens the details of a warning that has any', async () => {
  const pgBossApi = mockPgBossApi({
    getWarnings: jest.fn(async () => ({
      warnings: [slow, future],
      nextCursor: null,
      prevCursor: null,
    })),
  });
  const { container } = renderPage(pgBossApi);

  const [details] = await screen.findAllByRole('button', { name: 'PGBOSS.WARNINGS.DETAILS' });
  expect(screen.getAllByRole('button', { name: 'PGBOSS.WARNINGS.DETAILS' })).toHaveLength(1);
  fireEvent.click(details);
  await waitFor(() => expect(container.textContent).toContain('SELECT 1'));
});

it('filters by type and pages by cursor through the URL', async () => {
  const pgBossApi = mockPgBossApi({
    getWarnings: jest.fn(async () => ({
      warnings: [slow],
      nextCursor: 'older-1',
      prevCursor: null,
    })),
  });
  const { history } = renderPage(pgBossApi, '/warnings?type=slow_query');

  await waitFor(() =>
    expect(pgBossApi.getWarnings).toHaveBeenCalledWith({ type: 'slow_query', limit: 25 })
  );
  fireEvent.click(await screen.findByRole('button', { name: /PGBOSS.PAGINATION.NEXT/ }));
  await waitFor(() => expect(history.location.search).toBe('?type=slow_query&cursor=older-1'));
  await waitFor(() =>
    expect(pgBossApi.getWarnings).toHaveBeenLastCalledWith({
      type: 'slow_query',
      cursor: 'older-1',
      limit: 25,
    })
  );
  expect(screen.getByRole('navigation', { name: 'PGBOSS.WARNINGS.PAGES' })).toBeTruthy();
});

it('explains how to turn warnings on when there are none', async () => {
  const { container } = renderPage();

  await waitFor(() => expect(container.textContent).toContain('PGBOSS.WARNINGS.EMPTY'));
  expect(container.textContent).toContain('PGBOSS.WARNINGS.EMPTY_HINT');
});

it('says so when a type filter leaves nothing', async () => {
  const { container } = renderPage(mockPgBossApi(), '/warnings?type=clock_skew');

  await waitFor(() => expect(container.textContent).toContain('PGBOSS.WARNINGS.EMPTY_FILTERED'));
});

it('asks nothing of a schema without the warning table', async () => {
  const pgBossApi = mockPgBossApi({
    getInfo: jest.fn(async () =>
      makePgBossInfo({
        features: { ...makePgBossInfo().features, warnings: false },
        disabledFeatures: ['warnings'],
      })
    ),
  });
  const { container } = renderPage(pgBossApi);

  await waitFor(() => expect(container.textContent).toContain('PGBOSS.WARNINGS.DISABLED'));
  expect(pgBossApi.getWarnings).not.toHaveBeenCalled();
});

it('shows the load error with a retry', async () => {
  const pgBossApi = mockPgBossApi({
    getWarnings: jest.fn(async () => ({ error: { key: 'ERRORS.PGBOSS_QUERY_TIMEOUT' } })),
  });
  renderPage(pgBossApi);

  expect(await screen.findByRole('button', { name: /retry/i })).toBeTruthy();
});

describe('the recent warnings card', () => {
  const renderCard = (pgBossApi = mockPgBossApi(), info = makePgBossInfo()) => {
    const { Wrapper } = createPgBossWrapper({ pgBossApi });
    return render(<PgBossRecentWarnings info={info} />, { wrapper: Wrapper });
  };

  it('shows the newest five with the way to the full list', async () => {
    const pgBossApi = mockPgBossApi({
      getWarnings: jest.fn(async () => ({
        warnings: [backlog],
        nextCursor: null,
        prevCursor: null,
      })),
    });
    const { container } = renderCard(pgBossApi);

    await waitFor(() => expect(container.querySelector('[data-warning-type]')).toBeTruthy());
    expect(pgBossApi.getWarnings).toHaveBeenCalledWith({ limit: 5 });
    expect(
      screen.getByRole('link', { name: /PGBOSS.WARNINGS.VIEW_ALL/ }).getAttribute('href')
    ).toBe('/warnings');
  });

  it('says there are none, and is not drawn for a schema without the table', async () => {
    const { container } = renderCard();
    await waitFor(() => expect(container.textContent).toContain('PGBOSS.WARNINGS.EMPTY'));

    const pgBossApi = mockPgBossApi();
    const hidden = renderCard(
      pgBossApi,
      makePgBossInfo({ features: { ...makePgBossInfo().features, warnings: false } })
    );
    expect(hidden.container.querySelector('[data-testid="pgboss-recent-warnings"]')).toBeNull();
    expect(pgBossApi.getWarnings).not.toHaveBeenCalled();
  });
});
