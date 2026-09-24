import type { AppJob, Status } from '@worker-manager/api/typings/app';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TabsType } from '../../../../hooks/useDetailsTabs';
import { useSettingsStore } from '../../../../hooks/useSettings';
import { CollapsibleJSON } from '../../../CollapsibleJSON/CollapsibleJSON';
import { Highlight } from '../../../Highlight/Highlight';
import { Timeline } from '../../Timeline/Timeline';
import { JobLogs } from './JobLogs/JobLogs';

interface DetailsContentProps {
  job: AppJob;
  selectedTab: TabsType;
  status: Status;
  actions: {
    getJobLogs: () => Promise<string[]>;
  };
}

const Reveal = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <div className="flex items-center justify-center p-6">
    <Button variant="outline" size="sm" onClick={onClick}>
      {children}
      <ChevronDown data-icon="inline-end" />
    </Button>
  </div>
);

const Notice = ({ tone, children }: { tone?: 'error'; children: React.ReactNode }) => (
  <div
    className={cn(
      'p-3 whitespace-pre-wrap',
      tone === 'error' ? 'font-mono text-xs text-destructive' : 'text-muted-foreground'
    )}
  >
    {children}
  </div>
);

export const DetailsContent = ({ selectedTab, job, actions, status }: DetailsContentProps) => {
  const { t } = useTranslation();
  const {
    collapseJobData,
    collapseJobProgress,
    collapseJobOptions,
    collapseJobError,
    defaultCollapseDepth,
    useCollapsibleJson,
  } = useSettingsStore();
  const [collapseState, setCollapse] = useState({
    data: false,
    progress: false,
    options: false,
    error: false,
  });
  const { stacktrace, data: jobData, returnValue, opts, failedReason } = job;

  switch (selectedTab) {
    case 'Data':
      if (collapseJobData && !collapseState.data) {
        return (
          <Reveal onClick={() => setCollapse({ ...collapseState, data: true })}>
            {t('JOB.SHOW_DATA_BTN')}
          </Reveal>
        );
      }
      return useCollapsibleJson ? (
        <CollapsibleJSON
          data={{ jobData, returnValue }}
          defaultCollapseDepth={defaultCollapseDepth}
        />
      ) : (
        <Highlight language="json" text={JSON.stringify({ jobData, returnValue }, null, 2)} />
      );
    case 'Progress':
      // Show N/A if progress is a simple number (circle already shows it),
      // null, undefined, or boolean
      if (
        typeof job.progress === 'number' ||
        typeof job.progress === 'boolean' ||
        job.progress === null ||
        job.progress === undefined
      ) {
        return <Notice>{t('JOB.NO_PROGRESS')}</Notice>;
      }
      // For objects or strings, display as JSON
      return collapseJobProgress && !collapseState.progress ? (
        <Reveal onClick={() => setCollapse({ ...collapseState, progress: true })}>
          {t('JOB.SHOW_PROGRESS_BTN')}
        </Reveal>
      ) : useCollapsibleJson ? (
        <CollapsibleJSON data={job.progress} defaultCollapseDepth={defaultCollapseDepth} />
      ) : (
        <Highlight language="json" text={JSON.stringify(job.progress, null, 2)} />
      );
    case 'Options':
      if (collapseJobOptions && !collapseState.options) {
        return (
          <Reveal onClick={() => setCollapse({ ...collapseState, options: true })}>
            {t('JOB.SHOW_OPTIONS_BTN')}
          </Reveal>
        );
      }
      return useCollapsibleJson ? (
        <CollapsibleJSON data={opts} defaultCollapseDepth={defaultCollapseDepth} />
      ) : (
        <Highlight language="json" text={JSON.stringify(opts, null, 2)} />
      );
    case 'Error':
      if (stacktrace.length === 0) {
        if (failedReason) {
          return <Notice tone="error">{failedReason}</Notice>;
        }

        return job.deferredFailure ? (
          <Notice tone="error">
            {t('JOB.DIAGNOSTICS.WILL_FAIL_WITH_REASON', { reason: job.deferredFailure })}
          </Notice>
        ) : (
          <Notice>{t('JOB.NO_ERRORS')}</Notice>
        );
      }

      return collapseJobError && !collapseState.error ? (
        <Reveal onClick={() => setCollapse({ ...collapseState, error: true })}>
          {t('JOB.SHOW_ERRORS_BTN')}
        </Reveal>
      ) : (
        <Highlight language="stacktrace" key="stacktrace" text={stacktrace.join('\n')} />
      );
    case 'Logs':
      return <JobLogs actions={actions} job={job} />;
    case 'Timeline':
      return <Timeline job={job} status={status} className="max-w-md p-4" />;
    default:
      return null;
  }
};
