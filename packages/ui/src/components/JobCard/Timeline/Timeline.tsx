import { STATUSES } from '@worker-manager/api/constants/statuses';
import type { AppJob, Status } from '@worker-manager/api/typings/app';
import { differenceInMilliseconds } from 'date-fns';
import { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useUIConfig } from '../../../hooks/useUIConfig';
import { formatDate, TimeStamp } from '../../../utils/formatDate';
import { formatElapsed } from '../../../utils/formatElapsed';
import { statusTone } from '../../StatusTone/statusTone';

const formatDuration = (
  finishedTs: TimeStamp,
  processedTs: TimeStamp,
  locale: string,
  t: TFunction
) => {
  const durationInMs = differenceInMilliseconds(finishedTs, processedTs);
  const durationInSeconds = durationInMs / 1000;
  if (durationInSeconds > 5) {
    return formatElapsed(durationInSeconds, locale);
  }
  if (durationInSeconds >= 1) {
    return t('JOB.DURATION.SECS', { duration: durationInSeconds.toFixed(2) });
  }
  return t('JOB.DURATION.MILLI_SECS', { duration: durationInMs });
};

interface StepProps {
  label: string;
  time: string;
  dotClassName: string;
  pulse?: boolean;
  before?: React.ReactNode;
  after?: React.ReactNode;
}

const Step = ({ label, time, dotClassName, pulse, before, after }: StepProps) => (
  <li className="relative pb-4 pl-5 last:pb-0 before:absolute before:top-3 before:bottom-0 before:left-[4.5px] before:w-px before:bg-border last:before:hidden">
    <span
      aria-hidden
      className={cn(
        'absolute top-1 left-0 size-2.5 rounded-full ring-4 ring-card',
        dotClassName,
        pulse && 'animate-pulse-ring'
      )}
    />
    {before && <small className="block text-[0.6875rem] text-muted-foreground/80">{before}</small>}
    <small className="block text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
      {label}
    </small>
    <time className="mt-0.5 block font-mono text-xs text-foreground tabular-nums">{time}</time>
    {after && (
      <small className="mt-0.5 block text-[0.6875rem] text-muted-foreground">{after}</small>
    )}
  </li>
);

export const Timeline = function Timeline({
  job,
  status,
  className,
}: {
  job: AppJob;
  status: Status;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const uiConfig = useUIConfig();
  const dateFormats = uiConfig.dateFormats || {};
  const hasFailed = job.isFailed && status !== STATUSES.active && status !== STATUSES.completed;
  const isRunning = status === STATUSES.active && !job.finishedOn;

  return (
    <div className={cn('relative flex-1', className)}>
      <ol className="m-0 list-none p-0">
        <Step
          label={t('JOB.ADDED_AT')}
          time={formatDate(job.timestamp || 0, i18n.language, dateFormats)}
          dotClassName="bg-muted-foreground/60"
        />
        {!!job.delay && job.delay > 0 && status === STATUSES.delayed && (
          <Step
            label={t('JOB.WILL_RUN_AT')}
            time={formatDate(
              (job.timestamp || 0) + (job.opts.delay || job.delay || 0),
              i18n.language,
              dateFormats
            )}
            dotClassName={statusTone(STATUSES.delayed).dot}
            after={job.delay !== job.opts.delay ? t('JOB.DELAY_CHANGED') : undefined}
          />
        )}
        {!!job.processedOn && (
          <Step
            label={t('JOB.PROCESS_STARTED_AT')}
            time={formatDate(job.processedOn, i18n.language, dateFormats)}
            dotClassName={cn(statusTone(STATUSES.active).dot, 'text-status-active')}
            pulse={isRunning}
            before={
              <>
                {!!job.delay && job.delay > 0 && t('JOB.DELAYED_FOR') + ' '}
                {formatDuration(job.processedOn, job.timestamp || 0, i18n.language, t)}
              </>
            }
            after={
              job.processedBy ? t('JOB.PROCESSED_BY', { processedBy: job.processedBy }) : undefined
            }
          />
        )}
        {!!job.finishedOn && (
          <Step
            label={t(hasFailed ? `JOB.FAILED_AT` : 'JOB.FINISHED_AT')}
            time={formatDate(job.finishedOn, i18n.language, dateFormats)}
            dotClassName={statusTone(hasFailed ? STATUSES.failed : STATUSES.completed).dot}
            before={formatDuration(job.finishedOn, job.processedOn || 0, i18n.language, t)}
          />
        )}
      </ol>
    </div>
  );
};
