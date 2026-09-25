import type { AppJobScheduler, AppQueue } from '@worker-manager/api/typings/app';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarClock,
  ChevronRight,
  ChartGantt,
  Pencil,
  Play,
  Table2,
  Trash2,
} from 'lucide-react';
import { Fragment, useState } from 'react';
import type { ReactNode } from 'react';
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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { CollapsibleJSON } from '../../components/CollapsibleJSON/CollapsibleJSON';
import { Loader } from '../../components/Loader/Loader';
import { formatNumber } from '../../components/MetricsSummary/formatNumber';
import { useJobSchedulers } from '../../hooks/useJobSchedulers';
import { useQueues } from '../../hooks/useQueues';
import { type SchedulersView, useSettingsStore } from '../../hooks/useSettings';
import { useUIConfig } from '../../hooks/useUIConfig';
import { canScheduler } from '../../utils/capabilities';
import { formatDate, formatRelativeToNow } from '../../utils/formatDate';
import { links } from '../../utils/links';
import { describeSchedule } from './schedule';
import { SchedulerEditModal } from './SchedulerEditModal';
import { SchedulersTimeline, SchedulersTimelineSkeleton } from './SchedulersTimeline';

const ALL_QUEUES = '';
/** Radix Select reserves the empty string for "no value", so "all queues" needs a stand-in. */
const ALL_QUEUES_OPTION = '__all_queues__';

type SortKey = 'id' | 'queue' | 'next' | 'lastRun' | 'runs';
type SortState = { key: SortKey; direction: 'asc' | 'desc' } | null;

type SchedulerStatus = 'ACTIVE' | 'LIMIT_REACHED' | 'ENDED' | 'IDLE';

/**
 * What a scheduler is doing right now, read off the fields BullMQ already returns: a scheduler
 * that has used up its `limit` or passed its `endDate` stops firing, and one with no `next`
 * has nothing queued.
 */
const schedulerStatus = (scheduler: AppJobScheduler, now: number): SchedulerStatus => {
  if (scheduler.limit && (scheduler.iterationCount ?? 0) >= scheduler.limit) {
    return 'LIMIT_REACHED';
  }
  if (scheduler.endDate && scheduler.endDate < now) {
    return 'ENDED';
  }
  if (!scheduler.next) {
    return 'IDLE';
  }
  return 'ACTIVE';
};

const STATUS_CLASS: Record<SchedulerStatus, string> = {
  ACTIVE: 'border-status-active/25 bg-status-active/10 text-status-active',
  LIMIT_REACHED: 'border-status-completed/25 bg-status-completed/10 text-status-completed',
  ENDED: 'border-border bg-muted text-muted-foreground',
  IDLE: 'border-status-paused/25 bg-status-paused/10 text-status-paused',
};

const STATUS_LABEL_KEYS = {
  ACTIVE: 'SCHEDULERS.STATUS.ACTIVE',
  LIMIT_REACHED: 'SCHEDULERS.STATUS.LIMIT_REACHED',
  ENDED: 'SCHEDULERS.STATUS.ENDED',
  IDLE: 'SCHEDULERS.STATUS.IDLE',
} as const;

const sortValue = (scheduler: AppJobScheduler, key: SortKey): string | number | undefined => {
  switch (key) {
    case 'id':
      return scheduler.id;
    case 'queue':
      return scheduler.queueName;
    case 'next':
      return scheduler.next;
    case 'lastRun':
      return scheduler.lastRun;
    case 'runs':
      return scheduler.iterationCount;
  }
};

const compareSchedulers = (
  a: AppJobScheduler,
  b: AppJobScheduler,
  { key, direction }: NonNullable<SortState>
) => {
  const left = sortValue(a, key);
  const right = sortValue(b, key);
  // Missing values sort last whichever way the column is ordered.
  if (left === undefined || right === undefined) {
    return left === right ? 0 : left === undefined ? 1 : -1;
  }
  const order =
    typeof left === 'number' && typeof right === 'number'
      ? left - right
      : String(left).localeCompare(String(right));
  return direction === 'asc' ? order : -order;
};

const VIEWS: SchedulersView[] = ['table', 'timeline'];

const VIEW_LABEL_KEYS = {
  table: 'SCHEDULERS.VIEW.TABLE',
  timeline: 'SCHEDULERS.VIEW.TIMELINE',
} as const;

const VIEW_ICONS = { table: Table2, timeline: ChartGantt } as const;

const HEAD_CLASS = 'h-9 text-[0.68rem] font-semibold tracking-wide text-muted-foreground uppercase';

const Muted = () => <span className="text-muted-foreground">-</span>;

export const SchedulersPage = () => {
  const { t, i18n } = useTranslation();
  const history = useHistory();
  const location = useLocation();
  const uiConfig = useUIConfig();

  const queueFilter = new URLSearchParams(location.search).get('queueName') || ALL_QUEUES;

  const { schedulers, loading, actions } = useJobSchedulers(queueFilter || undefined);
  const { queues } = useQueues();
  const [expanded, setExpanded] = useState<string[]>([]);
  const [editing, setEditing] = useState<AppJobScheduler | null>(null);
  const [sort, setSort] = useState<SortState>(null);
  const view = useSettingsStore((state) => state.schedulersView);
  const setSettings = useSettingsStore((state) => state.setSettings);

  const queuesByName = new Map<string, AppQueue>(
    (queues ?? []).map((queue) => [queue.name, queue])
  );

  const rowKey = (scheduler: AppJobScheduler) => `${scheduler.queueName}:${scheduler.id}`;

  const toggleRow = (scheduler: AppJobScheduler) => {
    const key = rowKey(scheduler);
    setExpanded((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]));
  };

  const setQueueFilter = (queueName: string) => {
    const search = queueName ? `?queueName=${encodeURIComponent(queueName)}` : '';
    history.push(`/job-schedulers${search}`);
  };

  // Server order until a column is picked; a third click on the same column goes back to it.
  const cycleSort = (key: SortKey) =>
    setSort((current) =>
      current?.key !== key
        ? { key, direction: 'asc' }
        : current.direction === 'asc'
          ? { key, direction: 'desc' }
          : null
    );

  /**
   * What a timeline row opens: the edit form where the schedule can be changed, otherwise the
   * job its next run will be, otherwise its queue -- the same places the table links to.
   */
  const selectScheduler = (scheduler: AppJobScheduler) => {
    const queue = queuesByName.get(scheduler.queueName);
    if (canScheduler(queue, 'update') && !queue?.readOnlyMode) {
      setEditing(scheduler);
    } else if (scheduler.nextRunJobId) {
      history.push(links.jobPage(scheduler.queueName, scheduler.nextRunJobId));
    } else {
      history.push(`/queue/${encodeURIComponent(scheduler.queueName)}`);
    }
  };

  const sortedSchedulers = sort
    ? [...schedulers].sort((a, b) => compareSchedulers(a, b, sort))
    : schedulers;

  const now = Date.now();

  /**
   * The time itself becomes the link when the run it describes is a job that still exists, so a
   * run the queue has already trimmed away reads as plain text rather than a dead link.
   */
  const renderTime = (scheduler: AppJobScheduler, ts?: number, jobId?: string) => {
    if (!ts) {
      return <Muted />;
    }

    const relative = formatRelativeToNow(ts, i18n.language);
    const time = (
      <time dateTime={new Date(ts).toISOString()} className="font-medium">
        {relative}
      </time>
    );

    return (
      <div className="flex flex-col gap-0.5">
        {jobId ? (
          <Link
            to={links.jobPage(scheduler.queueName, jobId)}
            className="w-fit text-foreground underline-offset-4 hover:text-primary hover:underline"
          >
            {time}
          </Link>
        ) : (
          time
        )}
        <small className="text-[0.7rem] text-muted-foreground tabular-nums">
          {formatDate(ts, i18n.language, uiConfig.dateFormats)}
        </small>
      </div>
    );
  };

  const sortableHead = (key: SortKey, label: ReactNode, className?: string) => {
    const active = sort?.key === key;
    const Icon = !active ? ArrowUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown;
    return (
      <TableHead
        className={cn(HEAD_CLASS, className)}
        aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}
      >
        <button
          type="button"
          onClick={() => cycleSort(key)}
          className={cn(
            '-mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 uppercase transition-colors outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
            active && 'text-foreground'
          )}
        >
          {label}
          <Icon
            aria-hidden="true"
            className={cn('size-3 transition-opacity', active ? 'opacity-100' : 'opacity-40')}
          />
        </button>
      </TableHead>
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

  return (
    <section className="max-w-[1600px] pt-1">
      <Card className="gap-0 py-0 shadow-xs animate-fade-in-up">
        <CardHeader className="flex flex-wrap items-center justify-between gap-3 border-b py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15">
              <CalendarClock className="size-4.5" aria-hidden="true" />
            </span>
            <CardTitle className="flex items-center gap-2">
              <h2 className="m-0 text-lg leading-tight font-semibold tracking-tight">
                {t('SCHEDULERS.TITLE')}
              </h2>
              {!loading && schedulers.length > 0 && (
                <Badge variant="secondary" className="tabular-nums">
                  {formatNumber(schedulers.length, i18n.language)}
                </Badge>
              )}
            </CardTitle>
          </div>
          <CardAction className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={0}
              value={view}
              onValueChange={(next) =>
                next && setSettings({ schedulersView: next as SchedulersView })
              }
              aria-label={t('SCHEDULERS.VIEW.LABEL')}
            >
              {VIEWS.map((option) => {
                const Icon = VIEW_ICONS[option];
                return (
                  <ToggleGroupItem
                    key={option}
                    value={option}
                    className="gap-1.5 px-2.5 text-xs data-[state=on]:bg-state-selected data-[state=on]:text-state-selected-foreground"
                  >
                    <Icon aria-hidden="true" />
                    {t(VIEW_LABEL_KEYS[option])}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
            <Select
              value={queueFilter || ALL_QUEUES_OPTION}
              onValueChange={(value) =>
                setQueueFilter(value === ALL_QUEUES_OPTION ? ALL_QUEUES : value)
              }
            >
              {/* The trigger is as wide as the value it shows, so without a floor the filter
                  would resize on every pick. */}
              <SelectTrigger
                id="scheduler-queue-filter"
                aria-label={t('SCHEDULERS.FILTER_BY_QUEUE')}
                className="min-w-56"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value={ALL_QUEUES_OPTION}>{t('SCHEDULERS.ALL_QUEUES')}</SelectItem>
                {(queues ?? []).map((queue) => (
                  <SelectItem key={queue.name} value={queue.name}>
                    {queue.displayName || queue.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardAction>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            view === 'timeline' ? (
              <SchedulersTimelineSkeleton />
            ) : (
              <div className="p-6">
                <Loader />
              </div>
            )
          ) : schedulers.length === 0 ? (
            <Empty className="py-12">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarClock />
                </EmptyMedia>
                <EmptyDescription>{t('SCHEDULERS.EMPTY')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : view === 'timeline' ? (
            <SchedulersTimeline
              schedulers={schedulers}
              queuesByName={queuesByName}
              onSelect={selectScheduler}
            />
          ) : (
            <TooltipProvider>
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-10" />
                    {sortableHead('id', t('SCHEDULERS.COLUMNS.SCHEDULER'))}
                    {sortableHead('queue', t('SCHEDULERS.COLUMNS.QUEUE'))}
                    <TableHead className={HEAD_CLASS}>{t('SCHEDULERS.COLUMNS.SCHEDULE')}</TableHead>
                    {sortableHead('next', t('SCHEDULERS.COLUMNS.NEXT_RUN'))}
                    {sortableHead('lastRun', t('SCHEDULERS.COLUMNS.LAST_RUN'))}
                    {sortableHead('runs', t('SCHEDULERS.COLUMNS.RUNS'))}
                    <TableHead className={HEAD_CLASS}>{t('SCHEDULERS.COLUMNS.STATUS')}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedSchedulers.map((scheduler, index) => {
                    const queue = queuesByName.get(scheduler.queueName);
                    const isReadOnly = queue?.readOnlyMode ?? false;
                    // Editing needs an upsert and running on demand needs a stored template, and
                    // Bull has neither. An unknown queue is treated the same way until the queues
                    // list arrives.
                    const canRun = canScheduler(queue, 'run');
                    const canUpdate = canScheduler(queue, 'update');
                    const isExpanded = expanded.includes(rowKey(scheduler));
                    const hasTemplate = !!scheduler.template?.data || !!scheduler.template?.opts;
                    const status = schedulerStatus(scheduler, now);

                    return (
                      <Fragment key={rowKey(scheduler)}>
                        <TableRow
                          className="group/row animate-fade-in-up align-top hover:bg-state-hover"
                          style={{ animationDelay: `${Math.min(index * 35, 420)}ms` }}
                        >
                          <TableCell className="pt-3 pr-0 pl-3">
                            {hasTemplate && (
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-expanded={isExpanded}
                                aria-label={t('SCHEDULERS.TEMPLATE')}
                                onClick={() => toggleRow(scheduler)}
                                className="text-muted-foreground"
                              >
                                <ChevronRight
                                  aria-hidden="true"
                                  className={cn(
                                    'transition-transform duration-200',
                                    isExpanded && 'rotate-90'
                                  )}
                                />
                              </Button>
                            )}
                          </TableCell>
                          <TableCell className="py-3 whitespace-normal">
                            <span className="block font-medium break-all text-foreground">
                              {scheduler.id}
                            </span>
                            <small className="block text-[0.7rem] text-muted-foreground">
                              {scheduler.name}
                            </small>
                          </TableCell>
                          <TableCell className="py-3">
                            <Link
                              to={`/queue/${encodeURIComponent(scheduler.queueName)}`}
                              className="text-foreground underline-offset-4 hover:text-primary hover:underline"
                            >
                              {queue?.displayName || scheduler.queueName}
                            </Link>
                          </TableCell>
                          <TableCell className="py-3">
                            <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                              {describeSchedule(scheduler, t)}
                            </code>
                            {!!scheduler.tz && (
                              <small className="mt-1 block text-[0.7rem] text-muted-foreground">
                                {scheduler.tz}
                              </small>
                            )}
                          </TableCell>
                          <TableCell className="py-3">
                            {renderTime(scheduler, scheduler.next, scheduler.nextRunJobId)}
                          </TableCell>
                          <TableCell className="py-3">
                            {renderTime(scheduler, scheduler.lastRun, scheduler.lastRunJobId)}
                          </TableCell>
                          <TableCell className="py-3 font-mono tabular-nums">
                            {scheduler.iterationCount ?? <Muted />}
                            {!!scheduler.limit && (
                              <small className="block font-sans text-[0.7rem] text-muted-foreground">
                                {t('SCHEDULERS.OF_LIMIT', { limit: scheduler.limit })}
                              </small>
                            )}
                          </TableCell>
                          <TableCell className="py-3">
                            <Badge variant="outline" className={STATUS_CLASS[status]}>
                              {status === 'ACTIVE' && (
                                <span
                                  aria-hidden="true"
                                  className="size-1.5 rounded-full bg-current animate-pulse-ring"
                                />
                              )}
                              {t(STATUS_LABEL_KEYS[status])}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-2.5 pr-3 text-right">
                            <div className="inline-flex items-center gap-0.5 opacity-80 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
                              {!isReadOnly &&
                                canRun &&
                                iconAction(
                                  t('SCHEDULERS.ACTIONS.RUN'),
                                  <Play />,
                                  actions.runNow(scheduler),
                                  'hover:text-status-completed'
                                )}
                              {!isReadOnly &&
                                canUpdate &&
                                iconAction(t('SCHEDULERS.ACTIONS.EDIT'), <Pencil />, () =>
                                  setEditing(scheduler)
                                )}
                              {!isReadOnly &&
                                iconAction(
                                  t('SCHEDULERS.ACTIONS.REMOVE'),
                                  <Trash2 />,
                                  actions.remove(scheduler),
                                  'hover:bg-destructive/10 hover:text-destructive'
                                )}
                            </div>
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <TableRow className="bg-muted/20 hover:bg-muted/20">
                            <TableCell />
                            <TableCell
                              colSpan={8}
                              className="pt-0 pb-3 whitespace-normal animate-in duration-200 fade-in-0 slide-in-from-top-1"
                            >
                              <CollapsibleJSON data={scheduler.template} />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </TooltipProvider>
          )}
        </CardContent>
      </Card>

      {!!editing && (
        <SchedulerEditModal
          open={true}
          scheduler={editing}
          onClose={() => setEditing(null)}
          onSubmit={(repeat) => actions.update(editing, repeat)}
        />
      )}
    </section>
  );
};
