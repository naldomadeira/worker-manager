import type { PgBossQueueSummary } from '@worker-manager/api/typings/app';
import { CalendarClockIcon, LockIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { HintTooltip } from '../../../components/HintTooltip/HintTooltip';
import { formatNumber } from '../../../components/MetricsSummary/formatNumber';
import { describePolicy } from '../utils/policy';

/** The policy, backlog and read-only badges a queue carries on its card and its page header. */
export const PgBossQueueBadges = ({
  queue,
  readOnly,
  className,
}: {
  queue: PgBossQueueSummary;
  readOnly: boolean;
  className?: string;
}) => {
  const { t, i18n } = useTranslation();
  const policy = describePolicy(queue.policy, t);

  return (
    <>
      <HintTooltip title={policy.description}>
        <Badge variant="outline" tabIndex={0} className={cn('relative z-10', className)}>
          {policy.label}
        </Badge>
      </HintTooltip>
      {queue.backlogged && (
        <HintTooltip
          title={`${t('PGBOSS.QUEUE.WARNING_QUEUE_SIZE')}: ${formatNumber(queue.warningQueueSize, i18n.language)}`}
        >
          <Badge variant="warning" tabIndex={0} className={cn('relative z-10', className)}>
            <TriangleAlertIcon aria-hidden="true" />
            {t('PGBOSS.QUEUE.BACKLOGGED')}
          </Badge>
        </HintTooltip>
      )}
      {queue.scheduleCount > 0 && (
        <Badge variant="secondary" className={cn('relative z-10 tabular-nums', className)}>
          <CalendarClockIcon aria-hidden="true" />
          {formatNumber(queue.scheduleCount, i18n.language)}
          <span className="sr-only">{t('PGBOSS.QUEUE.SCHEDULES')}</span>
        </Badge>
      )}
      {readOnly && (
        <Badge variant="outline" className={cn('relative z-10 text-muted-foreground', className)}>
          <LockIcon aria-hidden="true" />
          {t('PGBOSS.BANNER.READ_ONLY')}
        </Badge>
      )}
    </>
  );
};
