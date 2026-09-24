import type { AppJobScheduler, AppQueue } from '@worker-manager/api/typings/app';
import { TriangleAlert } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  GanttColumns,
  GanttFeatureItem,
  GanttFeatureList,
  GanttFeatureListGroup,
  GanttFeatureRow,
  GanttHeader,
  GanttPoint,
  GanttProvider,
  GanttSidebar,
  GanttSidebarGroup,
  GanttSidebarItem,
  GanttTimeline,
  GanttToday,
} from '@/components/ui/gantt';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatNumber } from '../../components/MetricsSummary/formatNumber';
import { RangeSelector } from '../../components/RangeSelector/RangeSelector';
import { useMobileQuery } from '../../hooks/useMobileQuery';
import { useSettingsStore } from '../../hooks/useSettings';
import { formatRelativeToNow } from '../../utils/formatDate';
import { describeSchedule, formatInterval } from './schedule';
import {
  findHotspots,
  minuteOf,
  schedulerRuns,
  TIMELINE_ZOOMS,
  timelineWindow,
  type SchedulerTimelineRow,
  type TimelineZoom,
} from './timeline';

/** Rows drawn before "show all": past this the timeline is a wall rather than an overview. */
export const TIMELINE_ROW_CAP = 40;

const ZOOM_LABEL_KEYS = {
  day: 'SCHEDULERS.TIMELINE.ZOOM_DAY',
  week: 'SCHEDULERS.TIMELINE.ZOOM_WEEK',
  month: 'SCHEDULERS.TIMELINE.ZOOM_MONTH',
} as const;

const formatInstant = (time: number, locale: string) => {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  };
  try {
    return new Intl.DateTimeFormat(locale, options).format(time);
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(time);
  }
};

const LegendSwatch = ({ className }: { className: string }) => (
  <span aria-hidden="true" className={cn('inline-block shrink-0', className)} />
);

const NEXT_DOT = 'size-3 rounded-full bg-status-active ring-2 ring-card';
const RUN_DOT = 'size-2 rounded-full bg-status-active/70 ring-2 ring-card';
const LAST_DOT = 'size-2.5 rounded-full border-2 border-muted-foreground bg-card';
const HOTSPOT_MARK = 'size-2.5 rotate-45 rounded-[2px] bg-status-waiting';

interface SchedulersTimelineProps {
  schedulers: AppJobScheduler[];
  queuesByName: Map<string, AppQueue>;
  onSelect: (scheduler: AppJobScheduler) => void;
  /** Injectable for tests. */
  now?: number;
}

/**
 * Read-only Gantt of the schedulers: one row per scheduler, grouped by queue, with a marker for
 * each upcoming run inside the window, the previous run where BullMQ reports it, and a lane of
 * minutes in which several schedulers start at once.
 */
export const SchedulersTimeline = ({
  schedulers,
  queuesByName,
  onSelect,
  now: nowProp,
}: SchedulersTimelineProps) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const zoom = useSettingsStore((state) => state.schedulersTimelineZoom);
  const setSettings = useSettingsStore((state) => state.setSettings);
  const [showAll, setShowAll] = useState(false);
  // On a phone the names column gives up width to the timeline, which scrolls sideways under it.
  const isMobile = useMobileQuery();

  // Re-read the clock whenever the data refreshes, so polling keeps the window current.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => nowProp ?? Date.now(), [nowProp, schedulers, zoom]);
  const span = useMemo(() => timelineWindow(zoom, now), [zoom, now]);

  const rows = useMemo(() => {
    const sorted = [...schedulers].sort(
      (a, b) =>
        a.queueName.localeCompare(b.queueName) ||
        (a.next ?? Number.POSITIVE_INFINITY) - (b.next ?? Number.POSITIVE_INFINITY) ||
        a.id.localeCompare(b.id)
    );
    return sorted.map((scheduler) => schedulerRuns(scheduler, span));
  }, [schedulers, span]);

  const hotspots = useMemo(() => findHotspots(rows), [rows]);
  const hotMinutes = useMemo(
    () => new Map(hotspots.map((hotspot) => [hotspot.minute, hotspot.keys])),
    [hotspots]
  );
  const idsByKey = useMemo(() => new Map(rows.map((row) => [row.key, row.scheduler.id])), [rows]);

  const visibleRows = showAll ? rows : rows.slice(0, TIMELINE_ROW_CAP);
  const groups = visibleRows.reduce<{ queueName: string; rows: SchedulerTimelineRow[] }[]>(
    (acc, row) => {
      const last = acc[acc.length - 1];
      if (last?.queueName === row.scheduler.queueName) {
        last.rows.push(row);
      } else {
        acc.push({ queueName: row.scheduler.queueName, rows: [row] });
      }
      return acc;
    },
    []
  );

  const overlapNames = (keys: string[]) => {
    const names = keys.map((key) => idsByKey.get(key) ?? key);
    return names.length > 4 ? `${names.slice(0, 4).join(', ')}, …` : names.join(', ');
  };

  const tip = (trigger: ReactNode, content: ReactNode, key: string | number) => (
    <Tooltip key={key}>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent className="flex-col items-start gap-0.5">{content}</TooltipContent>
    </Tooltip>
  );

  const runTip = (title: string, time: number, overlap?: string[]) => (
    <>
      <span className="font-semibold">{title}</span>
      <span>
        {formatInstant(time, locale)} · {formatRelativeToNow(time, locale, now)}
      </span>
      {overlap && (
        <span className="text-status-waiting">
          {t('SCHEDULERS.TIMELINE.OVERLAP', { total: overlap.length })}: {overlapNames(overlap)}
        </span>
      )}
    </>
  );

  const renderRun = (row: SchedulerTimelineRow, time: number, index: number) => {
    const overlap = hotMinutes.get(minuteOf(time));
    const isNext = index === 0;
    return tip(
      <GanttPoint
        date={time}
        data-run={isNext ? 'next' : 'upcoming'}
        className={cn(
          isNext ? NEXT_DOT : RUN_DOT,
          overlap && 'ring-status-waiting',
          'z-10 transition-transform hover:scale-125'
        )}
        aria-label={`${t(isNext ? 'SCHEDULERS.TIMELINE.NEXT_RUN' : 'SCHEDULERS.TIMELINE.UPCOMING')}: ${formatInstant(time, locale)}`}
      />,
      runTip(
        t(isNext ? 'SCHEDULERS.TIMELINE.NEXT_RUN' : 'SCHEDULERS.TIMELINE.UPCOMING'),
        time,
        overlap
      ),
      `${row.key}:${time}`
    );
  };

  const renderRow = (row: SchedulerTimelineRow) => {
    const { runs, dense, lastRun } = row;
    const lastInView = !!lastRun && lastRun >= span.start && lastRun <= span.end;
    const empty = runs.length === 0 && !dense && !lastInView;

    return (
      <GanttFeatureRow
        key={row.key}
        data-scheduler={row.key}
        onClick={() => onSelect(row.scheduler)}
        className="cursor-pointer transition-colors hover:bg-state-hover"
      >
        {dense &&
          tip(
            <GanttFeatureItem
              startAt={dense.from}
              endAt={dense.to}
              data-run="dense"
              className="h-3.5 overflow-hidden bg-status-active/12 ring-1 ring-status-active/35 ring-inset"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(90deg, color-mix(in oklab, var(--status-active) 55%, transparent) 0 1px, transparent 1px 5px)',
              }}
            />,
            <>
              <span className="font-semibold">
                {t('SCHEDULERS.TIMELINE.DENSE', { interval: formatInterval(dense.interval, t) })}
              </span>
              <span>
                {t('SCHEDULERS.TIMELINE.RUNS_IN_VIEW', {
                  total: formatNumber(row.runsInView, locale),
                })}
              </span>
            </>,
            'dense'
          )}

        {runs.length > 1 && (
          <GanttFeatureItem
            startAt={runs[0]}
            endAt={runs[runs.length - 1]}
            aria-hidden="true"
            className="h-1 bg-status-active/18"
          />
        )}

        {runs.map((time, index) => renderRun(row, time, index))}

        {lastInView &&
          tip(
            <GanttPoint
              date={lastRun}
              data-run="last"
              className={cn(LAST_DOT, 'z-10')}
              aria-label={`${t('SCHEDULERS.TIMELINE.LAST_RUN')}: ${formatInstant(lastRun, locale)}`}
            />,
            runTip(t('SCHEDULERS.TIMELINE.LAST_RUN'), lastRun),
            'last'
          )}

        {empty && (
          <span className="sticky left-[calc(var(--gantt-sidebar-width)+0.75rem)] inline-flex h-full items-center text-[0.7rem] text-muted-foreground">
            {t('SCHEDULERS.TIMELINE.NO_RUNS')}
          </span>
        )}
      </GanttFeatureRow>
    );
  };

  return (
    <TooltipProvider>
      <div className="flex flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
          <RangeSelector
            ranges={TIMELINE_ZOOMS}
            value={zoom}
            onChange={(next: TimelineZoom) => setSettings({ schedulersTimelineZoom: next })}
            getLabel={(value) => t(ZOOM_LABEL_KEYS[value])}
            aria-label={t('SCHEDULERS.TIMELINE.ZOOM')}
          />
          <ul
            aria-label={t('SCHEDULERS.TIMELINE.LEGEND')}
            className="m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-1 p-0 text-xs text-muted-foreground"
          >
            <li className="inline-flex items-center gap-1.5">
              <LegendSwatch className={NEXT_DOT} />
              {t('SCHEDULERS.TIMELINE.NEXT_RUN')}
            </li>
            <li className="inline-flex items-center gap-1.5">
              <LegendSwatch className={RUN_DOT} />
              {t('SCHEDULERS.TIMELINE.UPCOMING')}
            </li>
            <li className="inline-flex items-center gap-1.5">
              <LegendSwatch className={LAST_DOT} />
              {t('SCHEDULERS.TIMELINE.LAST_RUN')}
            </li>
            {hotspots.length > 0 && (
              <li className="inline-flex items-center gap-1.5">
                <LegendSwatch className={HOTSPOT_MARK} />
                {t('SCHEDULERS.TIMELINE.OVERLAPS')}
              </li>
            )}
          </ul>
        </div>

        <GanttProvider
          start={span.start}
          end={span.end}
          zoom={zoom}
          locale={locale}
          now={now}
          sidebarWidth={isMobile ? 168 : 264}
          role="region"
          aria-label={t('SCHEDULERS.TIMELINE.LABEL')}
          className="max-h-[min(72vh,760px)]"
        >
          <GanttSidebar
            title={t('SCHEDULERS.COLUMNS.SCHEDULER')}
            meta={t('SCHEDULERS.TIMELINE.IN_VIEW')}
          >
            {hotspots.length > 0 && (
              <GanttSidebarItem className="gap-2 font-medium text-foreground">
                <TriangleAlert
                  className="size-3.5 shrink-0 text-status-waiting"
                  aria-hidden="true"
                />
                <span className="truncate">{t('SCHEDULERS.TIMELINE.OVERLAPS')}</span>
                <Badge
                  variant="outline"
                  className="ml-auto border-status-waiting/30 bg-status-waiting/10 text-status-waiting tabular-nums"
                >
                  {formatNumber(hotspots.length, locale)}
                </Badge>
              </GanttSidebarItem>
            )}
            {groups.map((group) => {
              const queue = queuesByName.get(group.queueName);
              return (
                <GanttSidebarGroup
                  key={group.queueName}
                  name={queue?.displayName || group.queueName}
                  meta={
                    <span className="text-[0.7rem] font-normal text-muted-foreground tabular-nums">
                      {formatNumber(group.rows.length, locale)}
                    </span>
                  }
                >
                  {group.rows.map((row) => {
                    const { scheduler } = row;
                    const schedule = describeSchedule(scheduler, t);
                    return (
                      <GanttSidebarItem
                        key={row.key}
                        onSelect={() => onSelect(scheduler)}
                        aria-label={t('SCHEDULERS.TIMELINE.ROW_LABEL', {
                          id: scheduler.id,
                          schedule,
                          next: scheduler.next ? formatInstant(scheduler.next, locale) : '-',
                        })}
                      >
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-medium text-foreground">
                            {scheduler.id}
                          </span>
                          <span className="truncate font-mono text-[0.68rem] text-muted-foreground">
                            {schedule}
                            {scheduler.tz ? ` · ${scheduler.tz}` : ''}
                          </span>
                        </span>
                        {row.nextOnly && (
                          <span
                            className="shrink-0 text-[0.68rem] text-muted-foreground"
                            title={t('SCHEDULERS.TIMELINE.NEXT_ONLY')}
                          >
                            *
                          </span>
                        )}
                        <span className="shrink-0 text-[0.68rem] text-muted-foreground tabular-nums">
                          {formatNumber(row.runsInView, locale)}
                        </span>
                      </GanttSidebarItem>
                    );
                  })}
                </GanttSidebarGroup>
              );
            })}
          </GanttSidebar>

          <GanttTimeline>
            <GanttHeader />
            <GanttColumns />
            <GanttFeatureList>
              {hotspots.length > 0 && (
                <GanttFeatureRow data-lane="overlaps" className="bg-status-waiting/[0.04]">
                  {hotspots.map((hotspot) =>
                    tip(
                      <GanttPoint
                        date={hotspot.minute}
                        className={cn(HOTSPOT_MARK, 'transition-transform hover:scale-125')}
                        aria-label={`${t('SCHEDULERS.TIMELINE.OVERLAP', {
                          total: hotspot.keys.length,
                        })}: ${formatInstant(hotspot.minute, locale)}`}
                      />,
                      <>
                        <span className="font-semibold">
                          {t('SCHEDULERS.TIMELINE.OVERLAP', { total: hotspot.keys.length })}
                        </span>
                        <span>{formatInstant(hotspot.minute, locale)}</span>
                        <span className="opacity-80">{overlapNames(hotspot.keys)}</span>
                      </>,
                      hotspot.minute
                    )
                  )}
                </GanttFeatureRow>
              )}
              {groups.map((group) => (
                <GanttFeatureListGroup key={group.queueName}>
                  {group.rows.map(renderRow)}
                </GanttFeatureListGroup>
              ))}
            </GanttFeatureList>
            <GanttToday label={t('SCHEDULERS.TIMELINE.NOW')} />
          </GanttTimeline>
        </GanttProvider>

        {rows.length > visibleRows.length && (
          <div className="flex justify-center border-t px-4 py-3">
            <Button variant="outline" size="sm" onClick={() => setShowAll(true)}>
              {t('SCHEDULERS.TIMELINE.SHOW_ALL', { total: formatNumber(rows.length, locale) })}
            </Button>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
};

/** Placeholder rows in the timeline's own shape while the schedulers load. */
export const SchedulersTimelineSkeleton = () => (
  <div className="flex flex-col" aria-hidden="true" data-testid="schedulers-timeline-skeleton">
    <div className="flex items-center justify-between border-b px-4 py-2.5">
      <Skeleton className="h-7 w-44" />
      <Skeleton className="h-4 w-64" />
    </div>
    <div className="grid grid-cols-[264px_minmax(0,1fr)]">
      <div className="border-r">
        <div className="h-[52px] border-b" />
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex h-11 flex-col justify-center gap-1.5 border-b px-3">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-2.5 w-20" />
          </div>
        ))}
      </div>
      <div>
        <div className="h-[52px] border-b" />
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex h-11 items-center border-b px-4">
            <Skeleton
              className="h-2 rounded-full"
              style={{ marginLeft: `${(index * 13) % 40}%`, width: `${30 + ((index * 17) % 40)}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  </div>
);
