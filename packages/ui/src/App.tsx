import React, { Suspense, useEffect } from 'react';
import { Route, Switch } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { BoardFrame } from './components/AppShell/BoardFrame';
import { Loader } from './components/Loader/Loader';
import { Toaster } from './components/Toaster/Toaster';
import { useDarkMode } from './hooks/useDarkMode';
import { useLanguageWatch } from './hooks/useLanguageWatch';
import { useScrollTopOnNav } from './hooks/useScrollTopOnNav';
import { useUIConfig } from './hooks/useUIConfig';

const JobPageLazy = React.lazy(() =>
  import('./pages/JobPage/JobPage').then(({ JobPage }) => ({ default: JobPage }))
);

const QueuePageLazy = React.lazy(() =>
  import('./pages/QueuePage/QueuePage').then(({ QueuePage }) => ({ default: QueuePage }))
);

const OverviewPageLazy = React.lazy(() =>
  import('./pages/OverviewPage/OverviewPage').then(({ OverviewPage }) => ({
    default: OverviewPage,
  }))
);

const MetricsHistoryPageLazy = React.lazy(() =>
  import('./pages/MetricsHistoryPage/MetricsHistoryPage').then(({ MetricsHistoryPage }) => ({
    default: MetricsHistoryPage,
  }))
);

const SchedulersPageLazy = React.lazy(() =>
  import('./pages/SchedulersPage/SchedulersPage').then(({ SchedulersPage }) => ({
    default: SchedulersPage,
  }))
);

/** The whole pg-boss board, shell navigation included, so a BullMQ board never loads its code. */
const PgBossBoardLazy = React.lazy(() =>
  import('./engines/pgBoss/PgBossBoard').then(({ PgBossBoard }) => ({ default: PgBossBoard }))
);

const BullMQBoard = () => (
  <BoardFrame
    renderRoutes={(location) => (
      <Switch location={location}>
        <Route path="/queue/:name/:jobId" render={() => <JobPageLazy />} />
        <Route path="/queue/:name" render={() => <QueuePageLazy />} />
        <Route path="/metrics-history" exact render={() => <MetricsHistoryPageLazy />} />
        <Route path="/job-schedulers" exact render={() => <SchedulersPageLazy />} />

        <Route path="/" exact render={() => <OverviewPageLazy />} />
      </Switch>
    )}
  />
);

export const App = () => {
  useScrollTopOnNav();
  useLanguageWatch();
  useDarkMode();
  // Written by the server from the engine the board was mounted with; older servers send none.
  const engine = useUIConfig()?.engine ?? 'bullmq';

  useEffect(() => {
    requestAnimationFrame(() => document.body.classList.remove('preload'));
  }, []);

  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={100}>
      {engine === 'pg-boss' ? (
        <Suspense fallback={<Loader />}>
          <PgBossBoardLazy />
        </Suspense>
      ) : (
        <BullMQBoard />
      )}
      <Toaster />
    </TooltipProvider>
  );
};
