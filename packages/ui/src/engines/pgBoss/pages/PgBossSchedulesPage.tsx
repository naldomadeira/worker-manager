import type { PgBossSchedule } from '@worker-manager/api/typings/app';
import { CalendarClock, PencilIcon, PlayIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import React, { Suspense, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useHistory, useLocation } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Loader } from '../../../components/Loader/Loader';
import { LoadError } from '../../../components/LoadError/LoadError';
import { formatNumber } from '../../../components/MetricsSummary/formatNumber';
import { useUIConfig } from '../../../hooks/useUIConfig';
import { formatDate, formatRelativeToNow } from '../../../utils/formatDate';
import { PgBossWritesDisabledBanner } from '../components/PgBossWritesDisabledBanner';
import { usePgBossActions } from '../hooks/usePgBossActions';
import { permissionsOf, usePgBossInfo } from '../hooks/usePgBossInfo';
import { usePgBossQueues } from '../hooks/usePgBossQueues';
import { usePgBossSchedules } from '../hooks/usePgBossSchedules';
import { shortId } from '../utils/jobs';
import { pgBossLinks } from '../utils/links';

const PgBossScheduleEditModalLazy = React.lazy(() =>
  import('../components/PgBossScheduleEditModal').then(({ PgBossScheduleEditModal }) => ({
    default: PgBossScheduleEditModal,
  }))
);

const HEAD_CLASS = 'h-9 text-[0.68rem] font-semibold tracking-wide text-muted-foreground uppercase';
const ALL_QUEUES = '__all__';
const Muted = () => <span className="text-muted-foreground">-</span>;

const rowKey = (schedule: PgBossSchedule) => `${schedule.queueName}\u0000${schedule.key}`;

type Editing = { schedule: PgBossSchedule | null } | null;

/**
 * Every pg-boss schedule of the board in one table: the expression, the next runs the server
 * worked out, and the last job it sent, with edit, run-now and remove where the board may write.
 */
export const PgBossSchedulesPage = () => {
  const { t, i18n } = useTranslation();
  const history = useHistory();
  const { search, pathname } = useLocation();
  const dateFormats = useUIConfig()?.dateFormats;
  const queueFilter = new URLSearchParams(search).get('queueName') || undefined;
  const { schedules, loading, error, refetch } = usePgBossSchedules(queueFilter);
  const { queues } = usePgBossQueues();
  const { info } = usePgBossInfo();
  const permissions = permissionsOf(info);
  const actions = usePgBossActions();
  const [editing, setEditing] = useState<Editing>(null);
  const canWrite = permissions.can('scheduleWrite');
  const canRun = permissions.can('send');

  const setQueueFilter = (value: string) =>
    history.push({
      pathname,
      search: value === ALL_QUEUES ? '' : new URLSearchParams({ queueName: value }).toString(),
    });

  const renderTime = (iso: string | undefined) => {
    if (!iso) return <Muted />;
    const ts = Date.parse(iso);
    return (
      <div className="flex flex-col gap-0.5">
        <time dateTime={iso} className="font-medium">
          {formatRelativeToNow(ts, i18n.language)}
        </time>
        <small className="text-[0.7rem] text-muted-foreground tabular-nums">
          {formatDate(ts, i18n.language, dateFormats)}
        </small>
      </div>
    );
  };

  const iconAction = (label: string, icon: ReactNode, onClick: () => void, className?: string) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClick}
          aria-label={label}
          className={cn('text-muted-foreground hover:text-foreground', className)}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );

  const list = schedules ?? [];

  const renderBody = () => {
    if (!schedules && error) {
      return <LoadError error={error} onRetry={refetch} />;
    }
    if (loading && !schedules) {
      return (
        <div className="p-6">
          <Loader />
        </div>
      );
    }
    if (list.length === 0) {
      return (
        <Empty className="py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarClock />
            </EmptyMedia>
            <EmptyDescription>{t('PGBOSS.SCHEDULES.EMPTY')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      );
    }

    return (
      <TooltipProvider>
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableHead className={cn(HEAD_CLASS, 'pl-4')}>
                {t('PGBOSS.SCHEDULES.COLUMNS.QUEUE')}
              </TableHead>
              <TableHead className={HEAD_CLASS}>{t('PGBOSS.SCHEDULES.COLUMNS.KEY')}</TableHead>
              <TableHead className={HEAD_CLASS}>{t('PGBOSS.SCHEDULES.COLUMNS.SCHEDULE')}</TableHead>
              <TableHead className={HEAD_CLASS}>{t('PGBOSS.SCHEDULES.COLUMNS.NEXT_RUN')}</TableHead>
              <TableHead className={HEAD_CLASS}>{t('PGBOSS.SCHEDULES.COLUMNS.LAST_JOB')}</TableHead>
              <TableHead className={HEAD_CLASS}>{t('PGBOSS.SCHEDULES.COLUMNS.UPDATED')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((schedule, index) => {
              const [nextRun, ...laterRuns] = schedule.nextRuns;
              return (
                <TableRow
                  key={rowKey(schedule)}
                  className="group/row animate-fade-in-up align-top hover:bg-state-hover"
                  style={{ animationDelay: `${Math.min(index * 35, 420)}ms` }}
                >
                  <TableCell className="pl-4 font-medium">
                    <Link
                      to={pgBossLinks.queuePage(schedule.queueName)}
                      className="underline-offset-4 hover:text-primary hover:underline"
                    >
                      {schedule.queueName}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {schedule.key || (
                      <span className="font-sans text-muted-foreground italic">
                        {t('PGBOSS.SCHEDULES.DEFAULT_KEY')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span className="flex items-center gap-1.5">
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                          {schedule.expression}
                        </code>
                        <Badge variant="outline" className="h-4 px-1.5 text-[0.625rem]">
                          {schedule.kind === 'rrule'
                            ? t('PGBOSS.SCHEDULES.KIND_RRULE')
                            : t('PGBOSS.SCHEDULES.KIND_CRON')}
                        </Badge>
                      </span>
                      <small className="text-[0.7rem] text-muted-foreground">
                        {schedule.timezone}
                      </small>
                    </div>
                  </TableCell>
                  <TableCell>
                    {nextRun ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div tabIndex={0} className="w-fit outline-none">
                            {renderTime(nextRun)}
                          </div>
                        </TooltipTrigger>
                        {laterRuns.length > 0 && (
                          <TooltipContent>
                            <span className="mb-1 block font-medium">
                              {t('PGBOSS.SCHEDULES.NEXT_RUNS')}
                            </span>
                            <ol className="m-0 list-none p-0 font-mono tabular-nums">
                              {schedule.nextRuns.map((run) => (
                                <li key={run}>
                                  {formatDate(Date.parse(run), i18n.language, dateFormats)}
                                </li>
                              ))}
                            </ol>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t('PGBOSS.SCHEDULES.NO_NEXT_RUNS')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {schedule.lastJobId ? (
                      <Link
                        to={pgBossLinks.jobPage(schedule.queueName, schedule.lastJobId)}
                        title={schedule.lastJobId}
                        className="underline-offset-4 hover:text-primary hover:underline"
                      >
                        {shortId(schedule.lastJobId)}
                      </Link>
                    ) : (
                      <Muted />
                    )}
                  </TableCell>
                  <TableCell>{renderTime(schedule.updatedOn)}</TableCell>
                  <TableCell className="pr-3 text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      {canRun &&
                        iconAction(
                          t('PGBOSS.SCHEDULES.RUN_NOW'),
                          <PlayIcon />,
                          actions.runScheduleNow(schedule)
                        )}
                      {canWrite &&
                        iconAction(t('PGBOSS.SCHEDULES.EDIT'), <PencilIcon />, () =>
                          setEditing({ schedule })
                        )}
                      {canWrite &&
                        iconAction(
                          t('PGBOSS.SCHEDULES.REMOVE'),
                          <Trash2Icon />,
                          actions.removeSchedule(schedule),
                          'hover:bg-destructive/10 hover:text-destructive'
                        )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TooltipProvider>
    );
  };

  return (
    <section className="flex max-w-[1600px] flex-col gap-4 pt-1">
      <PgBossWritesDisabledBanner info={info} />
      <Card className="gap-0 py-0 shadow-xs animate-fade-in-up">
        <CardHeader className="flex flex-wrap items-center justify-between gap-3 border-b py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15">
              <CalendarClock className="size-4.5" aria-hidden="true" />
            </span>
            <CardTitle className="flex items-center gap-2">
              <h2 className="m-0 text-lg leading-tight font-semibold tracking-tight">
                {t('PGBOSS.SCHEDULES.TITLE')}
              </h2>
              {!loading && list.length > 0 && (
                <Badge variant="secondary" className="tabular-nums">
                  {formatNumber(list.length, i18n.language)}
                </Badge>
              )}
            </CardTitle>
          </div>
          <CardAction className="flex flex-wrap items-center gap-2">
            <Select value={queueFilter ?? ALL_QUEUES} onValueChange={setQueueFilter}>
              <SelectTrigger
                aria-label={t('PGBOSS.SCHEDULES.FILTER_BY_QUEUE')}
                className="min-w-56"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value={ALL_QUEUES}>{t('PGBOSS.SCHEDULES.ALL_QUEUES')}</SelectItem>
                {(queues ?? []).map((queue) => (
                  <SelectItem key={queue.name} value={queue.name}>
                    {queue.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canWrite && (
              <Button size="sm" onClick={() => setEditing({ schedule: null })}>
                <PlusIcon data-icon="inline-start" />
                {t('PGBOSS.SCHEDULES.CREATE')}
              </Button>
            )}
          </CardAction>
        </CardHeader>
        <CardContent className="p-0">{renderBody()}</CardContent>
      </Card>

      <Suspense fallback={null}>
        {!!editing && (
          <PgBossScheduleEditModalLazy
            open
            schedule={editing.schedule}
            queueName={queueFilter}
            canPreview={permissions.canPreview}
            onClose={() => setEditing(null)}
          />
        )}
      </Suspense>
    </section>
  );
};
