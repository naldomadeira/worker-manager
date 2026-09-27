import { BanIcon, PlayIcon, XIcon } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ElementType } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { RetryIcon } from '../../../components/Icons/Retry';
import { TrashIcon } from '../../../components/Icons/Trash';
import type { PgBossJobCommand } from '../services/PgBossApi';

const BUTTONS: Record<
  PgBossJobCommand,
  {
    Icon: ElementType;
    labelKey:
      | 'PGBOSS.ACTIONS.RETRY.LABEL'
      | 'PGBOSS.ACTIONS.CANCEL.LABEL'
      | 'PGBOSS.ACTIONS.RESUME.LABEL'
      | 'PGBOSS.ACTIONS.DELETE.LABEL';
    destructive: boolean;
  }
> = {
  retry: { Icon: RetryIcon, labelKey: 'PGBOSS.ACTIONS.RETRY.LABEL', destructive: false },
  resume: { Icon: PlayIcon, labelKey: 'PGBOSS.ACTIONS.RESUME.LABEL', destructive: false },
  cancel: { Icon: BanIcon, labelKey: 'PGBOSS.ACTIONS.CANCEL.LABEL', destructive: true },
  delete: { Icon: TrashIcon, labelKey: 'PGBOSS.ACTIONS.DELETE.LABEL', destructive: true },
};

const ORDER: PgBossJobCommand[] = ['retry', 'resume', 'cancel', 'delete'];

interface PgBossBulkBarProps {
  count: number;
  commands: PgBossJobCommand[];
  busy: boolean;
  onCommand(command: PgBossJobCommand): void;
  onClear(): void;
}

/**
 * The bar that follows the list while jobs are selected: how many, the commands every one of
 * them accepts, and a way out. It sticks to the bottom of the viewport so it stays in reach on
 * a long page.
 */
export const PgBossBulkBar = ({
  count,
  commands,
  busy,
  onCommand,
  onClear,
}: PgBossBulkBarProps) => {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const shown = ORDER.filter((command) => commands.includes(command));

  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          key="bulk-bar"
          role="toolbar"
          aria-label={t('PGBOSS.BULK.TOOLBAR')}
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] } }}
          exit={reduceMotion ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: 16 }}
          className="sticky bottom-4 z-30 mx-auto mt-4 flex w-fit max-w-full flex-wrap items-center gap-1 rounded-xl border bg-popover/95 px-2 py-1.5 text-popover-foreground shadow-popover backdrop-blur-sm"
        >
          <span
            aria-live="polite"
            className="px-2 text-sm font-medium whitespace-nowrap tabular-nums"
          >
            {t('PGBOSS.BULK.SELECTED', { count })}
          </span>
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
          {shown.length === 0 ? (
            <span className="px-2 text-xs text-muted-foreground">{t('PGBOSS.BULK.NO_COMMON')}</span>
          ) : (
            shown.map((command) => {
              const { Icon, labelKey, destructive } = BUTTONS[command];
              return (
                <Button
                  key={command}
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => onCommand(command)}
                  className={cn(
                    '[&_svg]:size-4',
                    destructive && 'hover:bg-destructive/10 hover:text-destructive'
                  )}
                >
                  <Icon data-icon="inline-start" />
                  {t(labelKey)}
                </Button>
              );
            })
          )}
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onClear}
            aria-label={t('PGBOSS.BULK.CLEAR')}
            title={t('PGBOSS.BULK.CLEAR')}
            className="text-muted-foreground hover:text-foreground"
          >
            <XIcon />
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
