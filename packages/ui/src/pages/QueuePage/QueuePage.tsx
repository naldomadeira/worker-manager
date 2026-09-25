import { STATUSES } from '@worker-manager/api/constants/statuses';
import type { AppJob } from '@worker-manager/api/typings/app';
import { Inbox, Plus } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import React, { Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { cn } from '@/lib/utils';
import { SchedulersIcon } from '../../components/Icons/Schedulers';
import { JobCard } from '../../components/JobCard/JobCard';
import { Loader } from '../../components/Loader/Loader';
import { LoadError } from '../../components/LoadError/LoadError';
import { Pagination } from '../../components/Pagination/Pagination';
import { QueueActions, isStatusActionable } from '../../components/QueueActions/QueueActions';
import { QueueDropdownActions } from '../../components/QueueDropdownActions/QueueDropdownActions';
import { RateLimitBadge } from '../../components/RateLimitBadge/RateLimitBadge';
import { StatusMenu } from '../../components/StatusMenu/StatusMenu';
import { StickyHeader } from '../../components/StickyHeader/StickyHeader';
import { WorkersBadge } from '../../components/WorkersBadge/WorkersBadge';
import { useActiveQueue } from '../../hooks/useActiveQueue';
import { useJob } from '../../hooks/useJob';
import { useModal } from '../../hooks/useModal';
import { useQueues } from '../../hooks/useQueues';
import { useSelectedStatuses } from '../../hooks/useSelectedStatuses';
import { useUIConfig } from '../../hooks/useUIConfig';
import { links } from '../../utils/links';

const AddJobModalLazy = React.lazy(() =>
  import('../../components/AddJobModal/AddJobModal').then(({ AddJobModal }) => ({
    default: AddJobModal,
  }))
);

const UpdateJobDataModalLazy = React.lazy(() =>
  import('../../components/UpdateJobDataModal/UpdateJobDataModal').then(
    ({ UpdateJobDataModal }) => ({
      default: UpdateJobDataModal,
    })
  )
);

const ConcurrencyModalLazy = React.lazy(() =>
  import('../../components/ConcurrencyModal/ConcurrencyModal').then(({ ConcurrencyModal }) => ({
    default: ConcurrencyModal,
  }))
);

const RateLimitModalLazy = React.lazy(() =>
  import('../../components/RateLimitModal/RateLimitModal').then(({ RateLimitModal }) => ({
    default: RateLimitModal,
  }))
);

const EditJobModalLazy = React.lazy(() =>
  import('../../components/EditJobModal/EditJobModal').then(({ EditJobModal }) => ({
    default: EditJobModal,
  }))
);

const QueueMetricsLazy = React.lazy(() =>
  import('../../components/QueueMetrics/QueueMetrics').then(({ QueueMetrics }) => ({
    default: QueueMetrics,
  }))
);

export const QueuePage = () => {
  const { t } = useTranslation();
  const { showMetrics = false } = useUIConfig();
  const selectedStatus = useSelectedStatuses();
  const { actions, loading, isTransitioning, queues, error } = useQueues();
  const { actions: jobActions } = useJob();
  const queue = useActiveQueue();
  const modal = useModal<
    'addJob' | 'updateJobData' | 'concurrency' | 'rescheduleJob' | 'reprioritiseJob' | 'rateLimit'
  >();
  const [editJob, setEditJob] = useState<AppJob | null>(null);

  const reduceMotion = useReducedMotion();

  if (!queue) {
    if (!queues && error) {
      return <LoadError error={error} onRetry={actions.updateQueues} />;
    }
    return (
      <section className="py-10 text-center text-sm text-muted-foreground">
        {loading ? <Loader /> : t('QUEUE.NOT_FOUND')}
      </section>
    );
  }

  const status = selectedStatus[queue.name];
  const isLatest = status === STATUSES.latest;
  const schedulerCount = queue.jobSchedulerCount ?? 0;
  const pageCount = queue.pagination.pageCount;
  const hasJobs = queue.jobs.length > 0;
  const total = queue.counts[status as keyof typeof queue.counts] ?? 0;
  const rangeStart = (queue.pagination.range?.start ?? 0) + 1;
  const rangeEnd = rangeStart + queue.jobs.length - 1;

  const showQueueActions = hasJobs && !queue.readOnlyMode && isStatusActionable(status);
  const showRange = hasJobs && total > 0;
  // "Latest" has neither bulk actions nor a count of its own, so on a single page the toolbar
  // would render as an empty bar.
  const toolbar =
    showQueueActions || showRange || pageCount > 1 ? (
      <div
        data-slot="queue-toolbar"
        className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border bg-card/80 px-2 py-1.5 shadow-xs backdrop-blur-sm"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {showQueueActions && (
            <QueueActions
              queue={queue}
              actions={actions}
              status={selectedStatus[queue.name]}
              allowRetries={
                (selectedStatus[queue.name] == 'failed' || queue.allowCompletedRetries) &&
                queue.allowRetries
              }
            />
          )}
          {showRange && (
            <span className="px-1.5 text-xs text-muted-foreground tabular-nums">
              {t('QUEUE.RANGE', {
                start: rangeStart,
                end: rangeEnd,
                total,
              })}
            </span>
          )}
        </div>
        <Pagination pageCount={pageCount} />
      </div>
    ) : null;

  return (
    <section className="flex flex-col">
      <header className="flex flex-wrap items-start justify-between gap-3 pb-4 animate-fade-in-up">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="m-0 truncate text-xl font-semibold tracking-tight">
              {queue.displayName ?? queue.name}
            </h1>
            <Badge
              variant="secondary"
              className={cn(
                'gap-1.5',
                queue.isPaused
                  ? 'bg-status-paused/15 text-status-paused'
                  : 'bg-status-completed/12 text-status-completed'
              )}
            >
              <span aria-hidden className="size-1.5 rounded-full bg-current" />
              {t(queue.isPaused ? 'QUEUE.INFO.PAUSED' : 'QUEUE.INFO.RUNNING')}
            </Badge>
            {queue.readOnlyMode && <Badge variant="outline">{t('QUEUE.INFO.READ_ONLY')}</Badge>}
            <Badge variant="outline" className="font-mono text-[0.625rem] tracking-wide uppercase">
              {queue.library}
            </Badge>
          </div>
          {!!queue.displayName && (
            <p className="mt-1 font-mono text-xs text-muted-foreground">{queue.name}</p>
          )}
          {!!queue.description && (
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">{queue.description}</p>
          )}
        </div>
        {!queue.readOnlyMode && (
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              onClick={() => {
                setEditJob(null);
                modal.open('addJob');
              }}
            >
              <Plus data-icon="inline-start" />
              {t('QUEUE.ACTIONS.ADD_JOB')}
            </Button>
            <QueueDropdownActions
              queue={queue}
              actions={{
                ...actions,
                addJob: () => modal.open('addJob'),
                onConcurrency: () => modal.open('concurrency'),
                onRateLimit: () => modal.open('rateLimit'),
              }}
            />
          </div>
        )}
      </header>

      <StickyHeader actions={toolbar as React.ReactElement}>
        <StatusMenu queue={queue}>
          {schedulerCount > 0 && (
            <Link
              className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs whitespace-nowrap text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&_svg]:size-3.5 [&_svg]:shrink-0"
              to={links.jobSchedulers({ queueName: queue.name })}
              aria-label={t('QUEUE.SCHEDULERS_LINK', { count: schedulerCount })}
            >
              <SchedulersIcon />
              <span className="hidden md:inline">{t('SCHEDULERS.TITLE')}</span>
              <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem] leading-none tabular-nums">
                {schedulerCount}
              </span>
            </Link>
          )}
          <RateLimitBadge queue={queue} />
          <WorkersBadge queue={queue} />
        </StatusMenu>
      </StickyHeader>

      {showMetrics && (
        <Suspense fallback={null}>
          <QueueMetricsLazy queue={queue} />
        </Suspense>
      )}

      {hasJobs ? (
        <ul
          aria-busy={isTransitioning || undefined}
          className={cn(
            'relative m-0 flex list-none flex-col gap-3 p-0 transition-opacity duration-200',
            isTransitioning && 'pointer-events-none opacity-60'
          )}
        >
          <AnimatePresence initial mode="popLayout">
            {queue.jobs.map((job, index) => (
              <motion.li
                key={job.id}
                layout={reduceMotion ? false : 'position'}
                initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: {
                    duration: 0.32,
                    ease: [0.16, 1, 0.3, 1],
                    delay: reduceMotion ? 0 : Math.min(index, 12) * 0.035,
                  },
                }}
                exit={
                  reduceMotion
                    ? { opacity: 0, transition: { duration: 0 } }
                    : { opacity: 0, scale: 0.98, transition: { duration: 0.16 } }
                }
              >
                <JobCard
                  job={job}
                  jobUrl={links.jobPage(queue.name, `${job.id}`, selectedStatus)}
                  status={isLatest && job.isFailed ? STATUSES.failed : status}
                  actions={{
                    cleanJob: jobActions.cleanJob(queue.name)(job),
                    promoteJob: jobActions.promoteJob(queue.name)(job),
                    retryJob: jobActions.retryJob(queue.name)(job),
                    getJobLogs: jobActions.getJobLogs(queue.name)(job),
                    removeUnprocessedChildren: jobActions.removeUnprocessedChildren(queue.name)(
                      job
                    ),
                    updateJobData: () => {
                      setEditJob(job);
                      modal.open('updateJobData');
                    },
                    duplicateJob: () => {
                      setEditJob(job);
                      modal.open('addJob');
                    },
                    rescheduleJob: () => {
                      setEditJob(job);
                      modal.open('rescheduleJob');
                    },
                    reprioritiseJob: () => {
                      setEditJob(job);
                      modal.open('reprioritiseJob');
                    },
                  }}
                  readOnlyMode={queue?.readOnlyMode}
                  allowRetries={(job.isFailed || queue.allowCompletedRetries) && queue.allowRetries}
                  capabilities={queue.capabilities}
                />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      ) : (
        <Empty className="mt-4 border bg-card/50 py-12 animate-fade-in-up">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Inbox />
            </EmptyMedia>
            <EmptyTitle className="text-sm font-normal text-muted-foreground">
              {t('QUEUE.EMPTY_STATE', { status })}
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}
      <Suspense fallback={null}>
        {modal.isMounted('addJob') && (
          <AddJobModalLazy
            open={modal.isOpen('addJob')}
            onClose={modal.close('addJob')}
            job={editJob}
          />
        )}
        {modal.isMounted('updateJobData') && !!editJob && (
          <UpdateJobDataModalLazy
            open={modal.isOpen('updateJobData')}
            onClose={() => {
              setEditJob(null);
              modal.close('updateJobData');
            }}
            job={editJob}
          />
        )}
        {modal.isMounted('rateLimit') && (
          <RateLimitModalLazy
            open={modal.isOpen('rateLimit')}
            onClose={modal.close('rateLimit')}
            queue={queue}
          />
        )}
        {modal.isMounted('rescheduleJob') && !!editJob && (
          <EditJobModalLazy
            open={modal.isOpen('rescheduleJob')}
            field="delay"
            job={editJob}
            onSubmit={(runAt) => jobActions.changeJobDelay(queue.name, editJob, runAt)()}
            onClose={() => {
              setEditJob(null);
              modal.close('rescheduleJob')();
            }}
          />
        )}
        {modal.isMounted('reprioritiseJob') && !!editJob && (
          <EditJobModalLazy
            open={modal.isOpen('reprioritiseJob')}
            field="priority"
            job={editJob}
            onSubmit={(priority) => jobActions.changeJobPriority(queue.name, editJob, priority)()}
            onClose={() => {
              setEditJob(null);
              modal.close('reprioritiseJob')();
            }}
          />
        )}
        {modal.isMounted('concurrency') && (
          <ConcurrencyModalLazy
            open={modal.isOpen('concurrency')}
            onClose={modal.close('concurrency')}
            queue={queue}
          />
        )}
      </Suspense>
    </section>
  );
};
