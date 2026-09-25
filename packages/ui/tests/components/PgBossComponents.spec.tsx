import { fireEvent, screen, waitFor } from '@testing-library/react';
import { CursorPagination } from '../../src/engines/pgBoss/components/CursorPagination';
import { PgBossDatastoreModal } from '../../src/engines/pgBoss/components/PgBossDatastoreModal';
import { PgBossJobActions } from '../../src/engines/pgBoss/components/PgBossJobActions';
import { PgBossQueueInfoModal } from '../../src/engines/pgBoss/components/PgBossQueueInfoModal';
import { PgBossSendJobModal } from '../../src/engines/pgBoss/components/PgBossSendJobModal';
import {
  freshnessOf,
  STALE_AFTER_MS,
} from '../../src/engines/pgBoss/components/PgBossStatsFreshness';
import { permissionsOf } from '../../src/engines/pgBoss/hooks/usePgBossInfo';
import { countLabel } from '../../src/engines/pgBoss/utils/states';
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

jest.mock('../../src/components/JsonEditor/JsonEditor', () => ({
  JsonEditor: ({ doc, name, id }: { doc: unknown; name: string; id: string }) => (
    <input type="hidden" id={id} name={name} defaultValue={JSON.stringify(doc)} />
  ),
}));

beforeEach(() => {
  useSettingsStore.setState({ pollingInterval: 0, confirmJobActions: false });
});

const t = ((key: string) => key) as never;

describe('CursorPagination', () => {
  it('hides itself on a single page', () => {
    const { container } = render(
      <CursorPagination isFirstPage prevCursor={null} nextCursor={null} onNavigate={jest.fn()} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('moves by cursor, and back to the first page with none', () => {
    const onNavigate = jest.fn();
    render(
      <CursorPagination isFirstPage={false} prevCursor="p" nextCursor="n" onNavigate={onNavigate} />
    );

    fireEvent.click(screen.getByRole('button', { name: /PGBOSS.PAGINATION.NEXT/ }));
    fireEvent.click(screen.getByRole('button', { name: /PGBOSS.PAGINATION.PREVIOUS/ }));
    fireEvent.click(screen.getByRole('button', { name: 'PGBOSS.PAGINATION.FIRST' }));
    expect(onNavigate.mock.calls).toEqual([['n'], ['p'], [undefined]]);
  });

  it('cannot go back from the first page', () => {
    render(
      <CursorPagination isFirstPage prevCursor={null} nextCursor="n" onNavigate={jest.fn()} />
    );
    expect(
      (screen.getByRole('button', { name: /PGBOSS.PAGINATION.PREVIOUS/ }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });
});

describe('freshnessOf', () => {
  const now = Date.parse('2026-06-01T12:00:00.000Z');
  const at = (ms: number) => new Date(now - ms).toISOString();

  it('is "never" as soon as one queue was never monitored', () => {
    expect(
      freshnessOf(
        [
          makePgBossQueue('a', { statsCapturedOn: at(0) }),
          makePgBossQueue('b', { statsCapturedOn: null }),
        ],
        now
      )
    ).toEqual({ kind: 'never' });
  });

  it('goes stale on the oldest queue past five minutes', () => {
    expect(
      freshnessOf([makePgBossQueue('a', { statsCapturedOn: at(STALE_AFTER_MS + 1) })], now)?.kind
    ).toBe('stale');
    expect(freshnessOf([makePgBossQueue('a', { statsCapturedOn: at(60_000) })], now)?.kind).toBe(
      'fresh'
    );
    expect(freshnessOf([], now)).toBeNull();
  });
});

describe('countLabel', () => {
  it('shows a number, a capped count and an unknown one', () => {
    const counts = makeCounts({ created: 5, failed: 10_001, active: null }, ['failed']);
    expect(countLabel(counts, 'created', 10_000, t, 'en-US')).toEqual({ count: 5, label: '5' });
    expect(countLabel(counts, 'failed', 10_000, t, 'en-US').label).toBe('PGBOSS.COUNT.CAPPED');
    expect(countLabel(counts, 'active', 10_000, t, 'en-US')).toMatchObject({
      label: 'PGBOSS.COUNT.UNKNOWN',
      title: 'PGBOSS.COUNT.TIMEOUT',
    });
    expect(countLabel(null, 'created', null, t, 'en-US')).toEqual({});
  });
});

describe('permissionsOf', () => {
  it('allows nothing on a read-only, unwritable or unreadable board', () => {
    expect(permissionsOf(makePgBossInfo()).can('retry')).toBe(true);
    expect(permissionsOf(makePgBossInfo({ readOnly: true })).canWrite).toBe(false);
    expect(permissionsOf(makePgBossInfo({ writable: false })).can('send')).toBe(false);
    expect(permissionsOf(makePgBossInfo({ readable: false })).canWrite).toBe(false);
    expect(permissionsOf(null).can('delete')).toBe(false);
  });
});

describe('PgBossJobActions', () => {
  const actions = { command: jest.fn(() => jest.fn()), duplicate: jest.fn() };
  const labels = (
    state: Parameters<typeof PgBossJobActions>[0]['state'],
    info = makePgBossInfo()
  ) => {
    const { container, unmount } = render(
      <PgBossJobActions state={state} permissions={permissionsOf(info)} actions={actions} />
    );
    const found = Array.from(container.querySelectorAll('button')).map((b) =>
      b.getAttribute('aria-label')
    );
    unmount();
    return found;
  };

  it('follows pg-boss state rules', () => {
    expect(labels('created')).toEqual([
      'PGBOSS.ACTIONS.DUPLICATE.LABEL',
      'PGBOSS.ACTIONS.CANCEL.LABEL',
      'PGBOSS.ACTIONS.DELETE.LABEL',
    ]);
    expect(labels('retry')).toEqual(['PGBOSS.ACTIONS.CANCEL.LABEL', 'PGBOSS.ACTIONS.DELETE.LABEL']);
    expect(labels('active')).toEqual(['PGBOSS.ACTIONS.CANCEL.LABEL']);
    expect(labels('completed')).toEqual([
      'PGBOSS.ACTIONS.DUPLICATE.LABEL',
      'PGBOSS.ACTIONS.DELETE.LABEL',
    ]);
    expect(labels('cancelled')).toEqual([
      'PGBOSS.ACTIONS.RESUME.LABEL',
      'PGBOSS.ACTIONS.DELETE.LABEL',
    ]);
    expect(labels('failed')).toEqual([
      'PGBOSS.ACTIONS.RETRY.LABEL',
      'PGBOSS.ACTIONS.DUPLICATE.LABEL',
      'PGBOSS.ACTIONS.DELETE.LABEL',
    ]);
  });

  it('follows each capability separately', () => {
    const info = makePgBossInfo();
    info.capabilities.delete = false;
    info.capabilities.send = false;
    expect(labels('failed', info)).toEqual(['PGBOSS.ACTIONS.RETRY.LABEL']);
    expect(labels('failed', makePgBossInfo({ readOnly: true }))).toEqual([]);
  });
});

describe('PgBossSendJobModal', () => {
  it('sends the data with only the options that were filled in', async () => {
    const pgBossApi = mockPgBossApi({
      getQueues: jest.fn(async () => ({ queues: [makePgBossQueue('emails')] })),
    });
    const onClose = jest.fn();
    const { Wrapper } = createPgBossWrapper({ pgBossApi });
    render(<PgBossSendJobModal open queueName="emails" onClose={onClose} />, { wrapper: Wrapper });

    fireEvent.change(screen.getByLabelText('PGBOSS.SEND.PRIORITY'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('PGBOSS.SEND.START_AFTER'), { target: { value: '60' } });
    fireEvent.change(screen.getByLabelText('PGBOSS.SEND.SINGLETON_KEY'), {
      target: { value: 'user-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'PGBOSS.SEND.SUBMIT' }));

    await waitFor(() =>
      expect(pgBossApi.sendJob).toHaveBeenCalledWith('emails', {
        data: {},
        options: { priority: 3, startAfter: 60, singletonKey: 'user-1' },
      })
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('prefills a copy from the job it duplicates', async () => {
    const pgBossApi = mockPgBossApi();
    const job = makePgBossJob({ data: { n: 1 }, priority: 2, retryLimit: 4, retryBackoff: true });
    const { Wrapper } = createPgBossWrapper({ pgBossApi });
    render(<PgBossSendJobModal open queueName="emails" job={job} onClose={jest.fn()} />, {
      wrapper: Wrapper,
    });

    expect(screen.getAllByText('PGBOSS.SEND.DUPLICATE_TITLE').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'PGBOSS.SEND.SUBMIT' }));

    await waitFor(() =>
      expect(pgBossApi.sendJob).toHaveBeenCalledWith('emails', {
        data: { n: 1 },
        options: {
          priority: 2,
          retryLimit: 4,
          retryDelay: 0,
          retryBackoff: true,
          expireInSeconds: 900,
        },
      })
    );
  });
});

describe('PgBossQueueInfoModal', () => {
  it('describes the queue policy, retries and lifecycle', async () => {
    const pgBossApi = mockPgBossApi({
      getQueues: jest.fn(async () => ({
        queues: [makePgBossQueue('emails', { policy: 'singleton', deadLetter: 'emails-dlq' })],
      })),
    });
    const { Wrapper } = createPgBossWrapper({ pgBossApi });
    render(<PgBossQueueInfoModal open queueName="emails" onClose={jest.fn()} />, {
      wrapper: Wrapper,
    });

    expect(await screen.findByText('PGBOSS.POLICY.SINGLETON')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'emails-dlq' }).getAttribute('href')).toBe(
      '/queue/emails-dlq'
    );
    expect(screen.getByText('PGBOSS.QUEUE.SECTIONS.RETRIES')).toBeTruthy();
  });
});

describe('PgBossDatastoreModal', () => {
  it('shows the installation next to the PostgreSQL stats', async () => {
    const pgBossApi = mockPgBossApi({
      getInfo: jest.fn(async () =>
        makePgBossInfo({
          schema: 'jobs',
          datastore: {
            backend: 'postgres',
            version: '17.2',
            port: 5432,
            uptime: 120,
            clients: { connected: 4, blocked: 0 },
          },
        })
      ),
    });
    const { Wrapper } = createPgBossWrapper({ pgBossApi });
    render(<PgBossDatastoreModal open onClose={jest.fn()} />, { wrapper: Wrapper });

    expect(await screen.findByText('PGBOSS.DATASTORE.TITLE')).toBeTruthy();
    expect(screen.getByText('jobs')).toBeTruthy();
    expect(screen.getByText('17.2')).toBeTruthy();
    expect(screen.getByText('PGBOSS.DATASTORE.RANGE')).toBeTruthy();
  });
});
