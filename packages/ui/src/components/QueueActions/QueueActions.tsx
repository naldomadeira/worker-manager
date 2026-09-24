import { STATUSES } from '@worker-manager/api/constants/statuses';
import type {
  AppQueue,
  JobCleanStatus,
  JobRetryStatus,
  Status,
} from '@worker-manager/api/typings/app';
import { ArrowUpFromLineIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { QueueActions as QueueActionsType } from '../../../typings/app';

interface QueueActionProps {
  queue: AppQueue;
  actions: QueueActionsType;
  status: Status;
  allowRetries: boolean;
}

const ACTIONABLE_STATUSES = [STATUSES.failed, STATUSES.delayed, STATUSES.completed] as const;

const isStatusActionable = (status: any): boolean => ACTIONABLE_STATUSES.includes(status);

function isCleanAllStatus(status: any): status is JobCleanStatus {
  return [STATUSES.failed, STATUSES.delayed, STATUSES.completed].includes(status);
}

function isRetryAllStatus(status: any): status is JobRetryStatus {
  return [STATUSES.failed, STATUSES.completed].includes(status);
}

function isPromoteAllStatus(status: any): status is JobRetryStatus {
  return [STATUSES.delayed].includes(status);
}

export const QueueActions = ({ status, actions, queue, allowRetries }: QueueActionProps) => {
  const { t } = useTranslation();
  if (!isStatusActionable(status)) {
    return null;
  }

  return (
    <ul className="m-0 flex list-none flex-wrap items-center gap-2 p-0">
      {isRetryAllStatus(status) && allowRetries && (
        <li>
          <Button variant="outline" size="sm" onClick={actions.retryAll(queue.name, status)}>
            <RotateCcwIcon data-icon="inline-start" className="text-muted-foreground" />
            {t('QUEUE.ACTIONS.RETRY_ALL')}
          </Button>
        </li>
      )}
      {isPromoteAllStatus(status) && (
        <li>
          <Button variant="outline" size="sm" onClick={actions.promoteAll(queue.name)}>
            <ArrowUpFromLineIcon data-icon="inline-start" className="text-muted-foreground" />
            {t('QUEUE.ACTIONS.PROMOTE_ALL')}
          </Button>
        </li>
      )}
      {isCleanAllStatus(status) && (
        <li>
          <Button
            variant="outline"
            size="sm"
            className="hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
            onClick={actions.cleanAll(queue.name, status)}
          >
            <Trash2Icon data-icon="inline-start" className="text-muted-foreground" />
            {t('QUEUE.ACTIONS.CLEAN_ALL')}
          </Button>
        </li>
      )}
    </ul>
  );
};
