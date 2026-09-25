import type { PgBossQueueSummary } from '@worker-manager/api/typings/app';
import {
  EllipsisVerticalIcon,
  PlusIcon,
  RotateCcwIcon,
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
import { usePgBossActions } from '../hooks/usePgBossActions';
import type { PgBossPermissions } from '../hooks/usePgBossInfo';

interface PgBossQueueActionsProps {
  queue: PgBossQueueSummary;
  permissions: PgBossPermissions;
  onSendJob(): void;
  className?: string;
}

/** A queue's menu: send a job, retry its failures, and clear its queued or finished jobs. */
export const PgBossQueueActions = ({
  queue,
  permissions,
  onSendJob,
  className,
}: PgBossQueueActionsProps) => {
  const { t } = useTranslation();
  const actions = usePgBossActions();
  const canSend = permissions.can('send');
  const canRetry = permissions.can('retry') && queue.counts.failed > 0;
  const canDelete = permissions.can('delete');

  if (!canSend && !canRetry && !canDelete) {
    return null;
  }

  return (
    // Not modal, for the same reason as the BullMQ queue menu: an item opens a dialog of its own.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('PGBOSS.ACTIONS.QUEUE_ACTIONS')}
          className={cn('text-muted-foreground hover:text-foreground max-md:size-10', className)}
        >
          <EllipsisVerticalIcon />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-52">
        {canSend && (
          <DropdownMenuItem onClick={onSendJob}>
            <PlusIcon />
            {t('PGBOSS.ACTIONS.SEND.LABEL')}
          </DropdownMenuItem>
        )}
        {canRetry && (
          <DropdownMenuItem onClick={actions.retryFailed(queue.name)}>
            <RotateCcwIcon />
            {t('PGBOSS.ACTIONS.RETRY_FAILED.LABEL')}
          </DropdownMenuItem>
        )}
        {canDelete && (
          <>
            {(canSend || canRetry) && <DropdownMenuSeparator />}
            <DropdownMenuItem variant="destructive" onClick={actions.deleteQueued(queue.name)}>
              <Trash2Icon />
              {t('PGBOSS.ACTIONS.DELETE_QUEUED.LABEL')}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={actions.deleteStored(queue.name)}>
              <TriangleAlertIcon />
              {t('PGBOSS.ACTIONS.DELETE_STORED.LABEL')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
