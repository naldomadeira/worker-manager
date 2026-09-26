import { Info } from 'lucide-react';
import React, { Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { useActiveJobId } from '../../hooks/useActiveJobId';
import { useActiveQueue } from '../../hooks/useActiveQueue';
import { useActiveQueueName } from '../../hooks/useActiveQueueName';
import { type NavQueue, useBoardNavigation } from '../../hooks/useBoardNavigation';
import { useMobileQuery } from '../../hooks/useMobileQuery';
import { useSelectedStatuses } from '../../hooks/useSelectedStatuses';
import { links } from '../../utils/links';

const QueueInfoModalLazy = React.lazy(() =>
  import('../QueueInfoModal/QueueInfoModal').then(({ QueueInfoModal }) => ({
    default: QueueInfoModal,
  }))
);

type Crumb = {
  label: string;
  title?: string;
  to?: string | { pathname: string; search: string };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The job crumb as the job card shows it: `#` for numeric ids, a UUID's first block. */
function jobCrumb(jobId: string): Crumb {
  if (/^\d+$/.test(jobId)) return { label: `#${jobId}` };
  if (UUID.test(jobId)) return { label: jobId.split('-')[0] ?? jobId, title: jobId };
  return { label: jobId };
}

/** Where the page sits in the board: Overview › queue › job, or Overview › section page. */
export const Title = () => {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigation = useBoardNavigation();
  const bullQueue = useActiveQueue();
  const activeQueueName = useActiveQueueName();
  const EngineQueueInfoModal = navigation.QueueInfoModal;
  // An engine with its own panel describes its queues through the navigation; BullMQ's panel
  // needs the full queue, so the BullMQ board keeps reading it as before.
  const queue: NavQueue | null = EngineQueueInfoModal
    ? (navigation.queues?.find((candidate) => candidate.name === activeQueueName) ?? null)
    : bullQueue;
  const jobId = useActiveJobId();
  const selectedStatuses = useSelectedStatuses();
  const isMobile = useMobileQuery();
  const [infoOpen, setInfoOpen] = useState(false);

  if (isMobile) return <div className="min-w-0 flex-1" />;

  const crumbs: Crumb[] = [{ label: t('MENU.OVERVIEW'), to: '/' }];
  if (pathname.startsWith(links.jobSchedulers().pathname)) {
    crumbs.push({ label: t('MENU.SCHEDULERS') });
  } else if (pathname.startsWith(links.metricsHistory().pathname)) {
    crumbs.push({ label: t('MENU.METRICS_HISTORY') });
  } else if (queue) {
    crumbs.push({
      label: queue.displayName || queue.name,
      to: jobId ? links.queuePage(queue.name, selectedStatuses) : undefined,
    });
    if (jobId) crumbs.push(jobCrumb(jobId));
  }
  const last = crumbs.length - 1;

  const breadcrumb = (
    <Breadcrumb aria-label={t('HEADER.BREADCRUMB')} className="min-w-0">
      <BreadcrumbList className="flex-nowrap gap-1 text-[0.8125rem]">
        {crumbs.map((crumb, index) => (
          <React.Fragment key={index}>
            {index > 0 && <BreadcrumbSeparator className="text-muted-foreground/60" />}
            <BreadcrumbItem className={index === last ? 'min-w-0' : 'shrink-0'}>
              {index === last ? (
                <BreadcrumbPage
                  className="animate-in truncate font-medium duration-300 fade-in-0 slide-in-from-left-1"
                  title={crumb.title ?? crumb.label}
                >
                  {crumb.label}
                </BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <Link to={crumb.to ?? '/'}>{crumb.label}</Link>
                </BreadcrumbLink>
              )}
              {index === last && !jobId && !!queue && crumbs.length === 2 && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setInfoOpen(true)}
                  title={t('QUEUE.INFO.TITLE')}
                  aria-label={t('QUEUE.INFO.TITLE')}
                >
                  <Info aria-hidden="true" />
                </Button>
              )}
            </BreadcrumbItem>
          </React.Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center">
      {navigation.headerBadge ? (
        <div className="flex min-w-0 items-center gap-2">
          {breadcrumb}
          {navigation.headerBadge}
        </div>
      ) : (
        breadcrumb
      )}
      {!!queue?.description && !jobId && (
        <p className="truncate text-xs text-muted-foreground" title={queue.description}>
          {queue.description}
        </p>
      )}
      <Suspense fallback={null}>
        {infoOpen &&
          !!queue &&
          (EngineQueueInfoModal ? (
            <EngineQueueInfoModal
              open={infoOpen}
              queueName={queue.name}
              onClose={() => setInfoOpen(false)}
            />
          ) : (
            !!bullQueue && (
              <QueueInfoModalLazy
                open={infoOpen}
                queue={bullQueue}
                onClose={() => setInfoOpen(false)}
              />
            )
          ))}
      </Suspense>
    </div>
  );
};
