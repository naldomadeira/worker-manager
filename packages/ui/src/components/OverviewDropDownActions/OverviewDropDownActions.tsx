import type { AppQueue } from '@worker-manager/api/typings/app';
import { EllipsisIcon, PauseIcon, PlayIcon, RotateCcwIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { QueueActions } from '../../../typings/app';
import type { QueueSortKey, SortDirection } from '../../hooks/useSortQueues';
import { retriableFailedJobs } from '../../utils/failedRetries';

type OverviewActionsProps = {
  actions: QueueActions;
  queues: AppQueue[] | null;
  /**
   * Sorting moved into the overview toolbar, next to the search. These stay accepted so callers
   * written against the older menu keep compiling; the menu itself no longer reads them.
   */
  onSort?: (sortKey: QueueSortKey) => void;
  sortBy?: QueueSortKey;
  sortDirection?: SortDirection;
};

/** Board-wide bulk actions: pause or resume every queue, retry every failed job. */
export const OverviewActions = ({ actions, queues }: OverviewActionsProps) => {
  const { t } = useTranslation();

  if (!queues || queues.length === 0) {
    return null;
  }

  const areAllReadOnly = queues.every((queue) => queue.readOnlyMode);
  if (areAllReadOnly) {
    return null;
  }

  const areAllPaused = queues.every((queue) => queue.isPaused);
  const retriable = retriableFailedJobs(queues);

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label={t('DASHBOARD.BULK_ACTIONS')}>
          <EllipsisIcon />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {t('DASHBOARD.BULK_ACTIONS')}
        </DropdownMenuLabel>
        {areAllPaused ? (
          <DropdownMenuItem onClick={actions.resumeAll}>
            <PlayIcon />
            {t('QUEUE.ACTIONS.RESUME_ALL')}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={actions.pauseAll}>
            <PauseIcon />
            {t('QUEUE.ACTIONS.PAUSE_ALL')}
          </DropdownMenuItem>
        )}
        {retriable.queueNames.length > 0 && (
          <DropdownMenuItem onClick={actions.retryFailedInQueues(retriable)}>
            <RotateCcwIcon />
            {t('QUEUE.ACTIONS.RETRY_FAILED_IN_ALL_QUEUES', { count: retriable.jobCount })}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default OverviewActions;
