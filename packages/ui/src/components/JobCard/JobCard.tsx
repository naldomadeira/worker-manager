import { STATUSES } from '@worker-manager/api/constants/statuses';
import type { AppJob, Status } from '@worker-manager/api/typings/app';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { useMobileQuery } from '../../hooks/useMobileQuery';
import { useSettingsStore } from '../../hooks/useSettings';
import { HintTooltip } from '../HintTooltip/HintTooltip';
import { UpRightFromSquareSolid } from '../Icons/UpRightFromSquare';
import { statusTone } from '../StatusTone/statusTone';
import { Details } from './Details/Details';
import { JobActions } from './JobActions/JobActions';
import { Progress } from './Progress/Progress';
import { Timeline } from './Timeline/Timeline';

interface JobCardProps {
  job: AppJob;
  jobUrl?: { pathname: string; search: string };
  status: Status;
  readOnlyMode: boolean;
  allowRetries: boolean;
  actions: {
    updateJobData: () => void;
    duplicateJob: () => void;
    rescheduleJob: () => void;
    reprioritiseJob: () => void;
    removeUnprocessedChildren: () => Promise<boolean>;
    promoteJob: () => Promise<boolean>;
    retryJob: () => Promise<boolean>;
    cleanJob: () => Promise<boolean>;
    getJobLogs: () => Promise<string[]>;
  };
}

const greenStatuses = [STATUSES.active, STATUSES.completed] as const;

export const JobCard = ({
  job,
  status,
  actions,
  readOnlyMode,
  allowRetries,
  jobUrl,
}: JobCardProps) => {
  const { t } = useTranslation();
  const { collapseJob } = useSettingsStore();
  const isMobile = useMobileQuery();

  const [localCollapse, setLocalCollapse] = useState<boolean>();

  const isExpandedCard = !jobUrl || localCollapse || !collapseJob;
  const showCollapseExpandBtn = collapseJob && jobUrl;
  const idPrefix = /^\d+$/.test(`${job.id}`) ? '#' : '';
  const isShortId = `${job.id}`.length <= 8;

  const displayStatus =
    job.isFailed && !greenStatuses.includes(status as any) ? STATUSES.failed : status;
  const maxAttempts =
    typeof job.opts?.attempts === 'number' && job.opts.attempts > 1 ? job.opts.attempts : undefined;
  // A first and only attempt is the norm and says nothing; a retry, or a failure with retries
  // left, is what an operator wants to see without opening the card.
  const attemptsLabel =
    job.attempts > 1 || (job.isFailed && maxAttempts)
      ? maxAttempts
        ? t('JOB.ATTEMPTS_OF', { attempts: job.attempts, max: maxAttempts })
        : t('JOB.ATTEMPTS', { attempts: job.attempts })
      : null;
  const failedReasonLine = job.isFailed && !isExpandedCard ? job.failedReason?.trim() : undefined;
  const tone = statusTone(displayStatus);
  const isRunning = displayStatus === STATUSES.active;
  // `justify-start` + a truncating inner span: the badge is a centred inline-flex, so a long value
  // (a deduplication id, a group id) would otherwise overflow both ends with no ellipsis.
  const pill =
    'h-5 max-w-56 justify-start rounded-md px-1.5 font-mono text-[0.6875rem] font-normal';

  const title = (
    <>
      <span className="shrink-0 font-mono text-xs text-muted-foreground tracking-tight">
        {idPrefix}
        {job.id}
      </span>
      {isShortId && (
        <span className="truncate text-[0.9375rem] font-semibold text-foreground">{job.name}</span>
      )}
    </>
  );

  return (
    <Collapsible open={isExpandedCard} asChild>
      <Card
        data-status={displayStatus}
        className="group/job relative gap-0 overflow-visible py-0 shadow-xs transition-shadow duration-200 hover:shadow-md"
      >
        <span
          aria-hidden
          className={cn('absolute inset-y-3 left-0 w-[3px] rounded-r-full', tone.dot)}
        />
        <div className="flex w-full items-center justify-between gap-3 py-3 pr-3 pl-5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span
              aria-hidden
              className={cn(
                'size-2 shrink-0 rounded-full',
                tone.dot,
                isRunning && 'animate-pulse-ring text-status-active'
              )}
            />
            {jobUrl ? (
              <Link
                className="flex min-w-0 items-baseline gap-2 rounded-sm outline-none hover:[&>span:last-child]:underline hover:[&>span:last-child]:underline-offset-4 focus-visible:ring-3 focus-visible:ring-ring/50"
                to={jobUrl}
              >
                {title}
              </Link>
            ) : (
              <span className="flex min-w-0 items-baseline gap-2">{title}</span>
            )}

            {job.groupId != null && (
              <Badge
                variant="secondary"
                className={pill}
                title={t('JOB.DIAGNOSTICS.GROUP', { id: job.groupId })}
              >
                <span className="min-w-0 truncate">
                  {t('JOB.DIAGNOSTICS.GROUP', { id: job.groupId })}
                </span>
              </Badge>
            )}

            {attemptsLabel && (
              <Badge
                variant="secondary"
                className={cn(pill, job.isFailed && 'bg-status-failed/12 text-status-failed')}
              >
                {attemptsLabel}
              </Badge>
            )}

            {job.priority != null && (
              <Badge variant="secondary" className={pill}>
                {t('JOB.DIAGNOSTICS.PRIORITY', { priority: job.priority })}
              </Badge>
            )}

            {job.deduplicationId != null && (
              <Badge variant="secondary" className={pill} title={job.deduplicationId}>
                <span className="min-w-0 truncate">
                  {t('JOB.DIAGNOSTICS.DEDUPLICATED', { id: job.deduplicationId })}
                </span>
              </Badge>
            )}

            {job.stalledCounter != null && (
              <Badge className={cn(pill, 'bg-status-failed/12 text-status-failed')}>
                {t('JOB.DIAGNOSTICS.STALLED', { times: job.stalledCounter })}
              </Badge>
            )}

            {job.attemptsStarted != null && (
              <Badge variant="secondary" className={pill}>
                {t('JOB.DIAGNOSTICS.ATTEMPTS_STARTED', { starts: job.attemptsStarted })}
              </Badge>
            )}

            {job.deferredFailure != null && (
              <Badge
                className={cn(pill, 'bg-status-failed/12 text-status-failed')}
                title={job.deferredFailure}
              >
                {t('JOB.DIAGNOSTICS.WILL_FAIL')}
              </Badge>
            )}

            {job.externalUrl && (
              <a
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground [&_svg]:size-3"
                href={job.externalUrl.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {job.externalUrl.displayText ?? <UpRightFromSquareSolid />}
              </a>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {!readOnlyMode && (
              <JobActions status={status} actions={actions} allowRetries={allowRetries} />
            )}
            {showCollapseExpandBtn && (
              <HintTooltip title={t(isExpandedCard ? 'JOB.COLLAPSE' : 'JOB.EXPAND')}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-expanded={isExpandedCard}
                  aria-label={t(isExpandedCard ? 'JOB.COLLAPSE' : 'JOB.EXPAND')}
                  className="text-muted-foreground"
                  onClick={() => setLocalCollapse(!isExpandedCard)}
                >
                  <ChevronDown
                    className={cn(
                      'transition-transform duration-200',
                      isExpandedCard && 'rotate-180'
                    )}
                  />
                </Button>
              </HintTooltip>
            )}
          </div>
        </div>

        {!!failedReasonLine && (
          <p
            className="m-0 -mt-1 truncate px-5 pb-3 font-mono text-xs text-status-failed"
            title={failedReasonLine}
          >
            {failedReasonLine}
          </p>
        )}

        <CollapsibleContent className="overflow-hidden data-open:animate-collapsible-down data-closed:animate-collapsible-up">
          <div
            className={cn(
              'grid gap-5 border-t px-5 py-4',
              !isMobile && 'grid-cols-[11rem_minmax(0,1fr)] gap-6'
            )}
          >
            {!isMobile && (
              <aside className="border-r pr-5">
                <Timeline job={job} status={status} />
              </aside>
            )}

            <div className="flex min-w-0 flex-col gap-3">
              {!isShortId && (
                <h5 className="m-0 flex min-w-0 flex-wrap items-baseline gap-x-3 text-[0.9375rem] leading-snug font-semibold">
                  <span className="truncate">{job.name}</span>
                  {!!job.opts?.repeat?.count && (
                    <span className="text-xs font-normal text-muted-foreground">
                      {t(`JOB.REPEAT${!!job.opts?.repeat?.limit ? '_WITH_LIMIT' : ''}`, {
                        count: job.opts.repeat.count,
                        limit: job.opts?.repeat?.limit,
                      })}
                    </span>
                  )}
                </h5>
              )}
              <Progress progress={job.progress} status={displayStatus} />

              <Details status={status} job={job} actions={actions} withTimeline={isMobile} />
            </div>
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};
