import type { PgBossJob, PgBossJobState } from '@worker-manager/api/typings/app';
import { Inbox, Plus, SearchIcon, XIcon } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import React, { type FormEvent, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useHistory, useLocation, useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { SchedulersIcon } from '../../../components/Icons/Schedulers';
import { Loader } from '../../../components/Loader/Loader';
import { LoadError } from '../../../components/LoadError/LoadError';
import { formatNumber } from '../../../components/MetricsSummary/formatNumber';
import { StatusTabs, type StatusTabItem } from '../../../components/StatusTabs/StatusTabs';
import { StickyHeader } from '../../../components/StickyHeader/StickyHeader';
import { useSettingsStore } from '../../../hooks/useSettings';
import { CursorPagination } from '../components/CursorPagination';
import { PgBossJobCard } from '../components/PgBossJobCard';
import { PgBossQueueActions } from '../components/PgBossQueueActions';
import { PgBossQueueBadges } from '../components/PgBossQueueBadges';
import { PgBossWritesDisabledBanner } from '../components/PgBossWritesDisabledBanner';
import { isErrorBody, PgBossLoadError } from '../hooks/query';
import { usePgBossActions } from '../hooks/usePgBossActions';
import { usePgBossApi } from '../hooks/usePgBossApi';
import { permissionsOf, usePgBossInfo } from '../hooks/usePgBossInfo';
import { usePgBossJobs } from '../hooks/usePgBossJobs';
import { usePgBossQueue, usePgBossStateCounts } from '../hooks/usePgBossQueue';
import { PGBOSS_JOBS_PAGE_MAX } from '../utils/constants';
import { isJobId } from '../utils/jobs';
import { pgBossLinks } from '../utils/links';
import { countLabel, parseState, PGBOSS_STATES, stateLabel, stateToneKey } from '../utils/states';

const PgBossSendJobModalLazy = React.lazy(() =>
  import('../components/PgBossSendJobModal').then(({ PgBossSendJobModal }) => ({
    default: PgBossSendJobModal,
  }))
);

type ListParams = {
  state?: PgBossJobState;
  cursor?: string;
  id?: string;
  singletonKey?: string;
};

function readParams(search: string): ListParams {
  const params = new URLSearchParams(search);
  return {
    state: parseState(params.get('state')),
    cursor: params.get('cursor') || undefined,
    id: params.get('id') || undefined,
    singletonKey: params.get('singletonKey') || undefined,
  };
}

function toSearch(params: ListParams): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value) search.set(name, value);
  }
  return search.toString();
}

/** A pg-boss queue: its six states as tabs with live counts, and one keyset page of jobs. */
export const PgBossQueuePage = () => {
  const { t, i18n } = useTranslation();
  const { name: rawName = '' } = useParams<{ name: string }>();
  const name = decodeURIComponent(rawName);
  const { pathname, search } = useLocation();
  const history = useHistory();
  const reduceMotion = useReducedMotion();
  const jobsPerPage = useSettingsStore((state) => state.jobsPerPage);
  const params = readParams(search);

  const { info } = usePgBossInfo();
  const permissions = permissionsOf(info);
  const { queue, loading: queueLoading, error: queueError, refetch } = usePgBossQueue(name);
  const { counts, cap } = usePgBossStateCounts(name);
  const {
    page,
    isTransitioning,
    error: jobsError,
  } = usePgBossJobs(name, {
    ...params,
    limit: Math.min(Math.max(jobsPerPage, 1), PGBOSS_JOBS_PAGE_MAX),
  });
  const actions = usePgBossActions();
  const api = usePgBossApi();
  const [sending, setSending] = useState(false);
  const [duplicate, setDuplicate] = useState<PgBossJob | null>(null);
  const [idFilter, setIdFilter] = useState(params.id ?? '');
  const [keyFilter, setKeyFilter] = useState(params.singletonKey ?? '');
  const [invalidId, setInvalidId] = useState(false);

  const navigate = (next: ListParams) => history.push({ pathname, search: toSearch(next) });

  if (!queue) {
    if (queueError) {
      const notFound =
        queueError instanceof PgBossLoadError &&
        queueError.body.error.key === 'ERRORS.QUEUE_NOT_FOUND';
      return notFound ? (
        <section className="py-10 text-center text-sm text-muted-foreground">
          {t('PGBOSS.QUEUE.NOT_FOUND')}
        </section>
      ) : (
        <LoadError error={queueError} onRetry={refetch} />
      );
    }
    return (
      <section className="py-10 text-center text-sm text-muted-foreground">
        {queueLoading ? <Loader /> : t('PGBOSS.QUEUE.NOT_FOUND')}
      </section>
    );
  }

  const tabSearch = (state?: PgBossJobState) =>
    toSearch({ state, id: params.id, singletonKey: params.singletonKey });
  const totalCount = counts
    ? PGBOSS_STATES.reduce((sum, state) => sum + (counts[state].count ?? 0), 0)
    : undefined;

  const tabs: StatusTabItem[] = [
    {
      status: 'latest',
      label: t('PGBOSS.STATE.ALL'),
      to: { pathname, search: tabSearch() },
      isActive: () => !params.state,
      count: totalCount,
      countLabel: totalCount === undefined ? undefined : formatNumber(totalCount, i18n.language),
      dot: false,
    },
    ...PGBOSS_STATES.map((state) => {
      const shown = countLabel(counts, state, cap, t, i18n.language);
      return {
        status: stateToneKey(state),
        label: stateLabel(state, t),
        to: { pathname, search: tabSearch(state) },
        isActive: () => params.state === state,
        count: shown.count,
        countLabel: shown.label,
        title: shown.title,
      } satisfies StatusTabItem;
    }),
  ];

  const applyFilters = (evt: FormEvent) => {
    evt.preventDefault();
    const id = idFilter.trim();
    if (id && !isJobId(id)) {
      setInvalidId(true);
      return;
    }
    setInvalidId(false);
    navigate({
      state: params.state,
      id: id || undefined,
      singletonKey: keyFilter.trim() || undefined,
    });
  };

  const clearFilters = () => {
    setIdFilter('');
    setKeyFilter('');
    setInvalidId(false);
    navigate({ state: params.state });
  };

  const hasFilters = !!params.id || !!params.singletonKey;
  const timedOut =
    jobsError instanceof PgBossLoadError &&
    jobsError.body.error.key === 'ERRORS.PGBOSS_QUERY_TIMEOUT';
  const jobs = page?.jobs ?? [];

  const toolbar = (
    <div
      data-slot="queue-toolbar"
      className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border bg-card/80 px-2 py-1.5 shadow-xs backdrop-blur-sm"
    >
      <form
        onSubmit={applyFilters}
        className="flex min-w-0 flex-wrap items-center gap-1.5"
        role="search"
      >
        <div className="relative">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label={t('PGBOSS.FILTER.ID')}
            aria-invalid={invalidId || undefined}
            title={t('PGBOSS.FILTER.ID_PLACEHOLDER')}
            placeholder={t('PGBOSS.FILTER.ID_PLACEHOLDER')}
            value={idFilter}
            onChange={(evt) => setIdFilter(evt.target.value)}
            className="h-8 w-56 pl-8 font-mono text-xs placeholder:font-sans"
          />
        </div>
        <Input
          aria-label={t('PGBOSS.FILTER.SINGLETON_KEY_PLACEHOLDER')}
          title={t('PGBOSS.FILTER.SINGLETON_KEY_PLACEHOLDER')}
          placeholder={t('PGBOSS.FILTER.SINGLETON_KEY')}
          value={keyFilter}
          onChange={(evt) => setKeyFilter(evt.target.value)}
          className="h-8 w-48 font-mono text-xs placeholder:font-sans"
        />
        <Button type="submit" size="sm" variant="outline">
          {t('PGBOSS.FILTER.APPLY')}
        </Button>
        {hasFilters && (
          <Button type="button" size="sm" variant="ghost" onClick={clearFilters}>
            <XIcon data-icon="inline-start" />
            {t('PGBOSS.FILTER.CLEAR')}
          </Button>
        )}
        {invalidId && (
          <span role="alert" className="px-1 text-xs text-destructive">
            {t('PGBOSS.FILTER.INVALID_ID')}
          </span>
        )}
      </form>
      <CursorPagination
        isFirstPage={!params.cursor}
        prevCursor={page?.prevCursor ?? null}
        nextCursor={page?.nextCursor ?? null}
        onNavigate={(cursor) => navigate({ ...params, cursor })}
      />
    </div>
  );

  return (
    <section className="flex flex-col">
      <PgBossWritesDisabledBanner info={info} className="mb-4" />
      <header className="flex flex-wrap items-start justify-between gap-3 pb-4 animate-fade-in-up">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="m-0 truncate text-xl font-semibold tracking-tight">{queue.name}</h1>
            <Badge variant="outline" className="font-mono text-[0.625rem] tracking-wide uppercase">
              pg-boss
            </Badge>
            <PgBossQueueBadges queue={queue} readOnly={permissions.readOnly} />
          </div>
        </div>
        {permissions.canWrite && (
          <div className="flex items-center gap-1.5">
            {permissions.can('send') && (
              <Button size="sm" onClick={() => setSending(true)}>
                <Plus data-icon="inline-start" />
                {t('PGBOSS.ACTIONS.SEND.LABEL')}
              </Button>
            )}
            <PgBossQueueActions
              queue={queue}
              permissions={permissions}
              onSendJob={() => setSending(true)}
            />
          </div>
        )}
      </header>

      <StickyHeader actions={toolbar}>
        <StatusTabs items={tabs}>
          {queue.scheduleCount > 0 && (
            <Link
              className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs whitespace-nowrap text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&_svg]:size-3.5 [&_svg]:shrink-0"
              to={pgBossLinks.schedules(queue.name)}
              aria-label={t('PGBOSS.SCHEDULES.TITLE')}
            >
              <SchedulersIcon />
              <span className="hidden md:inline">{t('PGBOSS.SCHEDULES.TITLE')}</span>
              <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem] leading-none tabular-nums">
                {formatNumber(queue.scheduleCount, i18n.language)}
              </span>
            </Link>
          )}
        </StatusTabs>
      </StickyHeader>

      {timedOut ? (
        <Empty role="alert" className="mt-4 border bg-card/50 py-12 animate-fade-in-up">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="text-status-delayed">
              <SearchIcon />
            </EmptyMedia>
            <EmptyTitle className="text-sm font-normal text-muted-foreground">
              {t('PGBOSS.BANNER.SLOW_QUERY')}
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : jobsError && !page ? (
        <LoadError error={jobsError} onRetry={refetch} />
      ) : jobs.length > 0 ? (
        <ul
          aria-busy={isTransitioning || undefined}
          className={cn(
            'relative m-0 flex list-none flex-col gap-3 p-0 transition-opacity duration-200',
            isTransitioning && 'pointer-events-none opacity-60'
          )}
        >
          <AnimatePresence initial mode="popLayout">
            {jobs.map((job, index) => (
              <motion.li
                key={job.id}
                layout={reduceMotion ? false : 'position'}
                initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: {
                    duration: 0.32,
                    ease: [0.16, 1, 0.3, 1],
                    delay: reduceMotion ? 0 : Math.min(index, 12) * 0.035,
                  },
                }}
                exit={
                  reduceMotion
                    ? { opacity: 0, transition: { duration: 0 } }
                    : { opacity: 0, scale: 0.98, transition: { duration: 0.16 } }
                }
              >
                <PgBossJobCard
                  job={job}
                  jobUrl={pgBossLinks.jobPage(queue.name, job.id, params.state)}
                  permissions={permissions}
                  actions={{
                    command: (command) => actions.jobCommand(command, queue.name, job),
                    // The list only carries summaries; a copy needs the job's data.
                    duplicate: async () => {
                      const response = await api.getJob(queue.name, job.id);
                      if (!isErrorBody(response)) setDuplicate(response.job);
                    },
                  }}
                />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      ) : page ? (
        <Empty className="mt-4 border bg-card/50 py-12 animate-fade-in-up">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Inbox />
            </EmptyMedia>
            <EmptyTitle className="text-sm font-normal text-muted-foreground">
              {hasFilters ? t('PGBOSS.EMPTY.JOBS_FILTERED') : t('PGBOSS.EMPTY.JOBS')}
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <Loader />
      )}

      <Suspense fallback={null}>
        {sending && (
          <PgBossSendJobModalLazy open queueName={queue.name} onClose={() => setSending(false)} />
        )}
        {!!duplicate && (
          <PgBossSendJobModalLazy
            open
            queueName={queue.name}
            job={duplicate}
            onClose={() => setDuplicate(null)}
          />
        )}
      </Suspense>
    </section>
  );
};
