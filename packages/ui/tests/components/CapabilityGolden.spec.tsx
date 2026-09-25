import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { AppJob, AppQueue, Status } from '@worker-manager/api/typings/app';
import type { GetQueuesResponse } from '@worker-manager/api/typings/responses';
import { Details } from '../../src/components/JobCard/Details/Details';
import { JobActions } from '../../src/components/JobCard/JobActions/JobActions';
import { QueueDropdownActions } from '../../src/components/QueueDropdownActions/QueueDropdownActions';
import { QueueInfoModal } from '../../src/components/QueueInfoModal/QueueInfoModal';
import { useSettingsStore } from '../../src/hooks/useSettings';
import { createWrapper, makeQueue, render } from '../testUtils';

jest.mock('../../src/utils/highlight/highlight', () => ({
  asyncHighlight: (code: string) => Promise.resolve(code),
}));

const RECORD = process.env.RECORD_GOLDEN === '1';

const FIXTURES: Record<string, AppQueue> = {
  bull: makeQueue('golden-bull', {
    type: 'bull',
    statuses: ['latest', 'active', 'waiting', 'completed', 'failed', 'delayed', 'paused'],
  }),
  'bullmq-v5': makeQueue('golden-v5', {
    statuses: [
      'latest',
      'active',
      'waiting',
      'waiting-children',
      'prioritized',
      'completed',
      'failed',
      'delayed',
      'paused',
    ],
  }),
  'bullmq-v6-pg': makeQueue('golden-v6', {
    datastore: 'postgres',
    statuses: [
      'latest',
      'active',
      'waiting',
      'waiting-children',
      'prioritized',
      'completed',
      'failed',
      'delayed',
    ],
  }),
};

// The lists every fixture rendered before the capability refactor, recorded with RECORD_GOLDEN=1.
const GOLDEN: Record<string, unknown> = {
  'bull.dropdown': [
    'QUEUE.ACTIONS.ADD_JOB',
    'QUEUE.ACTIONS.PAUSE',
    'QUEUE.ACTIONS.EMPTY',
    'QUEUE.ACTIONS.OBLITERATE',
  ],
  'bull.info': {
    labels: [],
    library: ['Bull'],
  },
  'bull.jobActions': {
    active: [],
    waiting: ['JOB.ACTIONS.DUPLICATE', 'JOB.ACTIONS.UPDATE_DATA', 'JOB.ACTIONS.CLEAN'],
    completed: ['JOB.ACTIONS.DUPLICATE', 'JOB.ACTIONS.RETRY', 'JOB.ACTIONS.CLEAN'],
    failed: [
      'JOB.ACTIONS.RETRY',
      'JOB.ACTIONS.DUPLICATE',
      'JOB.ACTIONS.UPDATE_DATA',
      'JOB.ACTIONS.CLEAN',
    ],
    delayed: [
      'JOB.ACTIONS.PROMOTE',
      'JOB.ACTIONS.RESCHEDULE',
      'JOB.ACTIONS.DUPLICATE',
      'JOB.ACTIONS.UPDATE_DATA',
      'JOB.ACTIONS.CLEAN',
    ],
    paused: ['JOB.ACTIONS.DUPLICATE', 'JOB.ACTIONS.UPDATE_DATA', 'JOB.ACTIONS.CLEAN'],
  },
  'bull.tabs': {
    completed: [
      'JOB.TABS.DATA',
      'JOB.TABS.PROGRESS',
      'JOB.TABS.OPTIONS',
      'JOB.TABS.LOGS',
      'JOB.TABS.ERROR',
    ],
    failed: [
      'JOB.TABS.ERROR',
      'JOB.TABS.DATA',
      'JOB.TABS.PROGRESS',
      'JOB.TABS.OPTIONS',
      'JOB.TABS.LOGS',
    ],
  },
  'bullmq-v5.dropdown': [
    'QUEUE.ACTIONS.ADD_JOB',
    'QUEUE.ACTIONS.PAUSE',
    'QUEUE.ACTIONS.SET_CONCURRENCY',
    'QUEUE.ACTIONS.SET_RATE_LIMIT',
    'QUEUE.ACTIONS.EMPTY',
    'QUEUE.ACTIONS.OBLITERATE',
  ],
  'bullmq-v5.info': {
    labels: ['QUEUE.ACTIONS.SET_CONCURRENCY', 'QUEUE.ACTIONS.SET_RATE_LIMIT'],
    library: ['BullMQ'],
  },
  'bullmq-v5.jobActions': {
    active: [],
    waiting: ['JOB.ACTIONS.DUPLICATE', 'JOB.ACTIONS.UPDATE_DATA', 'JOB.ACTIONS.CLEAN'],
    'waiting-children': [
      'JOB.ACTIONS.REMOVE_UNPROCESSED_CHILDREN',
      'JOB.ACTIONS.DUPLICATE',
      'JOB.ACTIONS.UPDATE_DATA',
      'JOB.ACTIONS.CLEAN',
    ],
    prioritized: [
      'JOB.ACTIONS.REPRIORITISE',
      'JOB.ACTIONS.DUPLICATE',
      'JOB.ACTIONS.UPDATE_DATA',
      'JOB.ACTIONS.CLEAN',
    ],
    completed: ['JOB.ACTIONS.DUPLICATE', 'JOB.ACTIONS.RETRY', 'JOB.ACTIONS.CLEAN'],
    failed: [
      'JOB.ACTIONS.RETRY',
      'JOB.ACTIONS.DUPLICATE',
      'JOB.ACTIONS.UPDATE_DATA',
      'JOB.ACTIONS.CLEAN',
    ],
    delayed: [
      'JOB.ACTIONS.PROMOTE',
      'JOB.ACTIONS.RESCHEDULE',
      'JOB.ACTIONS.DUPLICATE',
      'JOB.ACTIONS.UPDATE_DATA',
      'JOB.ACTIONS.CLEAN',
    ],
    paused: ['JOB.ACTIONS.DUPLICATE', 'JOB.ACTIONS.UPDATE_DATA', 'JOB.ACTIONS.CLEAN'],
  },
  'bullmq-v5.tabs': {
    completed: [
      'JOB.TABS.DATA',
      'JOB.TABS.PROGRESS',
      'JOB.TABS.OPTIONS',
      'JOB.TABS.LOGS',
      'JOB.TABS.ERROR',
    ],
    failed: [
      'JOB.TABS.ERROR',
      'JOB.TABS.DATA',
      'JOB.TABS.PROGRESS',
      'JOB.TABS.OPTIONS',
      'JOB.TABS.LOGS',
    ],
  },
  'bullmq-v6-pg.dropdown': [
    'QUEUE.ACTIONS.ADD_JOB',
    'QUEUE.ACTIONS.PAUSE',
    'QUEUE.ACTIONS.SET_CONCURRENCY',
    'QUEUE.ACTIONS.SET_RATE_LIMIT',
    'QUEUE.ACTIONS.EMPTY',
    'QUEUE.ACTIONS.OBLITERATE',
  ],
  'bullmq-v6-pg.info': {
    labels: ['QUEUE.ACTIONS.SET_CONCURRENCY', 'QUEUE.ACTIONS.SET_RATE_LIMIT'],
    library: ['BullMQ'],
  },
  'bullmq-v6-pg.jobActions': {
    active: [],
    waiting: ['JOB.ACTIONS.DUPLICATE', 'JOB.ACTIONS.UPDATE_DATA', 'JOB.ACTIONS.CLEAN'],
    'waiting-children': [
      'JOB.ACTIONS.REMOVE_UNPROCESSED_CHILDREN',
      'JOB.ACTIONS.DUPLICATE',
      'JOB.ACTIONS.UPDATE_DATA',
      'JOB.ACTIONS.CLEAN',
    ],
    prioritized: [
      'JOB.ACTIONS.REPRIORITISE',
      'JOB.ACTIONS.DUPLICATE',
      'JOB.ACTIONS.UPDATE_DATA',
      'JOB.ACTIONS.CLEAN',
    ],
    completed: ['JOB.ACTIONS.DUPLICATE', 'JOB.ACTIONS.RETRY', 'JOB.ACTIONS.CLEAN'],
    failed: [
      'JOB.ACTIONS.RETRY',
      'JOB.ACTIONS.DUPLICATE',
      'JOB.ACTIONS.UPDATE_DATA',
      'JOB.ACTIONS.CLEAN',
    ],
    delayed: [
      'JOB.ACTIONS.PROMOTE',
      'JOB.ACTIONS.RESCHEDULE',
      'JOB.ACTIONS.DUPLICATE',
      'JOB.ACTIONS.UPDATE_DATA',
      'JOB.ACTIONS.CLEAN',
    ],
  },
  'bullmq-v6-pg.tabs': {
    completed: [
      'JOB.TABS.DATA',
      'JOB.TABS.PROGRESS',
      'JOB.TABS.OPTIONS',
      'JOB.TABS.LOGS',
      'JOB.TABS.ERROR',
    ],
    failed: [
      'JOB.TABS.ERROR',
      'JOB.TABS.DATA',
      'JOB.TABS.PROGRESS',
      'JOB.TABS.OPTIONS',
      'JOB.TABS.LOGS',
    ],
  },
};

beforeEach(() => {
  useSettingsStore.setState({ pollingInterval: 0, confirmQueueActions: false });
});

const recorded: Record<string, unknown> = {};

afterAll(() => {
  if (RECORD) {
    // oxlint-disable-next-line no-console
    console.log(JSON.stringify(recorded, null, 2));
  }
});

function check(name: string, value: unknown) {
  if (RECORD) {
    recorded[name] = value;
    return;
  }
  expect(value).toEqual(GOLDEN[name]);
}

const noop = () => () => Promise.resolve();
const queueActions = new Proxy(
  { addJob: () => {}, onConcurrency: () => {}, onRateLimit: () => {} } as Record<string, unknown>,
  { get: (target, name: string) => target[name] ?? noop }
) as any;

async function dropdownItems(queue: AppQueue) {
  const api = { getQueues: jest.fn(() => Promise.resolve<GetQueuesResponse>({ queues: [] })) };
  const { Wrapper } = createWrapper({ api });
  const view = render(<QueueDropdownActions queue={queue} actions={queueActions} />, {
    wrapper: Wrapper,
  });
  const trigger = screen.getAllByRole('button')[0];
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  fireEvent.click(trigger);
  const menu = await screen.findByRole('menu');
  const items = within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent);
  view.unmount();
  return items;
}

async function infoControls(queue: AppQueue) {
  const api = {
    getQueues: jest.fn(() => Promise.resolve({ queues: [queue] })),
    getQueueWorkers: jest.fn(() => Promise.resolve({ workers: null })),
    getQueueDefaultJobOptions: jest.fn(() => Promise.resolve({})),
    getQueueRateLimit: jest.fn(() => Promise.resolve({ supported: true, rateLimit: null })),
  };
  const { Wrapper } = createWrapper({ api });
  const view = render(<QueueInfoModal open queue={queue} onClose={() => {}} />, {
    wrapper: Wrapper,
  });
  await waitFor(() => expect(screen.getByText('QUEUE.INFO.OVERVIEW')).toBeTruthy());
  const dialog = screen.getByRole('dialog');
  const controls = {
    labels: within(dialog)
      .queryAllByRole('button')
      .map((button) => button.getAttribute('aria-label'))
      .filter(Boolean),
    library: within(dialog)
      .getAllByText(/^(Bull|BullMQ)$/)
      .map((badge) => badge.textContent),
  };
  view.unmount();
  return controls;
}

const JOB_ACTIONS = {
  promoteJob: () => Promise.resolve(true),
  retryJob: () => Promise.resolve(true),
  cleanJob: () => Promise.resolve(true),
  updateJobData: () => {},
  duplicateJob: () => {},
  rescheduleJob: () => {},
  reprioritiseJob: () => {},
  removeUnprocessedChildren: () => Promise.resolve(true),
};

function jobButtons(queue: AppQueue, status: Status) {
  const view = render(
    <JobActions
      status={status}
      allowRetries={queue.allowRetries}
      actions={JOB_ACTIONS}
      capabilities={queue.capabilities}
    />
  );
  const labels = screen.queryAllByRole('button').map((button) => button.getAttribute('aria-label'));
  view.unmount();
  return labels;
}

const job = {
  id: '1',
  name: 'process',
  data: {},
  returnValue: null,
  opts: {},
  progress: 0,
  stacktrace: [],
  failedReason: '',
} as unknown as AppJob;

async function detailTabs(queue: AppQueue, status: Status) {
  const { Wrapper } = createWrapper({ api: {} });
  const view = render(
    <Details
      status={status}
      job={job}
      actions={{ getJobLogs: () => Promise.resolve([]) }}
      capabilities={queue.capabilities}
    />,
    { wrapper: Wrapper }
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
  view.unmount();
  return tabs;
}

describe.each(Object.keys(FIXTURES))('capability golden: %s', (fixture) => {
  const queue = FIXTURES[fixture];

  it('offers the same queue menu', async () => {
    check(`${fixture}.dropdown`, await dropdownItems(queue));
  });

  it('offers the same queue info controls', async () => {
    check(`${fixture}.info`, await infoControls(queue));
  });

  it('offers the same job actions per status', () => {
    const statuses = queue.statuses.filter((status) => status !== 'latest');
    check(
      `${fixture}.jobActions`,
      Object.fromEntries(statuses.map((status) => [status, jobButtons(queue, status)]))
    );
  });

  it('offers the same detail tabs', async () => {
    check(`${fixture}.tabs`, {
      completed: await detailTabs(queue, 'completed'),
      failed: await detailTabs(queue, 'failed'),
    });
  });
});
