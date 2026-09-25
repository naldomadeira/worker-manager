import { STATUSES } from '@worker-manager/api/constants/statuses';
import type { AppQueue } from '@worker-manager/api/typings/app';
import {
  EllipsisVerticalIcon,
  GaugeIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  TimerIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { QueueActions } from '../../../typings/app';
import { can } from '../../utils/capabilities';
import { canRetryFailedJobs } from '../../utils/failedRetries';

export const QueueDropdownActions = ({
  queue,
  actions,
  className,
}: {
  queue: AppQueue;
  actions: Omit<QueueActions, 'addJob'> & {
    addJob: () => void;
    onConcurrency?: () => void;
    onRateLimit?: () => void;
  };
  className?: string;
}) => {
  const { t } = useTranslation();
  const showConcurrency = can(queue, 'globalConcurrency') && !!actions.onConcurrency;
  const showRateLimit = can(queue, 'globalRateLimit') && !!actions.onRateLimit;

  return (
    // Not modal: several items open a dialog of their own, and a modal menu handing focus back
    // to its trigger while that dialog mounts leaves the page inert.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('QUEUE.ACTIONS.QUEUE_ACTIONS')}
          className={cn('text-muted-foreground hover:text-foreground max-md:size-10', className)}
        >
          <EllipsisVerticalIcon />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuItem onClick={actions.addJob}>
          <PlusIcon />
          {t('QUEUE.ACTIONS.ADD_JOB')}
        </DropdownMenuItem>
        {canRetryFailedJobs(queue) && (
          <DropdownMenuItem onClick={actions.retryAll(queue.name, STATUSES.failed)}>
            <RotateCcwIcon />
            {t('QUEUE.ACTIONS.RETRY_ALL_FAILED', { count: queue.counts.failed })}
          </DropdownMenuItem>
        )}
        {can(queue, 'pause') && (
          <DropdownMenuItem
            onClick={
              queue.isPaused ? actions.resumeQueue(queue.name) : actions.pauseQueue(queue.name)
            }
          >
            {queue.isPaused ? (
              <>
                <PlayIcon />
                {t('QUEUE.ACTIONS.RESUME')}
              </>
            ) : (
              <>
                <PauseIcon />
                {t('QUEUE.ACTIONS.PAUSE')}
              </>
            )}
          </DropdownMenuItem>
        )}
        {(showConcurrency || showRateLimit) && <DropdownMenuSeparator />}
        {showConcurrency && (
          <DropdownMenuItem onClick={actions.onConcurrency}>
            <GaugeIcon />
            {t('QUEUE.ACTIONS.SET_CONCURRENCY')}
          </DropdownMenuItem>
        )}
        {showRateLimit && (
          <DropdownMenuItem onClick={actions.onRateLimit}>
            <TimerIcon />
            {t('QUEUE.ACTIONS.SET_RATE_LIMIT')}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={actions.emptyQueue(queue.name)}>
          <Trash2Icon />
          {t('QUEUE.ACTIONS.EMPTY')}
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={actions.obliterateQueue(queue.name)}>
          <TriangleAlertIcon />
          {t('QUEUE.ACTIONS.OBLITERATE')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
