import { STATUSES } from '@worker-manager/api/constants/statuses';
import type { Status } from '@worker-manager/api/typings/app';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { dynamicTranslationKey } from '../../../utils/dynamicTranslationKey';
import { HintTooltip } from '../../HintTooltip/HintTooltip';
import { ClockIcon } from '../../Icons/Clock';
import { DuplicateIcon } from '../../Icons/Duplicate';
import { PriorityIcon } from '../../Icons/Priority';
import { PromoteIcon } from '../../Icons/Promote';
import { RemoveChildrenIcon } from '../../Icons/RemoveChildren';
import { RetryIcon } from '../../Icons/Retry';
import { TrashIcon } from '../../Icons/Trash';
import { UpdateIcon } from '../../Icons/UpdateIcon';

interface JobActionsProps {
  status: Status;
  allowRetries: boolean;
  actions: {
    promoteJob: () => Promise<void>;
    retryJob: () => Promise<void>;
    cleanJob: () => Promise<void>;
    updateJobData: () => void;
    duplicateJob: () => void;
    rescheduleJob: () => void;
    reprioritiseJob: () => void;
    removeUnprocessedChildren: () => Promise<void>;
  };
}

interface ButtonType {
  titleKey: string;
  Icon: React.ElementType;
  actionKey:
    | 'promoteJob'
    | 'cleanJob'
    | 'retryJob'
    | 'updateJobData'
    | 'duplicateJob'
    | 'rescheduleJob'
    | 'reprioritiseJob'
    | 'removeUnprocessedChildren';
}

const buttonTypes: Record<string, ButtonType> = {
  updateData: { titleKey: 'UPDATE_DATA', Icon: UpdateIcon, actionKey: 'updateJobData' },
  promote: { titleKey: 'PROMOTE', Icon: PromoteIcon, actionKey: 'promoteJob' },
  clean: { titleKey: 'CLEAN', Icon: TrashIcon, actionKey: 'cleanJob' },
  retry: { titleKey: 'RETRY', Icon: RetryIcon, actionKey: 'retryJob' },
  duplicate: { titleKey: 'DUPLICATE', Icon: DuplicateIcon, actionKey: 'duplicateJob' },
  reschedule: { titleKey: 'RESCHEDULE', Icon: ClockIcon, actionKey: 'rescheduleJob' },
  reprioritise: { titleKey: 'REPRIORITISE', Icon: PriorityIcon, actionKey: 'reprioritiseJob' },
  removeChildren: {
    titleKey: 'REMOVE_UNPROCESSED_CHILDREN',
    Icon: RemoveChildrenIcon,
    actionKey: 'removeUnprocessedChildren',
  },
} as const;

const statusToButtonsMap: Record<string, ButtonType[]> = {
  [STATUSES.failed]: [
    buttonTypes.retry,
    buttonTypes.duplicate,
    buttonTypes.updateData,
    buttonTypes.clean,
  ],
  [STATUSES.delayed]: [
    buttonTypes.promote,
    buttonTypes.reschedule,
    buttonTypes.duplicate,
    buttonTypes.updateData,
    buttonTypes.clean,
  ],
  [STATUSES.completed]: [buttonTypes.duplicate, buttonTypes.retry, buttonTypes.clean],
  [STATUSES.waiting]: [buttonTypes.duplicate, buttonTypes.updateData, buttonTypes.clean],
  [STATUSES.waitingChildren]: [
    buttonTypes.removeChildren,
    buttonTypes.duplicate,
    buttonTypes.updateData,
    buttonTypes.clean,
  ],
  [STATUSES.prioritized]: [
    buttonTypes.reprioritise,
    buttonTypes.duplicate,
    buttonTypes.updateData,
    buttonTypes.clean,
  ],
  [STATUSES.paused]: [buttonTypes.duplicate, buttonTypes.updateData, buttonTypes.clean],
} as const;

export const JobActions = ({ actions, status, allowRetries }: JobActionsProps) => {
  let buttons = statusToButtonsMap[status];
  const { t } = useTranslation();
  if (!buttons) {
    return null;
  }

  if (!allowRetries) {
    buttons = buttons.filter((btn) => btn.actionKey !== 'retryJob');
  }

  return (
    <ul className="m-0 flex list-none items-center gap-0.5 p-0">
      {buttons.map((type) => {
        const title = t(dynamicTranslationKey(`JOB.ACTIONS.${type.titleKey}`));
        return (
          <li key={type.titleKey}>
            <HintTooltip title={title}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={title}
                onClick={actions[type.actionKey]}
                className={cn(
                  'text-muted-foreground hover:text-foreground [&_svg]:size-4',
                  type.actionKey === 'cleanJob' && 'hover:bg-destructive/10 hover:text-destructive'
                )}
              >
                <type.Icon />
              </Button>
            </HintTooltip>
          </li>
        );
      })}
    </ul>
  );
};
