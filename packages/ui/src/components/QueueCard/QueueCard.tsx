import type { AppJob, AppQueue } from '@worker-manager/api/typings/app';
import { InfoIcon, LockIcon, PauseIcon } from 'lucide-react';
import React, { Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useModal } from '../../hooks/useModal';
import { useQueues } from '../../hooks/useQueues';
import { links } from '../../utils/links';
import { QueueDropdownActions } from '../QueueDropdownActions/QueueDropdownActions';
import { RateLimitBadge } from '../RateLimitBadge/RateLimitBadge';
import { Tooltip } from '../Tooltip/Tooltip';
import { WorkersBadge } from '../WorkersBadge/WorkersBadge';
import { QueueStats } from './QueueStats/QueueStats';

interface IQueueCardProps {
  queue: AppQueue;
  displayName?: string;
}

const AddJobModalLazy = React.lazy(() =>
  import('../AddJobModal/AddJobModal').then(({ AddJobModal }) => ({
    default: AddJobModal,
  }))
);

const ConcurrencyModalLazy = React.lazy(() =>
  import('../ConcurrencyModal/ConcurrencyModal').then(({ ConcurrencyModal }) => ({
    default: ConcurrencyModal,
  }))
);

const RateLimitModalLazy = React.lazy(() =>
  import('../RateLimitModal/RateLimitModal').then(({ RateLimitModal }) => ({
    default: RateLimitModal,
  }))
);

export const QueueCard = ({ queue, displayName }: IQueueCardProps) => {
  const { t } = useTranslation();
  const { actions } = useQueues();
  const modal = useModal<'addJob' | 'concurrency' | 'rateLimit'>();
  const [editJob] = useState<AppJob | null>(null);
  const label = displayName ?? queue.displayName;
  const hasFailures = (queue.counts.failed ?? 0) > 0;

  return (
    <Card
      data-paused={queue.isPaused || undefined}
      className={cn(
        'group/queue-card relative isolate h-full min-w-0 gap-4 p-4 shadow-xs',
        'transition-[transform,box-shadow,background-color] duration-200 ease-out',
        'hover:-translate-y-0.5 hover:shadow-lg hover:ring-foreground/20 motion-reduce:hover:translate-y-0',
        'has-[a[data-card-link]:focus-visible]:ring-2 has-[a[data-card-link]:focus-visible]:ring-ring',
        hasFailures && 'ring-status-failed/30 hover:ring-status-failed/45'
      )}
    >
      {/* A hairline of the dominant signal along the top edge: red while anything is failing. */}
      {hasFailures && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-linear-to-r from-status-failed/0 via-status-failed/70 to-status-failed/0"
        />
      )}

      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <NavLink
              to={links.queuePage(queue.name)}
              data-card-link=""
              title={queue.displayName}
              className="min-w-0 truncate text-[0.95rem] font-semibold tracking-tight text-foreground no-underline outline-none after:absolute after:inset-0 after:z-0 after:content-['']"
            >
              {label}
            </NavLink>
            {!!queue.description && (
              <Tooltip title={queue.description} className="relative z-10 inline-flex shrink-0">
                <InfoIcon className="size-3.5 text-muted-foreground transition-colors hover:text-foreground" />
              </Tooltip>
            )}
          </div>

          <div className="flex min-h-5 flex-wrap items-center gap-1.5 empty:hidden">
            {queue.isPaused && (
              <Badge
                variant="secondary"
                className="relative z-10 bg-status-paused/20 text-foreground"
              >
                <PauseIcon aria-hidden="true" />
                {t('MENU.PAUSED')}
              </Badge>
            )}
            {queue.readOnlyMode && (
              <Badge variant="outline" className="relative z-10 text-muted-foreground">
                <LockIcon aria-hidden="true" />
                {t('QUEUE.INFO.READ_ONLY')}
              </Badge>
            )}
            <RateLimitBadge queue={queue} />
            <WorkersBadge queue={queue} />
          </div>
        </div>

        {!queue.readOnlyMode && (
          <div className="relative z-10 -mt-1 -mr-1.5 shrink-0">
            <QueueDropdownActions
              queue={queue}
              actions={{
                ...actions,
                addJob: () => modal.open('addJob'),
                onConcurrency: () => modal.open('concurrency'),
                onRateLimit: () => modal.open('rateLimit'),
              }}
            />
          </div>
        )}
      </div>

      <QueueStats queue={queue} />

      <Suspense fallback={null}>
        {modal.isMounted('addJob') && (
          <AddJobModalLazy
            open={modal.isOpen('addJob')}
            onClose={modal.close('addJob')}
            job={editJob}
            queue={queue}
          />
        )}
        {modal.isMounted('rateLimit') && (
          <RateLimitModalLazy
            open={modal.isOpen('rateLimit')}
            onClose={modal.close('rateLimit')}
            queue={queue}
          />
        )}
        {modal.isMounted('concurrency') && (
          <ConcurrencyModalLazy
            open={modal.isOpen('concurrency')}
            onClose={modal.close('concurrency')}
            queue={queue}
          />
        )}
      </Suspense>
    </Card>
  );
};
