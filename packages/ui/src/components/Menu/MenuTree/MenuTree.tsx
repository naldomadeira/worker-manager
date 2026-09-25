import { ChevronRight, Folder, FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { useActiveQueueName } from '../../../hooks/useActiveQueueName';
import type { NavQueue } from '../../../hooks/useBoardNavigation';
import { useMenuState } from '../../../hooks/useMenuState';
import { useSelectedStatuses } from '../../../hooks/useSelectedStatuses';
import { links } from '../../../utils/links';
import { countPausedQueues, countQueues } from '../../../utils/queueTreeCounts';
import { QueueTreeNode } from '../../../utils/toTree';

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

/** Leading dot: pulses while jobs run, turns red on failures, greys out when paused. */
const QueueStatusDot = ({ queue }: { queue: NavQueue }) => {
  const failed = queue.counts.failed || 0;
  const active = queue.counts.active || 0;

  return (
    <span
      aria-hidden="true"
      className={cn(
        'size-1.5 shrink-0 rounded-full transition-colors',
        queue.isPaused
          ? 'bg-status-paused'
          : failed > 0
            ? 'bg-status-failed'
            : active > 0
              ? 'animate-pulse-ring bg-status-active text-status-active'
              : 'bg-muted-foreground/40'
      )}
    />
  );
};

const QueueBadges = ({ queue }: { queue: NavQueue }) => {
  const { t } = useTranslation();
  const failed = queue.counts.failed || 0;
  const active = queue.counts.active || 0;

  return (
    <span className="ml-auto flex shrink-0 items-center gap-1 group-data-[collapsible=icon]:hidden">
      {queue.isPaused && (
        <span className="rounded-sm bg-status-paused/15 px-1 text-[0.65rem] leading-4 font-medium text-status-paused uppercase">
          {t('MENU.PAUSED')}
        </span>
      )}
      {active > 0 && (
        <span className="rounded-sm bg-status-active/15 px-1 text-[0.65rem] leading-4 font-medium text-status-active tabular-nums">
          {compact.format(active)}
        </span>
      )}
      {failed > 0 && (
        <span className="rounded-sm bg-status-failed/15 px-1 text-[0.65rem] leading-4 font-medium text-status-failed tabular-nums">
          {compact.format(failed)}
        </span>
      )}
    </span>
  );
};

export const MenuTree = ({
  tree,
  level = 0,
  parentPath = '',
}: {
  tree: QueueTreeNode<NavQueue>;
  level?: number;
  parentPath?: string;
}) => {
  const { t } = useTranslation();
  const selectedStatuses = useSelectedStatuses();
  const activeQueueName = useActiveQueueName();
  const toggleMenu = useMenuState((state) => state.toggleMenu);
  const childPaths = tree.children.map((node) =>
    parentPath ? `${parentPath}/${node.name}` : node.name
  );
  const openStates = useMenuState(
    useShallow((state) => childPaths.map((path) => state.isMenuOpen(path)))
  );

  const List = level > 0 ? SidebarMenuSub : SidebarMenu;

  return (
    <List className={cn(level > 0 ? 'mr-0 gap-0.5 pr-0' : 'gap-0.5')}>
      {tree.children.map((node, index) => {
        const isLeafNode = !node.children.length;
        const menuPath = childPaths[index];
        const isOpen = openStates[index];

        if (isLeafNode) {
          const queue = node.queue!;
          const isActive = queue.name === activeQueueName;
          return (
            <SidebarMenuItem key={node.name} className="animate-in duration-300 fade-in-0">
              <SidebarMenuButton
                asChild
                size="sm"
                isActive={isActive}
                className={cn(
                  'relative h-7 gap-2 pr-1.5 text-[0.8125rem] transition-colors',
                  isActive &&
                    'before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-sidebar-primary'
                )}
              >
                <Link
                  to={links.queuePage(queue.name, selectedStatuses)}
                  title={node.name}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <QueueStatusDot queue={queue} />
                  <span className="min-w-0 truncate">{node.name}</span>
                  <QueueBadges queue={queue} />
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        }

        const pausedCount = countPausedQueues(node);

        return (
          <Collapsible
            key={node.name}
            asChild
            open={isOpen}
            onOpenChange={() => toggleMenu(menuPath)}
          >
            <SidebarMenuItem>
              <CollapsibleTrigger asChild>
                <SidebarMenuButton
                  size="sm"
                  className="group/group-header h-7 gap-1.5 pr-1.5 text-xs font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground"
                >
                  <ChevronRight
                    aria-hidden="true"
                    className={cn(
                      'size-3.5! transition-transform duration-200 ease-out',
                      isOpen && 'rotate-90'
                    )}
                  />
                  {isOpen ? (
                    <FolderOpen aria-hidden="true" className="size-3.5! opacity-70" />
                  ) : (
                    <Folder aria-hidden="true" className="size-3.5! opacity-70" />
                  )}
                  <span className="min-w-0 truncate">{node.name}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1 text-[0.65rem] font-normal tabular-nums opacity-80">
                    {countQueues(node)}
                    {pausedCount > 0 && (
                      <span className="text-status-paused">
                        {' · '}
                        {pausedCount} {t('MENU.PAUSED').toLowerCase()}
                      </span>
                    )}
                  </span>
                </SidebarMenuButton>
              </CollapsibleTrigger>
              <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
                <MenuTree tree={node} level={level + 1} parentPath={menuPath} />
              </CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>
        );
      })}
    </List>
  );
};
