import React from 'react';
import { Route, Switch, useLocation } from 'react-router-dom';
import { Loader } from '../../components/Loader/Loader';
import { PgBossUnavailable } from './components/PgBossUnavailable';
import { usePgBossInfo } from './hooks/usePgBossInfo';

const PgBossOverviewPageLazy = React.lazy(() =>
  import('./pages/PgBossOverviewPage').then(({ PgBossOverviewPage }) => ({
    default: PgBossOverviewPage,
  }))
);

const PgBossQueuePageLazy = React.lazy(() =>
  import('./pages/PgBossQueuePage').then(({ PgBossQueuePage }) => ({
    default: PgBossQueuePage,
  }))
);

const PgBossJobPageLazy = React.lazy(() =>
  import('./pages/PgBossJobPage').then(({ PgBossJobPage }) => ({ default: PgBossJobPage }))
);

const PgBossSchedulesPageLazy = React.lazy(() =>
  import('./pages/PgBossSchedulesPage').then(({ PgBossSchedulesPage }) => ({
    default: PgBossSchedulesPage,
  }))
);

// Engine-neutral: reads `/api/metrics/*`, which a pg-boss board mounts with a history provider.
const MetricsHistoryPageLazy = React.lazy(() =>
  import('../../pages/MetricsHistoryPage/MetricsHistoryPage').then(({ MetricsHistoryPage }) => ({
    default: MetricsHistoryPage,
  }))
);

interface PgBossRoutesProps {
  location?: ReturnType<typeof useLocation>;
}

/**
 * The pg-boss page table, on the same paths as the BullMQ one so links and deep links work the
 * same on both. A database the board cannot read answers every page with the reason.
 */
export const PgBossRoutes = ({ location }: PgBossRoutesProps) => {
  const { info, loading } = usePgBossInfo();

  if (loading && !info) {
    return <Loader />;
  }

  if (info && !info.readable) {
    return <PgBossUnavailable info={info} />;
  }

  return (
    <Switch location={location}>
      <Route path="/queue/:name/:jobId" render={() => <PgBossJobPageLazy />} />
      <Route path="/queue/:name" render={() => <PgBossQueuePageLazy />} />
      <Route path="/metrics-history" exact render={() => <MetricsHistoryPageLazy />} />
      <Route path="/job-schedulers" exact render={() => <PgBossSchedulesPageLazy />} />
      <Route path="/" exact render={() => <PgBossOverviewPageLazy />} />
    </Switch>
  );
};
