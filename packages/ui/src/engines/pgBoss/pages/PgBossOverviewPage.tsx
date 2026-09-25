import { InboxIcon, SearchXIcon } from 'lucide-react';
import React, { Suspense, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
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
import { LoadError } from '../../../components/LoadError/LoadError';
import { AnimatedCardGrid } from '../../../components/QueueCard/QueueCardGrid';
import { StickyHeader } from '../../../components/StickyHeader/StickyHeader';
import { useQueueSearch } from '../../../hooks/useQueueSearch';
import { useSettingsStore } from '../../../hooks/useSettings';
import { OverviewKpisSkeleton } from '../../../pages/OverviewPage/OverviewKpis';
import { PgBossQueueCard } from '../components/PgBossQueueCard';
import { PgBossStatsFreshness } from '../components/PgBossStatsFreshness';
import { PgBossWritesDisabledBanner } from '../components/PgBossWritesDisabledBanner';
import { permissionsOf, usePgBossInfo } from '../hooks/usePgBossInfo';
import { usePgBossQueues } from '../hooks/usePgBossQueues';
import {
  OVERVIEW_FILTERS,
  type PgBossOverviewFilter,
  PgBossOverviewKpis,
} from './PgBossOverviewKpis';

const PgBossSendJobModalLazy = React.lazy(() =>
  import('../components/PgBossSendJobModal').then(({ PgBossSendJobModal }) => ({
    default: PgBossSendJobModal,
  }))
);

const CardsSkeleton = () => (
  <ul
    aria-hidden="true"
    data-testid="pgboss-cards-skeleton"
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

const filterLink = (filter?: PgBossOverviewFilter) => ({
  pathname: '/',
  search: filter ? new URLSearchParams({ filter }).toString() : '',
});

/** The pg-boss overview: board-wide KPIs and a card per queue, from the cached counters. */
export const PgBossOverviewPage = () => {
  const { t } = useTranslation();
  const { search } = useLocation();
  const { queues, loading, error, refetch } = usePgBossQueues();
  const { info } = usePgBossInfo();
  const permissions = permissionsOf(info);
  const { searchTerm, setSearchTerm } = useQueueSearch();
  const sortQueues = useSettingsStore((state) => state.sortQueues);
  const [sendTo, setSendTo] = useState<string | null>(null);

  const rawFilter = new URLSearchParams(search).get('filter');
  const filter = OVERVIEW_FILTERS.find((candidate) => candidate === rawFilter);
  const searchLower = searchTerm.trim().toLowerCase();

  const visible = useMemo(() => {
    const filtered = (queues ?? []).filter(
      (queue) =>
        (!filter || queue.counts[filter] > 0) &&
        (!searchLower || queue.name.toLowerCase().includes(searchLower))
    );
    return sortQueues ? [...filtered].sort((a, b) => a.name.localeCompare(b.name)) : filtered;
  }, [queues, filter, searchLower, sortQueues]);

  const isLoading = loading && !queues;

  const renderContent = () => {
    if (!queues && error) {
      return <LoadError error={error} onRetry={refetch} />;
    }
    if (isLoading) {
      return <CardsSkeleton />;
    }
    if (visible.length === 0) {
      const filtered = !!searchLower || !!filter;
      return (
        <Empty className="mt-4 border bg-card/50 py-14 animate-fade-in-up">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="size-10 rounded-xl">
              {filtered ? <SearchXIcon className="size-5" /> : <InboxIcon className="size-5" />}
            </EmptyMedia>
            <EmptyTitle className="text-base">
              {filtered ? t('PGBOSS.EMPTY.QUEUES_FILTERED') : t('PGBOSS.EMPTY.QUEUES')}
            </EmptyTitle>
            {!filtered && <EmptyDescription>{t('PGBOSS.EMPTY.QUEUES_HINT')}</EmptyDescription>}
            {!!searchLower && (
              <EmptyDescription>
                {t('DASHBOARD.EMPTY_STATE_SEARCH', { term: searchTerm.trim() })}
              </EmptyDescription>
            )}
          </EmptyHeader>
          {filtered && (
            <EmptyContent>
              <Button variant="outline" size="sm" asChild>
                <Link to={filterLink()} onClick={() => setSearchTerm('')}>
                  {t('DASHBOARD.CLEAR_FILTERS')}
                </Link>
              </Button>
            </EmptyContent>
          )}
        </Empty>
      );
    }

    return (
      <AnimatedCardGrid
        items={visible.map((queue) => ({ key: queue.name, queue }))}
        renderItem={({ queue }) => (
          <PgBossQueueCard queue={queue} permissions={permissions} onSendJob={setSendTo} />
        )}
      />
    );
  };

  return (
    <section className="flex flex-col gap-5">
      <PgBossWritesDisabledBanner info={info} />
      {isLoading ? (
        <OverviewKpisSkeleton />
      ) : (
        <PgBossOverviewKpis queues={queues ?? []} filter={filter} filterLink={filterLink} />
      )}

      <div className="flex flex-col gap-4">
        <StickyHeader actions={<PgBossStatsFreshness queues={queues ?? []} />} />
        {renderContent()}
      </div>

      <Suspense fallback={null}>
        {sendTo !== null && (
          <PgBossSendJobModalLazy open queueName={sendTo} onClose={() => setSendTo(null)} />
        )}
      </Suspense>
    </section>
  );
};
