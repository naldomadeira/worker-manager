import { ChevronsUpDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHistory, useLocation } from 'react-router-dom';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useActiveQueueName } from '../../../hooks/useActiveQueueName';
import { navQueueTotal, useBoardNavigation } from '../../../hooks/useBoardNavigation';
import { useUIConfig } from '../../../hooks/useUIConfig';
import { links } from '../../../utils/links';

const activeItem =
  'bg-state-selected font-medium text-state-selected-foreground focus:bg-state-selected-hover';

export const MobileQueueDropdown = () => {
  const { t } = useTranslation();
  const { queues, showSchedules: showJobSchedulers } = useBoardNavigation();
  const activeQueueName = useActiveQueueName();
  const { hasHistoryProvider = false } = useUIConfig();
  const history = useHistory();
  const { pathname } = useLocation();

  const currentQueue = queues?.find((queue) => queue.name === activeQueueName);

  /* A quick switcher for small screens, next to the sidebar drawer. */
  const pages = [
    { path: '/', label: t('MENU.OVERVIEW'), show: true },
    {
      path: links.metricsHistory().pathname,
      label: t('MENU.METRICS_HISTORY'),
      show: hasHistoryProvider,
    },
    {
      path: links.jobSchedulers().pathname,
      label: t('MENU.SCHEDULERS'),
      show: !!showJobSchedulers,
    },
  ].filter((page) => page.show);

  const activePage = activeQueueName ? undefined : pages.find((page) => page.path === pathname);
  const displayName = currentQueue?.name || activePage?.label || t('MENU.OVERVIEW');

  const handleQueueSelect = (queueName: string) => {
    const { pathname: to, search } = links.queuePage(queueName);
    history.push({ pathname: to, search });
  };

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 text-left text-sm font-medium shadow-xs outline-none transition-colors',
          'hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-muted dark:bg-input/30'
        )}
      >
        <span className="min-w-0 truncate">{displayName}</span>
        <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        className="max-h-[60vh] w-(--radix-dropdown-menu-trigger-width) overflow-y-auto"
      >
        {pages.map((page) => (
          <DropdownMenuItem
            key={page.path}
            className={cn(activePage?.path === page.path && activeItem)}
            onSelect={() => history.push(page.path)}
          >
            {page.label}
          </DropdownMenuItem>
        ))}

        {queues && queues.length > 0 && (
          <>
            <DropdownMenuSeparator />
            {queues.map((queue) => (
              <DropdownMenuItem
                key={queue.name}
                className={cn(queue.name === activeQueueName && activeItem)}
                onSelect={() => handleQueueSelect(queue.name)}
              >
                <span className="min-w-0 flex-1 truncate">{queue.name}</span>
                {queue.counts && (
                  <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 text-xs leading-5 text-muted-foreground tabular-nums">
                    {navQueueTotal(queue)}
                  </span>
                )}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
