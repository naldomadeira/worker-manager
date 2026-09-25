import type { PgBossJob, PgBossJobSummary } from '@worker-manager/api/typings/app';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { HintTooltip } from '../../../components/HintTooltip/HintTooltip';
import { useMobileQuery } from '../../../hooks/useMobileQuery';
import { useUIConfig } from '../../../hooks/useUIConfig';
import { formatRelativeToNow } from '../../../utils/formatDate';
import type { PgBossPermissions } from '../hooks/usePgBossInfo';
import { formatIso } from '../utils/format';
import { shortId } from '../utils/jobs';
import { pgBossLinks } from '../utils/links';
import { stateLabel, stateTone } from '../utils/states';
import { type PgBossJobActionHandlers, PgBossJobActions } from './PgBossJobActions';
import { PgBossJobDetails } from './PgBossJobDetails';
import { PgBossJobTimeline } from './PgBossJobTimeline';

interface PgBossJobCardProps {
  job: PgBossJobSummary;
  /** The full job, on the job page. The list only has the summary, so its cards stay compact. */
  detail?: PgBossJob;
  jobUrl?: { pathname: string; search: string };
  permissions: PgBossPermissions;
  actions: PgBossJobActionHandlers;
}

const pill = 'h-5 max-w-56 justify-start rounded-md px-1.5 font-mono text-[0.6875rem] font-normal';

/** A pg-boss job, in the same frame as a BullMQ job card: tone rail, id, badges, actions. */
export const PgBossJobCard = ({
  job,
  detail,
  jobUrl,
  permissions,
  actions,
}: PgBossJobCardProps) => {
  const { t, i18n } = useTranslation();
  const isMobile = useMobileQuery();
  const dateFormats = useUIConfig()?.dateFormats;
  const tone = stateTone(job.state);
  const isRunning = job.state === 'active';
  const isFailed = job.state === 'failed';
  // Attempts only say something once a job has been retried, or failed with retries configured.
  const showAttempt = job.retryCount > 0 || (isFailed && job.retryLimit > 0);
  const lastEvent = job.completedOn ?? job.startedOn ?? job.createdOn;

  const title = (
    <>
      <span
        className="shrink-0 font-mono text-xs tracking-tight text-muted-foreground"
        title={job.id}
      >
        {shortId(job.id)}
      </span>
      <span className="truncate font-mono text-[0.8125rem] font-medium text-foreground max-sm:hidden">
        {job.id}
      </span>
    </>
  );

  return (
    <Card
      data-job-state={job.state}
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

          <Badge variant="secondary" className={cn(pill, tone.soft, tone.text)}>
            {stateLabel(job.state, t)}
          </Badge>
          {job.deferred && (
            <Badge variant="delayed" className={pill}>
              {t('PGBOSS.SUBSTATE.DEFERRED')}
            </Badge>
          )}
          {job.blocked && (
            <Badge variant="waiting-children" className={pill}>
              {t('PGBOSS.SUBSTATE.BLOCKED')}
            </Badge>
          )}
          {showAttempt && (
            <Badge
              variant="secondary"
              className={cn(pill, isFailed && 'bg-status-failed/12 text-status-failed')}
            >
              {t('PGBOSS.JOB.ATTEMPT', { attempt: job.retryCount + 1, limit: job.retryLimit + 1 })}
            </Badge>
          )}
          {job.priority !== 0 && (
            <Badge variant="secondary" className={pill}>
              {t('PGBOSS.JOB.PRIORITY', { priority: job.priority })}
            </Badge>
          )}
          {job.singletonKey != null && (
            <Badge variant="secondary" className={pill} title={job.singletonKey}>
              <span className="min-w-0 truncate">
                {t('PGBOSS.JOB.SINGLETON_KEY')}: {job.singletonKey}
              </span>
            </Badge>
          )}
          {job.groupId != null && (
            <Badge variant="secondary" className={pill} title={job.groupId}>
              <span className="min-w-0 truncate">
                {t('PGBOSS.JOB.GROUP_ID')}: {job.groupId}
              </span>
            </Badge>
          )}
          {job.deadLetterSource && (
            <Badge variant="outline" className={pill} asChild>
              <Link
                to={pgBossLinks.jobPage(job.deadLetterSource.queueName, job.deadLetterSource.id)}
              >
                <span className="min-w-0 truncate">
                  {t('PGBOSS.JOB.FROM_QUEUE', { queue: job.deadLetterSource.queueName })}
                </span>
              </Link>
            </Badge>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {!detail && (
            <HintTooltip title={formatIso(lastEvent, i18n.language, dateFormats)}>
              <time
                tabIndex={0}
                dateTime={lastEvent}
                className="text-xs whitespace-nowrap text-muted-foreground tabular-nums outline-none max-sm:hidden"
              >
                {formatRelativeToNow(Date.parse(lastEvent), i18n.language)}
              </time>
            </HintTooltip>
          )}
          <PgBossJobActions state={job.state} permissions={permissions} actions={actions} />
        </div>
      </div>

      {detail && (
        <div
          className={cn(
            'grid gap-5 border-t px-5 py-4',
            !isMobile && 'grid-cols-[11rem_minmax(0,1fr)] gap-6'
          )}
        >
          {!isMobile && (
            <aside className="border-r pr-5">
              <PgBossJobTimeline job={detail} />
            </aside>
          )}
          <div className="flex min-w-0 flex-col gap-3">
            <PgBossJobDetails job={detail} withTimeline={isMobile} />
          </div>
        </div>
      )}
    </Card>
  );
};
