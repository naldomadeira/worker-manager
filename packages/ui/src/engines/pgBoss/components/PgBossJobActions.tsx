import type { PgBossJobState } from '@worker-manager/api/typings/app';
import { BanIcon, PlayIcon } from 'lucide-react';
import type { ElementType } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { HintTooltip } from '../../../components/HintTooltip/HintTooltip';
import { DuplicateIcon } from '../../../components/Icons/Duplicate';
import { RetryIcon } from '../../../components/Icons/Retry';
import { TrashIcon } from '../../../components/Icons/Trash';
import type { PgBossPermissions } from '../hooks/usePgBossInfo';
import type { PgBossJobCommand } from '../services/PgBossApi';
import { canDuplicate, commandsFor } from '../utils/states';

export interface PgBossJobActionHandlers {
  command(command: PgBossJobCommand): () => Promise<boolean>;
  duplicate(): void;
}

type ButtonKey = PgBossJobCommand | 'duplicate';

const BUTTONS: Record<
  ButtonKey,
  {
    Icon: ElementType;
    labelKey:
      | 'PGBOSS.ACTIONS.RETRY.LABEL'
      | 'PGBOSS.ACTIONS.CANCEL.LABEL'
      | 'PGBOSS.ACTIONS.RESUME.LABEL'
      | 'PGBOSS.ACTIONS.DELETE.LABEL'
      | 'PGBOSS.ACTIONS.DUPLICATE.LABEL';
  }
> = {
  retry: { Icon: RetryIcon, labelKey: 'PGBOSS.ACTIONS.RETRY.LABEL' },
  resume: { Icon: PlayIcon, labelKey: 'PGBOSS.ACTIONS.RESUME.LABEL' },
  duplicate: { Icon: DuplicateIcon, labelKey: 'PGBOSS.ACTIONS.DUPLICATE.LABEL' },
  cancel: { Icon: BanIcon, labelKey: 'PGBOSS.ACTIONS.CANCEL.LABEL' },
  delete: { Icon: TrashIcon, labelKey: 'PGBOSS.ACTIONS.DELETE.LABEL' },
};

/** The order buttons appear in, the most likely first and the destructive ones last. */
const ORDER: ButtonKey[] = ['retry', 'resume', 'duplicate', 'cancel', 'delete'];

/**
 * The commands a job in this state accepts, as icon buttons like BullMQ's job actions: retry a
 * failed job, resume a cancelled one, cancel an unfinished one, delete anything not running, and
 * duplicate what one might want to run again. Each one also needs the board's permission.
 */
export const PgBossJobActions = ({
  state,
  permissions,
  actions,
}: {
  state: PgBossJobState;
  permissions: PgBossPermissions;
  actions: PgBossJobActionHandlers;
}) => {
  const { t } = useTranslation();
  const allowed = new Set<ButtonKey>(
    commandsFor(state).filter((command) => permissions.can(command))
  );
  if (canDuplicate(state) && permissions.can('send')) allowed.add('duplicate');

  const buttons = ORDER.filter((key) => allowed.has(key));
  if (buttons.length === 0) {
    return null;
  }

  return (
    <ul className="m-0 flex list-none items-center gap-0.5 p-0">
      {buttons.map((key) => {
        const { Icon, labelKey } = BUTTONS[key];
        const label = t(labelKey);
        const destructive = key === 'delete' || key === 'cancel';
        return (
          <li key={key}>
            <HintTooltip title={label}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={label}
                onClick={key === 'duplicate' ? actions.duplicate : actions.command(key)}
                className={cn(
                  'text-muted-foreground hover:text-foreground [&_svg]:size-4',
                  destructive && 'hover:bg-destructive/10 hover:text-destructive'
                )}
              >
                <Icon />
              </Button>
            </HintTooltip>
          </li>
        );
      })}
    </ul>
  );
};
