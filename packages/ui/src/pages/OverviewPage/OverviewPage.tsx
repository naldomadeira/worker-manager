import { InboxIcon, SearchXIcon } from 'lucide-react';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { LoadError } from '../../components/LoadError/LoadError';
import { OverviewTree } from '../../components/OverviewTree/OverviewTree';
import { QueueCardGrid } from '../../components/QueueCard/QueueCardGrid';
import { StatusLegend } from '../../components/StatusLegend/StatusLegend';
import { StickyHeader } from '../../components/StickyHeader/StickyHeader';
import { useElementHeight } from '../../hooks/useElementHeight';
import { useQueues } from '../../hooks/useQueues';
import { useQueueSearch } from '../../hooks/useQueueSearch';
import { useSearchParams } from '../../hooks/useSearchParams';
import { useSettingsStore } from '../../hooks/useSettings';
import { useSortQueues } from '../../hooks/useSortQueues';
import { useUIConfig } from '../../hooks/useUIConfig';
import { links } from '../../utils/links';
import { collectGroupPaths, toTree } from '../../utils/toTree';
import { OverviewKpis, OverviewKpisSkeleton } from './OverviewKpis';
import { OverviewToolbar } from './OverviewToolbar';

const CardsSkeleton = () => (
  <ul
    aria-hidden="true"
    className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-[repeat(auto-fill,minmax(19rem,1fr))]"
  >
    {Array.from({ length: 6 }, (_, index) => (
      <li
        key={index}
        className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
      >
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="size-6 rounded-md" />
        </div>
        <Skeleton className="h-2 w-full rounded-full" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-16" />
        </div>
      </li>
    ))}
  </ul>
);

export const OverviewPage = () => {
  const { t } = useTranslation();
  const { actions, queues, loading, error } = useQueues();
  const query = useSearchParams();
  const { searchTerm, setSearchTerm } = useQueueSearch();
  const groupedSetting = useSettingsStore((state) => state.overview.grouped);
  const groupedDefault = useUIConfig().overview?.groupByDelimiter ?? false;
  const sortQueues = useSettingsStore((state) => state.sortQueues);
  const [headerRef, headerHeight] = useElementHeight<HTMLDivElement>();

  const selectedStatus = query.status;
  const searchLower = searchTerm.toLowerCase();
  const filteredQueues = useMemo(
    () =>
      queues?.filter(
        (queue) =>
          (!selectedStatus || (queue.counts[selectedStatus] ?? 0) > 0) &&
          (!searchTerm || queue.name.toLowerCase().includes(searchLower))
      ) || [],
    [queues, selectedStatus, searchTerm, searchLower]
  );

  const {
    sortedQueues: queuesToView,
    onSort,
    sortKey,
    sortDirection,
  } = useSortQueues(filteredQueues);

  const tree = useMemo(() => toTree(filteredQueues, sortQueues), [filteredQueues, sortQueues]);
  const groupPaths = useMemo(() => collectGroupPaths(tree), [tree]);
  const hasGroups = groupPaths.length > 0;
  const grouped = (groupedSetting ?? groupedDefault) && hasGroups;
  const searchActive = searchTerm.trim().length > 0;
  const isLoading = loading && !queues;

  const renderContent = () => {
    if (!queues && error) {
      return <LoadError error={error} onRetry={actions.updateQueues} />;
    }

    if (isLoading) {
      return <CardsSkeleton />;
    }

    if (filteredQueues.length === 0) {
      const filtered = searchActive || !!selectedStatus;
      return (
        <Empty className="mt-4 border bg-card/50 py-14 animate-fade-in-up">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="size-10 rounded-xl">
              {filtered ? <SearchXIcon className="size-5" /> : <InboxIcon className="size-5" />}
            </EmptyMedia>
            <EmptyTitle className="text-base">
              {selectedStatus
                ? t('DASHBOARD.EMPTY_STATE_FILTERED', { status: selectedStatus })
                : t('DASHBOARD.EMPTY_STATE')}
            </EmptyTitle>
            {searchActive && (
              <EmptyDescription>
                {t('DASHBOARD.EMPTY_STATE_SEARCH', { term: searchTerm.trim() })}
              </EmptyDescription>
            )}
          </EmptyHeader>
          {filtered && (
            <EmptyContent>
              <Button variant="outline" size="sm" asChild>
                <Link to={links.dashboardPage()} onClick={() => setSearchTerm('')}>
                  {t('DASHBOARD.CLEAR_FILTERS')}
                </Link>
              </Button>
            </EmptyContent>
          )}
        </Empty>
      );
    }

    if (grouped) {
      return <OverviewTree tree={tree} searchActive={searchActive} />;
    }

    return <QueueCardGrid items={queuesToView.map((queue) => ({ key: queue.name, queue }))} />;
  };

  return (
    <section
      className="flex flex-col gap-5"
      style={
        {
          '--overview-group-top': `calc(var(--header-offset) + ${headerHeight}px)`,
        } as React.CSSProperties
      }
    >
      {isLoading ? <OverviewKpisSkeleton /> : <OverviewKpis queues={queues ?? []} />}

      <div className="flex flex-col gap-4">
        <StickyHeader
          ref={headerRef}
          actions={
            <OverviewToolbar
              actions={actions}
              queues={queues}
              grouped={grouped}
              hasGroups={hasGroups}
              groupPaths={groupPaths}
              onSort={onSort}
              sortKey={sortKey}
              sortDirection={sortDirection}
            />
          }
        >
          <StatusLegend />
        </StickyHeader>

        {renderContent()}
      </div>
    </section>
  );
};
