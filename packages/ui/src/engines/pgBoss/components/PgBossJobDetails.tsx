import type { PgBossJob } from '@worker-manager/api/typings/app';
import { type PropsWithChildren, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { CollapsibleJSON } from '../../../components/CollapsibleJSON/CollapsibleJSON';
import { Highlight } from '../../../components/Highlight/Highlight';
import { Loader } from '../../../components/Loader/Loader';
import { formatNumber } from '../../../components/MetricsSummary/formatNumber';
import { useSettingsStore } from '../../../hooks/useSettings';
import { useUIConfig } from '../../../hooks/useUIConfig';
import { usePgBossDependencies } from '../hooks/usePgBossJob';
import { formatIso, formatSeconds } from '../utils/format';
import { pgBossLinks } from '../utils/links';
import { describePolicy } from '../utils/policy';
import { PgBossJobTimeline } from './PgBossJobTimeline';

export type PgBossJobTab =
  | 'Data'
  | 'Output'
  | 'Options'
  | 'Timeline'
  | 'Dependencies'
  | 'DeadLetter';

const TAB_KEYS = {
  Data: 'PGBOSS.JOB.TABS.DATA',
  Output: 'PGBOSS.JOB.TABS.OUTPUT',
  Options: 'PGBOSS.JOB.TABS.OPTIONS',
  Timeline: 'PGBOSS.JOB.TABS.TIMELINE',
  Dependencies: 'PGBOSS.JOB.TABS.DEPENDENCIES',
  DeadLetter: 'PGBOSS.JOB.TABS.DEAD_LETTER',
} as const satisfies Record<PgBossJobTab, string>;

/** The tabs a job has, the failure first on a failed job as the BullMQ card puts its error. */
export function tabsFor(job: PgBossJob, withTimeline: boolean): PgBossJobTab[] {
  const tabs: PgBossJobTab[] =
    job.state === 'failed'
      ? ['Output', 'Data', 'Options', 'Dependencies']
      : ['Data', 'Output', 'Options', 'Dependencies'];
  if (job.deadLetterSource) tabs.push('DeadLetter');
  if (withTimeline) tabs.push('Timeline');
  return tabs;
}

const Notice = ({ children }: PropsWithChildren) => (
  <div className="p-3 whitespace-pre-wrap text-muted-foreground">{children}</div>
);

const rowsClass = 'm-0 flex flex-col divide-y';

const Row = ({ label, children }: PropsWithChildren<{ label: string }>) => (
  <div className="grid grid-cols-1 gap-0.5 px-3 py-2 sm:grid-cols-[minmax(9rem,0.7fr)_1.3fr] sm:gap-4">
    <dt className="m-0 text-xs text-muted-foreground">{label}</dt>
    <dd className="m-0 min-w-0 font-mono text-xs [overflow-wrap:anywhere] text-foreground">
      {children}
    </dd>
  </div>
);

/** A thrown error that pg-boss stored as the output of a failed job. */
function errorStack(output: unknown): string | null {
  if (!output || typeof output !== 'object') return null;
  const { stack, message } = output as { stack?: unknown; message?: unknown };
  if (typeof stack === 'string' && stack) return stack;
  return typeof message === 'string' && message ? message : null;
}

const JsonBlock = ({ value }: { value: unknown }) => {
  const { useCollapsibleJson, defaultCollapseDepth } = useSettingsStore();
  return useCollapsibleJson ? (
    <CollapsibleJSON data={value} defaultCollapseDepth={defaultCollapseDepth} />
  ) : (
    <Highlight language="json" text={JSON.stringify(value, null, 2)} />
  );
};

const DependencyList = ({
  title,
  empty,
  refs,
}: {
  title: string;
  empty: string;
  refs: { queueName: string; id: string }[];
}) => (
  <section className="flex flex-col gap-1.5 p-3">
    <h6 className="m-0 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
      {title}
    </h6>
    {refs.length === 0 ? (
      <p className="m-0 text-xs text-muted-foreground">{empty}</p>
    ) : (
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {refs.map((ref) => (
          <li key={`${ref.queueName}/${ref.id}`} className="min-w-0 truncate font-mono text-xs">
            <Link
              to={pgBossLinks.jobPage(ref.queueName, ref.id)}
              className="underline-offset-4 hover:text-primary hover:underline"
            >
              <span className="text-muted-foreground">{ref.queueName}</span> / {ref.id}
            </Link>
          </li>
        ))}
      </ul>
    )}
  </section>
);

const Dependencies = ({ job }: { job: PgBossJob }) => {
  const { t, i18n } = useTranslation();
  const { dependencies, loading } = usePgBossDependencies(job.queueName, job.id, true);

  if (loading) return <Loader className="py-6" />;

  return (
    <div className="flex flex-col divide-y">
      {job.pendingDependencies > 0 && (
        <p className="m-0 px-3 py-2 text-xs text-status-waiting-children">
          {t('PGBOSS.JOB.PENDING_DEPENDENCIES', {
            value: formatNumber(job.pendingDependencies, i18n.language),
          })}
        </p>
      )}
      <DependencyList
        title={t('PGBOSS.JOB.DEPENDENCIES')}
        empty={t('PGBOSS.JOB.NO_DEPENDENCIES')}
        refs={dependencies?.dependencies ?? []}
      />
      <DependencyList
        title={t('PGBOSS.JOB.DEPENDENTS')}
        empty={t('PGBOSS.JOB.NO_DEPENDENTS')}
        refs={dependencies?.dependents ?? []}
      />
    </div>
  );
};

const TabContent = ({ tab, job }: { tab: PgBossJobTab; job: PgBossJob }) => {
  const { t, i18n } = useTranslation();
  const dateFormats = useUIConfig()?.dateFormats;
  const locale = i18n.language;
  const date = (value: string | null | undefined) => formatIso(value, locale, dateFormats);
  const optional = (value: ReactNode | null | undefined) =>
    value === null || value === undefined || value === '' ? '-' : value;

  switch (tab) {
    case 'Data':
      return job.data === null || job.data === undefined ? (
        <Notice>{t('PGBOSS.JOB.NO_DATA')}</Notice>
      ) : (
        <JsonBlock value={job.data} />
      );
    case 'Output': {
      if (job.output === null || job.output === undefined) {
        return <Notice>{t('PGBOSS.JOB.NO_OUTPUT')}</Notice>;
      }
      const stack = job.state === 'failed' ? errorStack(job.output) : null;
      return stack ? (
        <Highlight language="stacktrace" text={stack} />
      ) : (
        <JsonBlock value={job.output} />
      );
    }
    case 'Options':
      return (
        <dl className={rowsClass}>
          <Row label={t('PGBOSS.QUEUE.POLICY')}>{describePolicy(job.policy, t).label}</Row>
          <Row label={t('PGBOSS.SEND.PRIORITY')}>{formatNumber(job.priority, locale)}</Row>
          <Row label={t('PGBOSS.QUEUE.RETRY_LIMIT')}>{formatNumber(job.retryLimit, locale)}</Row>
          <Row label={t('PGBOSS.QUEUE.RETRY_DELAY')}>{formatSeconds(job.retryDelay, locale)}</Row>
          <Row label={t('PGBOSS.QUEUE.RETRY_BACKOFF')}>
            {job.retryBackoff ? t('PGBOSS.QUEUE.YES') : t('PGBOSS.QUEUE.NO')}
          </Row>
          <Row label={t('PGBOSS.QUEUE.RETRY_DELAY_MAX')}>
            {optional(job.retryDelayMax === null ? null : formatSeconds(job.retryDelayMax, locale))}
          </Row>
          <Row label={t('PGBOSS.QUEUE.EXPIRE_IN')}>
            {formatSeconds(job.expireInSeconds, locale)}
          </Row>
          <Row label={t('PGBOSS.QUEUE.DELETE_AFTER')}>
            {formatSeconds(job.deleteAfterSeconds, locale)}
          </Row>
          <Row label={t('PGBOSS.JOB.KEEP_UNTIL')}>{date(job.keepUntil)}</Row>
          <Row label={t('PGBOSS.JOB.SINGLETON_KEY')}>{optional(job.singletonKey)}</Row>
          <Row label={t('PGBOSS.JOB.SINGLETON_ON')}>
            {job.singletonOn ? date(job.singletonOn) : '-'}
          </Row>
          <Row label={t('PGBOSS.JOB.GROUP_ID')}>{optional(job.groupId)}</Row>
          <Row label={t('PGBOSS.JOB.GROUP_TIER')}>{optional(job.groupTier)}</Row>
          <Row label={t('PGBOSS.QUEUE.HEARTBEAT')}>
            {optional(
              job.heartbeatSeconds === null ? null : formatSeconds(job.heartbeatSeconds, locale)
            )}
          </Row>
          <Row label={t('PGBOSS.JOB.HEARTBEAT_ON')}>
            {job.heartbeatOn ? date(job.heartbeatOn) : '-'}
          </Row>
          <Row label={t('PGBOSS.QUEUE.DEAD_LETTER')}>
            {job.deadLetter ? (
              <Link
                to={pgBossLinks.queuePage(job.deadLetter)}
                className="underline-offset-4 hover:text-primary hover:underline"
              >
                {job.deadLetter}
              </Link>
            ) : (
              '-'
            )}
          </Row>
          <Row label={t('PGBOSS.JOB.BLOCKING')}>
            {job.blocking ? t('PGBOSS.QUEUE.YES') : t('PGBOSS.QUEUE.NO')}
          </Row>
        </dl>
      );
    case 'Dependencies':
      return <Dependencies job={job} />;
    case 'DeadLetter': {
      const source = job.deadLetterSource;
      if (!source) return <Notice>{t('PGBOSS.JOB.NOT_DEAD_LETTER')}</Notice>;
      return (
        <dl className={rowsClass}>
          <Row label={t('PGBOSS.JOB.SOURCE_QUEUE')}>
            <Link
              to={pgBossLinks.queuePage(source.queueName)}
              className="underline-offset-4 hover:text-primary hover:underline"
            >
              {source.queueName}
            </Link>
          </Row>
          <Row label={t('PGBOSS.JOB.SOURCE_JOB')}>
            <Link
              to={pgBossLinks.jobPage(source.queueName, source.id)}
              className="underline-offset-4 hover:text-primary hover:underline"
            >
              {source.id}
            </Link>
          </Row>
          <Row label={t('PGBOSS.JOB.SOURCE_CREATED_ON')}>{date(source.createdOn)}</Row>
          <Row label={t('PGBOSS.JOB.SOURCE_RETRY_COUNT')}>
            {source.retryCount === null ? '-' : formatNumber(source.retryCount, locale)}
          </Row>
        </dl>
      );
    }
    case 'Timeline':
      return <PgBossJobTimeline job={job} className="max-w-md p-4" />;
    default:
      return null;
  }
};

/** A job's details in tabs, styled like the BullMQ job card's tabs. */
export const PgBossJobDetails = ({
  job,
  withTimeline = false,
}: {
  job: PgBossJob;
  withTimeline?: boolean;
}) => {
  const { t } = useTranslation();
  const tabs = tabsFor(job, withTimeline);
  const [selected, setSelected] = useState<PgBossJobTab>(tabs[0]);
  const value = tabs.includes(selected) ? selected : tabs[0];

  return (
    <Tabs
      className="min-h-0 min-w-0 gap-3"
      value={value}
      onValueChange={(next) => setSelected(next as PgBossJobTab)}
    >
      <div className="-mx-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <TabsList className="h-8">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab}
              value={tab}
              className={cn(
                'px-2.5 text-xs',
                tab === 'Output' && job.state === 'failed' && 'data-active:text-status-failed'
              )}
            >
              {t(TAB_KEYS[tab])}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {tabs.map((tab) => (
        <TabsContent
          key={tab}
          value={tab}
          className={cn(
            'relative max-h-80 min-h-0 overflow-auto rounded-lg border bg-muted/40 text-[0.8125rem] animate-in fade-in-0 duration-200',
            '[scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]',
            '[&_pre]:m-0 [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs [&_pre]:leading-relaxed'
          )}
        >
          {value === tab && <TabContent tab={tab} job={job} />}
        </TabsContent>
      ))}
    </Tabs>
  );
};
