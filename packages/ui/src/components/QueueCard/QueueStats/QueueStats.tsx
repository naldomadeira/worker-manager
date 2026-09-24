import type { AppQueue, Status } from '@worker-manager/api/typings/app';
import { motion, useReducedMotion } from 'motion/react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { dynamicTranslationKey } from '../../../utils/dynamicTranslationKey';
import { links } from '../../../utils/links';
import { HoverPanel } from '../../HoverPanel/HoverPanel';

interface IQueueStatsProps {
  queue: AppQueue;
}

const statusColor = (status: Status) => `var(--status-${status})`;

export const QueueStats = ({ queue }: IQueueStatsProps) => {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const total = queue.statuses.reduce((result, status) => result + (queue.counts[status] || 0), 0);
  const nonZeroStatuses = queue.statuses.filter((status) => (queue.counts[status] ?? 0) > 0);
  const jobsLabel = t('DASHBOARD.JOBS_COUNT', { count: total });
  const statusLabel = (status: Status) =>
    t(dynamicTranslationKey(`QUEUE.STATUS.${status.toUpperCase()}`));

  /* The queue pulse: proportional per-status composition of the queue. Each segment keeps a
     floor width so a status with a handful of jobs next to thousands is still visible. */
  const pulse = (
    <span
      className={cn(
        'flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-muted',
        queue.isPaused && 'opacity-60 saturate-50'
      )}
    >
      {total > 0 &&
        nonZeroStatuses.map((status) => (
          <motion.span
            key={status}
            className="bar block h-full min-w-1.5 first:rounded-l-full last:rounded-r-full"
            style={{ backgroundColor: statusColor(status) }}
            initial={reduceMotion ? false : { width: 0 }}
            animate={{ width: `${((queue.counts[status] ?? 0) / total) * 100}%` }}
            transition={{ duration: reduceMotion ? 0 : 0.6, ease: [0.16, 1, 0.3, 1] }}
          />
        ))}
    </span>
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {total === 0 ? (
        <div className="py-1">{pulse}</div>
      ) : (
        <HoverPanel
          triggerLabel={jobsLabel}
          className="relative z-10 block w-full rounded-full py-1"
          rows={nonZeroStatuses.map((status) => ({
            id: status,
            color: statusColor(status),
            label: statusLabel(status),
            value: (queue.counts[status] ?? 0).toLocaleString(),
            to: links.queuePage(queue.name, { [queue.name]: status }),
          }))}
        >
          {pulse}
        </HoverPanel>
      )}

      <div className="flex min-w-0 items-end justify-between gap-3">
        <ul className="m-0 flex min-w-0 flex-wrap gap-1.5 p-0 empty:hidden">
          {nonZeroStatuses.map((status) => {
            const isFailed = status === 'failed';
            return (
              <li key={status} className="list-none">
                <Link
                  to={links.queuePage(queue.name, { [queue.name]: status })}
                  style={{ '--chip-color': statusColor(status) } as CSSProperties}
                  className={cn(
                    'relative z-10 inline-flex h-6 items-center gap-1.5 rounded-md border border-transparent px-1.5 text-xs text-muted-foreground no-underline transition-colors',
                    'hover:border-border hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                    isFailed &&
                      'bg-status-failed/10 text-status-failed hover:border-status-failed/30 hover:bg-status-failed/15 hover:text-status-failed'
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'size-1.5 shrink-0 rounded-full bg-(--chip-color)',
                      status === 'active' && 'animate-pulse-ring text-status-active'
                    )}
                  />
                  <span>{statusLabel(status)}</span>
                  <span
                    className={cn(
                      'font-mono font-medium text-foreground tabular-nums',
                      isFailed && 'text-status-failed'
                    )}
                  >
                    {(queue.counts[status] ?? 0).toLocaleString()}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        <span className="ml-auto shrink-0 pb-0.5 text-xs whitespace-nowrap text-muted-foreground">
          {jobsLabel}
        </span>
      </div>
    </div>
  );
};
