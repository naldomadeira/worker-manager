import { useQuery } from '@tanstack/react-query';
import type { FlowNode } from '@worker-manager/api/typings/app';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { queryKeys } from '../../hooks/queryKeys';
import { useApi } from '../../hooks/useApi';
import { useSelectedStatuses } from '../../hooks/useSelectedStatuses';
import { useSettingsStore } from '../../hooks/useSettings';
import { links } from '../../utils/links';
import { CollapsibleJSON } from '../CollapsibleJSON/CollapsibleJSON';
import { stateBadgeClassName } from './FlowJobNode';
import { stateStyle } from './flowStates';

export interface FlowDetailsPanelProps {
  node: FlowNode;
}

export const FlowDetailsPanel = ({ node }: FlowDetailsPanelProps) => {
  const { t } = useTranslation();
  const api = useApi();
  const selectedStatuses = useSelectedStatuses();
  const defaultCollapseDepth = useSettingsStore((state) => state.defaultCollapseDepth);

  const { data, isPending } = useQuery({
    queryKey: queryKeys.job(node.queueName, node.id),
    queryFn: () => api.getJob(node.queueName, node.id),
  });

  const deps = node.dependencies;
  const job = data?.job;

  const sectionTitle =
    'm-0 text-[0.6875rem] font-semibold tracking-wider text-muted-foreground uppercase';

  return (
    <aside
      style={stateStyle(node.state)}
      className="flex min-h-0 min-w-0 flex-1 animate-in flex-col gap-3.5 overflow-hidden rounded-xl border bg-card p-3.5 duration-200 fade-in-0 slide-in-from-right-2"
    >
      <header className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <h5 className="m-0 truncate text-sm font-semibold">{node.name ?? node.id}</h5>
          <span className={stateBadgeClassName}>{node.state}</span>
        </div>
        <span className="truncate text-xs text-muted-foreground">{node.queueName}</span>
      </header>

      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">{t('JOB.FLOW.PANEL_ID')}</dt>
        <dd className="m-0 font-mono text-[0.6875rem] wrap-anywhere">{node.id}</dd>
        {!!deps && (
          <>
            <dt className="text-muted-foreground">{t('JOB.FLOW.PANEL_CHILDREN')}</dt>
            <dd className="m-0 flex flex-wrap gap-2">
              {deps.processed > 0 && (
                <span>{t('JOB.FLOW.PROCESSED', { count: deps.processed })}</span>
              )}
              {deps.unprocessed > 0 && (
                <span>{t('JOB.FLOW.UNPROCESSED', { count: deps.unprocessed })}</span>
              )}
              {deps.failed > 0 && (
                <span className="font-semibold text-status-failed">
                  {t('JOB.FLOW.FAILED', { count: deps.failed })}
                </span>
              )}
              {deps.ignored > 0 && (
                <span className="font-semibold text-status-waiting">
                  {t('JOB.FLOW.IGNORED', { count: deps.ignored })}
                </span>
              )}
            </dd>
          </>
        )}
        {!!job?.attempts && (
          <>
            <dt className="text-muted-foreground">{t('JOB.FLOW.PANEL_ATTEMPTS')}</dt>
            <dd className="m-0 tabular-nums">{job.attempts}</dd>
          </>
        )}
      </dl>

      {!!job?.failedReason && (
        <section className="flex flex-col gap-1.5">
          <h6 className={sectionTitle}>{t('JOB.FLOW.PANEL_ERROR')}</h6>
          <p className="m-0 max-h-32 overflow-auto rounded-md border border-destructive/40 bg-destructive/8 p-2 font-mono text-xs whitespace-pre-wrap wrap-anywhere text-foreground">
            {job.failedReason}
          </p>
        </section>
      )}

      <section className="flex min-h-0 flex-1 flex-col gap-1.5">
        <h6 className={sectionTitle}>{t('JOB.FLOW.PANEL_DATA')}</h6>
        <div className="min-h-16 min-w-0 flex-1 overflow-auto rounded-md border bg-muted/50 p-2 text-xs [scrollbar-width:thin]">
          {isPending && (
            <p className="m-0 text-[0.8125rem] text-muted-foreground">
              {t('JOB.FLOW.PANEL_DATA_LOADING')}
            </p>
          )}
          {!isPending && !job && (
            <p className="m-0 text-[0.8125rem] text-muted-foreground">
              {t('JOB.FLOW.PANEL_DATA_MISSING')}
            </p>
          )}
          {!!job && <CollapsibleJSON data={job.data} defaultCollapseDepth={defaultCollapseDepth} />}
        </div>
      </section>

      <Link
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'self-start')}
        to={links.jobPage(node.queueName, node.id, selectedStatuses)}
      >
        {t('JOB.FLOW.OPEN_JOB')}
      </Link>
    </aside>
  );
};
