import { act, screen } from '@testing-library/react';
import type { AppJob } from '@worker-manager/api/typings/app';
import { Details } from '../../src/components/JobCard/Details/Details';
import { JobActions } from '../../src/components/JobCard/JobActions/JobActions';
import { can, canScheduler, LIBRARY_LABELS } from '../../src/utils/capabilities';
import { capabilitiesFor, createWrapper, makeQueue, render } from '../testUtils';

jest.mock('../../src/utils/highlight/highlight', () => ({
  asyncHighlight: (code: string) => Promise.resolve(code),
}));

const actions = {
  promoteJob: () => Promise.resolve(true),
  retryJob: () => Promise.resolve(true),
  cleanJob: () => Promise.resolve(true),
  updateJobData: () => {},
  duplicateJob: () => {},
  rescheduleJob: () => {},
  reprioritiseJob: () => {},
  removeUnprocessedChildren: () => Promise.resolve(true),
};

describe('capabilities', () => {
  it('reads a capability off the queue, and nothing off an unknown one', () => {
    expect(can(makeQueue('a'), 'globalConcurrency')).toBe(true);
    expect(can(makeQueue('b', { type: 'bull' }), 'globalConcurrency')).toBe(false);
    expect(can(undefined, 'pause')).toBe(false);
    expect(canScheduler(makeQueue('c', { type: 'bull' }), 'update')).toBe(false);
    expect(canScheduler(null, 'run')).toBe(false);
  });

  it('names every library', () => {
    expect(LIBRARY_LABELS).toEqual({ bull: 'Bull', bullmq: 'BullMQ', 'bullmq-pro': 'BullMQ Pro' });
  });

  it('drops the job actions an adapter says it cannot do', () => {
    render(
      <JobActions
        status="delayed"
        allowRetries
        actions={actions}
        capabilities={{ ...capabilitiesFor('bullmq'), promote: false, updateData: false }}
      />
    );

    expect(screen.queryByLabelText('JOB.ACTIONS.PROMOTE')).toBeNull();
    expect(screen.queryByLabelText('JOB.ACTIONS.UPDATE_DATA')).toBeNull();
    expect(screen.getByLabelText('JOB.ACTIONS.RESCHEDULE')).toBeTruthy();
  });

  it('drops the logs and progress tabs an adapter cannot fill', async () => {
    const { Wrapper } = createWrapper({ api: {} });
    render(
      <Details
        status="completed"
        job={{ id: '1', data: {}, opts: {}, progress: 0, stacktrace: [] } as unknown as AppJob}
        actions={{ getJobLogs: () => Promise.resolve([]) }}
        capabilities={{ ...capabilitiesFor('bullmq'), logs: false, progress: false }}
      />,
      { wrapper: Wrapper }
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'JOB.TABS.DATA',
      'JOB.TABS.OPTIONS',
      'JOB.TABS.ERROR',
    ]);
  });
});
