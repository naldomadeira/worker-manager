import type { PgBossJob, PgBossJobSummary } from '@worker-manager/api/typings/app';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { statusTone } from '../../../components/StatusTone/statusTone';
import { useUIConfig } from '../../../hooks/useUIConfig';
import { formatIso } from '../utils/format';
import { stateTone } from '../utils/states';

const Step = ({
  label,
  time,
  dotClassName,
  pulse,
}: {
  label: string;
  time: string;
  dotClassName: string;
  pulse?: boolean;
}) => (
  <li className="relative pb-4 pl-5 last:pb-0 before:absolute before:top-3 before:bottom-0 before:left-[4.5px] before:w-px before:bg-border last:before:hidden">
    <span
      aria-hidden
      className={cn(
        'absolute top-1 left-0 size-2.5 rounded-full ring-4 ring-card',
        dotClassName,
        pulse && 'animate-pulse-ring'
      )}
    />
    <small className="block text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
      {label}
    </small>
    <time className="mt-0.5 block font-mono text-xs text-foreground tabular-nums">{time}</time>
  </li>
);

/** created → start after → started → finished, drawn like the BullMQ job timeline. */
export const PgBossJobTimeline = ({
  job,
  className,
}: {
  job: PgBossJobSummary & Partial<Pick<PgBossJob, 'keepUntil'>>;
  className?: string;
}) => {
  const { t, i18n } = useTranslation();
  const dateFormats = useUIConfig()?.dateFormats;
  const format = (value: string | null | undefined) => formatIso(value, i18n.language, dateFormats);
  const running = job.state === 'active';

  return (
    <div className={cn('relative flex-1', className)}>
      <ol className="m-0 list-none p-0">
        <Step
          label={t('PGBOSS.JOB.CREATED_ON')}
          time={format(job.createdOn)}
          dotClassName="bg-muted-foreground/60"
        />
        {job.startAfter !== job.createdOn && (
          <Step
            label={t('PGBOSS.JOB.START_AFTER')}
            time={format(job.startAfter)}
            dotClassName={statusTone('delayed').dot}
          />
        )}
        {!job.startedOn && !!job.keepUntil && job.state === 'created' && (
          <Step
            label={t('PGBOSS.JOB.KEEP_UNTIL')}
            time={format(job.keepUntil)}
            dotClassName="bg-muted-foreground/30"
          />
        )}
        {!!job.startedOn && (
          <Step
            label={t('PGBOSS.JOB.STARTED_ON')}
            time={format(job.startedOn)}
            dotClassName={cn(statusTone('active').dot, 'text-status-active')}
            pulse={running}
          />
        )}
        {!!job.completedOn && (
          <Step
            label={t('PGBOSS.JOB.COMPLETED_ON')}
            time={format(job.completedOn)}
            dotClassName={stateTone(job.state).dot}
          />
        )}
      </ol>
    </div>
  );
};
