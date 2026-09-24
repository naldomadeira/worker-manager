import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import React, { Suspense, useEffect } from 'react';
import { Route, Switch, useLocation } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppShell } from './components/AppShell/AppShell';
import { ConfirmModal } from './components/ConfirmModal/ConfirmModal';
import { Loader } from './components/Loader/Loader';
import { Toaster } from './components/Toaster/Toaster';
import { useConfirm } from './hooks/useConfirm';
import { useDarkMode } from './hooks/useDarkMode';
import { useLanguageWatch } from './hooks/useLanguageWatch';
import { useScrollTopOnNav } from './hooks/useScrollTopOnNav';

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

export const App = () => {
  useScrollTopOnNav();
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const { confirmProps } = useConfirm();
  useLanguageWatch();
  useDarkMode();

  useEffect(() => {
    requestAnimationFrame(() => document.body.classList.remove('preload'));
  }, []);

  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={100}>
      <AppShell>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: reduceMotion ? 0 : 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : -4 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            <Suspense fallback={<Loader />}>
              <Switch location={location}>
                <Route path="/queue/:name/:jobId" render={() => <JobPageLazy />} />
                <Route path="/queue/:name" render={() => <QueuePageLazy />} />
                <Route path="/metrics-history" exact render={() => <MetricsHistoryPageLazy />} />
                <Route path="/job-schedulers" exact render={() => <SchedulersPageLazy />} />

                <Route path="/" exact render={() => <OverviewPageLazy />} />
              </Switch>
            </Suspense>
          </motion.div>
        </AnimatePresence>
        <ConfirmModal {...confirmProps} />
      </AppShell>
      <Toaster />
    </TooltipProvider>
  );
};
