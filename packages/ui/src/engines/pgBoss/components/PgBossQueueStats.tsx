import type { PgBossJobState, PgBossQueueSummary } from '@worker-manager/api/typings/app';
import { motion, useReducedMotion } from 'motion/react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { HoverPanel } from '../../../components/HoverPanel/HoverPanel';
import { formatNumber } from '../../../components/MetricsSummary/formatNumber';
import { statusTone } from '../../../components/StatusTone/statusTone';
import { pgBossLinks } from '../utils/links';

type Segment = 'ready' | 'deferred' | 'active' | 'failed';

/** Each cached counter, with the tone it is drawn in and the tab it opens. */
type SegmentLabel =
  | 'PGBOSS.SUBSTATE.READY'
  | 'PGBOSS.SUBSTATE.DEFERRED'
  | 'PGBOSS.STATE.ACTIVE'
  | 'PGBOSS.STATE.FAILED';

const SEGMENTS: { key: Segment; tone: string; state: PgBossJobState; labelKey: SegmentLabel }[] = [
  { key: 'ready', tone: 'waiting', state: 'created', labelKey: 'PGBOSS.SUBSTATE.READY' },
  { key: 'deferred', tone: 'delayed', state: 'created', labelKey: 'PGBOSS.SUBSTATE.DEFERRED' },
  { key: 'active', tone: 'active', state: 'active', labelKey: 'PGBOSS.STATE.ACTIVE' },
  { key: 'failed', tone: 'failed', state: 'failed', labelKey: 'PGBOSS.STATE.FAILED' },
];

/**
 * The queue pulse and its chips, drawn from pg-boss's cached counters the way BullMQ's card
 * draws its counts. Completed and cancelled jobs are only in the total: pg-boss does not cache
 * them per state.
 */
export const PgBossQueueStats = ({ queue }: { queue: PgBossQueueSummary }) => {
  const { t, i18n } = useTranslation();
  const reduceMotion = useReducedMotion();
  const segments = SEGMENTS.map((segment) => ({
    ...segment,
    label: t(segment.labelKey),
    value: queue.counts[segment.key] ?? 0,
    color: statusTone(segment.tone).color,
  })).filter((segment) => segment.value > 0);
  const sum = segments.reduce((acc, segment) => acc + segment.value, 0);
  const jobsLabel = t('DASHBOARD.JOBS_COUNT', { count: queue.counts.total });

  const pulse = (
    <span className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-muted">
      {sum > 0 &&
        segments.map((segment) => (
          <motion.span
            key={segment.key}
            className="bar block h-full min-w-1.5 first:rounded-l-full last:rounded-r-full"
            style={{ backgroundColor: segment.color }}
            initial={reduceMotion ? false : { width: 0 }}
            animate={{ width: `${(segment.value / sum) * 100}%` }}
            transition={{ duration: reduceMotion ? 0 : 0.6, ease: [0.16, 1, 0.3, 1] }}
          />
        ))}
    </span>
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {sum === 0 ? (
        <div className="py-1">{pulse}</div>
      ) : (
        <HoverPanel
          triggerLabel={jobsLabel}
          className="relative z-10 block w-full rounded-full py-1"
          rows={segments.map((segment) => ({
            id: segment.key,
            color: segment.color,
            label: segment.label,
            value: formatNumber(segment.value, i18n.language),
            to: pgBossLinks.queuePage(queue.name, segment.state),
          }))}
        >
          {pulse}
        </HoverPanel>
      )}

      <div className="flex min-w-0 items-end justify-between gap-3">
        <ul className="m-0 flex min-w-0 flex-wrap gap-1.5 p-0 empty:hidden">
          {segments.map((segment) => {
            const isFailed = segment.key === 'failed';
            return (
              <li key={segment.key} className="list-none">
                <Link
                  to={pgBossLinks.queuePage(queue.name, segment.state)}
                  style={{ '--chip-color': segment.color } as CSSProperties}
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
                      segment.key === 'active' && 'animate-pulse-ring text-status-active'
                    )}
                  />
                  <span>{segment.label}</span>
                  <span
                    className={cn(
                      'font-mono font-medium text-foreground tabular-nums',
                      isFailed && 'text-status-failed'
                    )}
                  >
                    {formatNumber(segment.value, i18n.language)}
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
