import type { AppQueue } from '@worker-manager/api/typings/app';
import { TimerIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { useQueues } from '../../hooks/useQueues';
import { Tooltip } from '../Tooltip/Tooltip';

export const RateLimitBadge = ({ queue }: { queue: AppQueue }) => {
  const { t } = useTranslation();
  const { actions } = useQueues();

  if (!queue.activeRateLimitTtl) {
    return null;
  }

  const seconds = Math.ceil(queue.activeRateLimitTtl / 1000);
  const description = t('RATE_LIMIT.BADGE_TOOLTIP', { seconds });

  return (
    <Tooltip title={description} className="relative z-10 inline-flex items-center">
      <Badge
        asChild
        variant="secondary"
        className="bg-status-delayed/15 text-status-delayed transition-colors hover:bg-status-delayed/25 focus-visible:ring-status-delayed/40 disabled:cursor-default disabled:hover:bg-status-delayed/15"
      >
        <button
          type="button"
          aria-label={description}
          disabled={queue.readOnlyMode}
          onClick={actions.releaseQueueRateLimit(queue.name)}
        >
          <TimerIcon aria-hidden="true" />
          {t('RATE_LIMIT.BADGE', { seconds })}
        </button>
      </Badge>
    </Tooltip>
  );
};
