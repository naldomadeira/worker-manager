import type { PgBossQueueSummary } from '@worker-manager/api/typings/app';
import { ClockAlertIcon, ClockIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { HintTooltip } from '../../../components/HintTooltip/HintTooltip';
import { formatRelativeToNow } from '../../../utils/formatDate';

/** Past this, the cached counters are said to be out of date. */
export const STALE_AFTER_MS = 5 * 60 * 1000;

type Freshness = { kind: 'never' } | { kind: 'stale' | 'fresh'; capturedOn: number };

/**
 * How old the counters behind these queues are. pg-boss only writes them while some instance
 * runs `supervise`, so they can be minutes old, or never written at all. The oldest queue decides.
 */
export function freshnessOf(queues: PgBossQueueSummary[], now = Date.now()): Freshness | null {
  if (queues.length === 0) return null;
  if (queues.some((queue) => queue.statsCapturedOn === null)) return { kind: 'never' };

  const capturedOn = Math.min(...queues.map((queue) => Date.parse(queue.statsCapturedOn!)));
  return { kind: now - capturedOn > STALE_AFTER_MS ? 'stale' : 'fresh', capturedOn };
}

export const PgBossStatsFreshness = ({
  queues,
  className,
}: {
  queues: PgBossQueueSummary[];
  className?: string;
}) => {
  const { t, i18n } = useTranslation();
  const freshness = freshnessOf(queues);

  if (!freshness) {
    return null;
  }

  if (freshness.kind === 'fresh') {
    return (
      <HintTooltip title={t('PGBOSS.STATS.CACHED_HINT')}>
        <span
          tabIndex={0}
          className={cn(
            'inline-flex items-center gap-1.5 text-xs text-muted-foreground outline-none',
            className
          )}
        >
          <ClockIcon aria-hidden="true" className="size-3.5" />
          {t('PGBOSS.STATS.UPDATED_AT', {
            time: formatRelativeToNow(freshness.capturedOn, i18n.language),
          })}
        </span>
      </HintTooltip>
    );
  }

  return (
    <p
      role="status"
      data-freshness={freshness.kind}
      className={cn(
        'm-0 inline-flex items-start gap-2 rounded-lg border border-status-delayed/30 bg-status-delayed/8 px-2.5 py-1.5 text-xs text-foreground animate-fade-in-up',
        className
      )}
    >
      <ClockAlertIcon aria-hidden="true" className="mt-px size-3.5 shrink-0 text-status-delayed" />
      <span>
        {freshness.kind === 'never'
          ? t('PGBOSS.STATS.NEVER')
          : t('PGBOSS.STATS.STALE', {
              time: formatRelativeToNow(freshness.capturedOn, i18n.language),
            })}
      </span>
    </p>
  );
};
