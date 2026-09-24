import {
  ChevronRightIcon,
  EllipsisVerticalIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useOverviewState } from '../../hooks/useMenuState';
import { useQueues } from '../../hooks/useQueues';
import { dynamicTranslationKey } from '../../utils/dynamicTranslationKey';
import { retriableFailedJobs } from '../../utils/failedRetries';
import {
  aggregateCounts,
  areAllPaused,
  collectQueueNames,
  collectQueues,
  countPausedQueues,
  countQueues,
  type AggregatedCounts,
} from '../../utils/queueTreeCounts';
import { AppQueueTreeNode } from '../../utils/toTree';
import { QueueCardGrid } from '../QueueCard/QueueCardGrid';

const toDomId = (path: string) => `overview-group-${path.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

const AggregateCounts = ({ counts }: { counts: AggregatedCounts }) => {
  const { t } = useTranslation();

  if (counts.total === 0) {
    return (
      <span className="text-xs text-muted-foreground tabular-nums">
        {t('DASHBOARD.JOBS_COUNT', { count: 0 })}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-3">
      {/* The group's composition at a glance, mirroring the pulse bar on each card. */}
      <span
        aria-hidden="true"
        className="hidden h-1.5 w-20 gap-px overflow-hidden rounded-full bg-muted sm:flex"
      >
        {counts.statuses.map((status) => (
          <span
            key={status}
            className="h-full min-w-1 transition-[width] duration-500 ease-out"
            style={{
              width: `${((counts.byStatus[status] ?? 0) / counts.total) * 100}%`,
              backgroundColor: `var(--status-${status})`,
            }}
          />
        ))}
      </span>
      <span className="flex items-center gap-2.5">
        {counts.statuses.map((status) => (
          <span
            key={status}
            className="inline-flex items-center gap-1 text-xs text-foreground tabular-nums"
            title={t(dynamicTranslationKey(`QUEUE.STATUS.${status.toUpperCase()}`))}
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: `var(--status-${status})` }}
            />
            {(counts.byStatus[status] ?? 0).toLocaleString()}
          </span>
        ))}
      </span>
    </span>
  );
};

const GroupDropdownActions = ({ node }: { node: AppQueueTreeNode }) => {
  const { t } = useTranslation();
  const { actions } = useQueues();
  const queueNames = collectQueueNames(node, { writableOnly: true });

  if (!queueNames.length) {
    return null;
  }

  const allPaused = areAllPaused(node);
  const retriable = retriableFailedJobs(collectQueues(node));

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          aria-label={t('QUEUE.ACTIONS.GROUP_ACTIONS')}
        >
          <EllipsisVerticalIcon />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-52">
        {allPaused ? (
          <DropdownMenuItem onClick={actions.resumeQueues(queueNames)}>
            <PlayIcon />
            {t('QUEUE.ACTIONS.RESUME_GROUP')}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={actions.pauseQueues(queueNames)}>
            <PauseIcon />
            {t('QUEUE.ACTIONS.PAUSE_GROUP')}
          </DropdownMenuItem>
        )}
        {retriable.queueNames.length > 0 && (
          <DropdownMenuItem onClick={actions.retryFailedInQueues(retriable)}>
            <RotateCcwIcon />
            {t('QUEUE.ACTIONS.RETRY_FAILED_IN_GROUP', { count: retriable.jobCount })}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const OverviewGroup = ({
  node,
  level,
  parentPath,
  searchActive,
}: {
  node: AppQueueTreeNode;
  level: number;
  parentPath: string;
  searchActive: boolean;
}) => {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const menuPath = parentPath ? `${parentPath}/${node.name}` : node.name;
  const storedOpen = useOverviewState((state) => state.isMenuOpen(menuPath));
  const toggleMenu = useOverviewState((state) => state.toggleMenu);
  const isOpen = searchActive || storedOpen;

  const total = countQueues(node);
  const paused = countPausedQueues(node);
  const counts = aggregateCounts(node);
  const regionId = toDomId(menuPath);

  return (
    <section className="flex flex-col" data-level={level}>
      <div
        className={cn(
          'flex items-center justify-between gap-3 border-b py-1.5 max-md:flex-wrap',
          level === 0 && 'sticky z-[1] bg-background'
        )}
        style={level === 0 ? { top: 'var(--overview-group-top, var(--header-offset))' } : undefined}
      >
        <button
          type="button"
          className="group/group-header -ml-2 flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1 text-left text-[0.95rem] font-semibold text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent"
          aria-expanded={isOpen}
          aria-controls={regionId}
          onClick={() => toggleMenu(menuPath)}
          disabled={searchActive}
        >
          <ChevronRightIcon
            aria-hidden="true"
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover/group-header:text-foreground',
              isOpen && 'rotate-90'
            )}
          />
          <span className="min-w-0 truncate" title={node.name}>
            {node.name}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-normal whitespace-nowrap text-muted-foreground tabular-nums">
            {total}
            {paused > 0 && (
              <span className="text-status-paused">
                {' · '}
                {paused} {t('MENU.PAUSED').toLowerCase()}
              </span>
            )}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <AggregateCounts counts={counts} />
          <GroupDropdownActions node={node} />
        </div>
      </div>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id={regionId}
            key="body"
            // Clipped only while the height animates, so card shadows are not cut off at rest.
            initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0, overflow: 'hidden' }}
            animate={
              reduceMotion
                ? { opacity: 1 }
                : { height: 'auto', opacity: 1, transitionEnd: { overflow: 'visible' } }
            }
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0, overflow: 'hidden' }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="pt-4 pl-2 md:pl-4">
              <OverviewTree
                tree={node}
                level={level + 1}
                parentPath={menuPath}
                searchActive={searchActive}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};

export const OverviewTree = ({
  tree,
  level = 0,
  parentPath = '',
  searchActive = false,
}: {
  tree: AppQueueTreeNode;
  level?: number;
  parentPath?: string;
  searchActive?: boolean;
}) => {
  const groups = tree.children.filter((node) => node.children.length > 0);
  const leaves = tree.children.filter((node) => node.children.length === 0 && node.queue);

  return (
    <div className="flex flex-col gap-5">
      {groups.map((node) => (
        <OverviewGroup
          key={node.name}
          node={node}
          level={level}
          parentPath={parentPath}
          searchActive={searchActive}
        />
      ))}
      {leaves.length > 0 && (
        <QueueCardGrid
          items={leaves.map((node) => {
            const queue = node.queue!;
            return {
              key: node.name,
              queue,
              displayName:
                queue.displayName && queue.displayName !== queue.name
                  ? queue.displayName
                  : node.name,
            };
          })}
        />
      )}
    </div>
  );
};
