import type { AppQueue } from '@worker-manager/api/typings/app';
import { UserRoundXIcon } from 'lucide-react';
import React, { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { useModal } from '../../hooks/useModal';
import { HintTooltip } from '../HintTooltip/HintTooltip';

const QueueInfoModalLazy = React.lazy(() =>
  import('../QueueInfoModal/QueueInfoModal').then(({ QueueInfoModal }) => ({
    default: QueueInfoModal,
  }))
);

/**
 * Warns when nothing is consuming a queue, and shows nothing at all otherwise.
 * The count itself belongs in the queue info panel: a healthy number repeated across the
 * board is real estate spent on the case you never need to act on.
 */
export const WorkersBadge = ({ queue }: { queue: AppQueue }) => {
  const { t } = useTranslation();
  const modal = useModal<'workers'>();

  // `hasWorkers` rides along with the queue listing, so the warning needs no request of its own.
  // `null` means the queue could not be asked, which is not the same as nothing consuming it.
  // A paused queue is meant to have no workers, so that is not worth warning about either.
  if (queue.hasWorkers !== false || queue.isPaused) {
    return null;
  }

  const description = t('QUEUE.WORKERS.NONE_TOOLTIP');

  return (
    <>
      <HintTooltip title={description}>
        <span className="relative z-10 inline-flex items-center">
          <Badge
            asChild
            variant="secondary"
            className="bg-status-waiting/15 text-status-waiting transition-colors hover:bg-status-waiting/25 focus-visible:ring-status-waiting/40"
          >
            <button type="button" aria-label={description} onClick={() => modal.open('workers')}>
              <UserRoundXIcon aria-hidden="true" />
              {t('QUEUE.WORKERS.NONE')}
            </button>
          </Badge>
        </span>
      </HintTooltip>
      <Suspense fallback={null}>
        {modal.isMounted('workers') && (
          // The queue info panel owns this list, so the badge opens it on that section
          // rather than showing the same workers in a second modal of its own.
          <QueueInfoModalLazy
            open={modal.isOpen('workers')}
            onClose={modal.close('workers')}
            queue={queue}
            initialSection="workers"
          />
        )}
      </Suspense>
    </>
  );
};
