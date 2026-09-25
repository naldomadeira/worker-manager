import type { PgBossQueueSummary } from '@worker-manager/api/typings/app';
import React, { Suspense, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { BoardNavigation, NavQueue } from '../../hooks/useBoardNavigation';
import { ExperimentalBadge } from './components/ExperimentalBadge';
import { permissionsOf, usePgBossInfo } from './hooks/usePgBossInfo';
import { usePgBossQueues } from './hooks/usePgBossQueues';

const PgBossQueueInfoModalLazy = React.lazy(() =>
  import('./components/PgBossQueueInfoModal').then(({ PgBossQueueInfoModal }) => ({
    default: PgBossQueueInfoModal,
  }))
);

const PgBossDatastoreModalLazy = React.lazy(() =>
  import('./components/PgBossDatastoreModal').then(({ PgBossDatastoreModal }) => ({
    default: PgBossDatastoreModal,
  }))
);

const QueueInfoModal = (props: { queueName: string; open: boolean; onClose(): void }) => (
  <Suspense fallback={null}>
    <PgBossQueueInfoModalLazy {...props} />
  </Suspense>
);

const DatastoreModal = (props: { open: boolean; onClose(): void }) => (
  <Suspense fallback={null}>
    <PgBossDatastoreModalLazy {...props} />
  </Suspense>
);

/**
 * A pg-boss queue as the shell draws it. The counters are pg-boss's cached ones, the same the
 * overview shows. A pg-boss queue cannot be paused, so it never reads as paused.
 */
export function toNavQueue(queue: PgBossQueueSummary, delimiter: string): NavQueue {
  return {
    name: queue.name,
    delimiter: delimiter || undefined,
    isPaused: false,
    counts: { active: queue.counts.active, failed: queue.counts.failed },
    total: queue.counts.total,
  };
}

/** The shell navigation of a pg-boss board. */
export function usePgBossNavigation(): BoardNavigation {
  const { t } = useTranslation();
  const { queues } = usePgBossQueues();
  const { info } = usePgBossInfo();
  const delimiter = info?.delimiter ?? '';
  // A board that may write schedules offers the page even before the first one exists, since
  // that page is where one is created.
  const canWriteSchedules = permissionsOf(info).can('scheduleWrite');
  const datastoreTitle = t('PGBOSS.DATASTORE.TITLE');

  return useMemo(
    () => ({
      queues: queues?.map((queue) => toNavQueue(queue, delimiter)) ?? null,
      showSchedules: canWriteSchedules || !!queues?.some((queue) => queue.scheduleCount > 0),
      QueueInfoModal,
      DatastoreModal,
      datastoreTitle,
      headerBadge: <ExperimentalBadge />,
    }),
    [queues, delimiter, canWriteSchedules, datastoreTitle]
  );
}
