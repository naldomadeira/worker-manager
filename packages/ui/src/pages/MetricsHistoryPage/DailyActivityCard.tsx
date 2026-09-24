import { CalendarDays } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  type Activity,
  ContributionGraph,
  ContributionGraphAxis,
  ContributionGraphBlock,
  ContributionGraphCalendar,
  ContributionGraphFooter,
  ContributionGraphLegend,
  localeWeekStart,
} from '@/components/ui/contribution-graph';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatNumber } from '../../components/MetricsSummary/formatNumber';
import { RangeSelector } from '../../components/RangeSelector/RangeSelector';
import type { ThroughputRow } from '../../components/ThroughputAreaChart/throughputSeries';

export type ActivityMeasure = 'completed' | 'failed' | 'failureRate';

const MEASURES: ActivityMeasure[] = ['completed', 'failed', 'failureRate'];

const MEASURE_LABEL_KEYS = {
  completed: 'METRICS_HISTORY.ACTIVITY.MODE_COMPLETED',
  failed: 'METRICS_HISTORY.ACTIVITY.MODE_FAILED',
  failureRate: 'METRICS_HISTORY.ACTIVITY.MODE_FAILURE_RATE',
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

const STAT_LABEL = 'text-[0.68rem] font-semibold tracking-wide text-muted-foreground uppercase';
const MAX_LEVEL = 4;

/** History buckets are UTC days (see `isPartialBucket`), so the cell keys are too. */
const utcDay = (ts: number) => new Date(ts).toISOString().slice(0, 10);

export interface DayActivity extends Activity {
  completed: number;
  failed: number;
  rate: number;
}

/**
 * One cell per day of the range, oldest first, the last one today. Days the provider has no
 * bucket for are real zeroes rather than gaps, so the grid always spans the whole range.
 */
export const toDayActivities = (
  rows: ThroughputRow[],
  days: number,
  measure: ActivityMeasure,
  now: number = Date.now()
): DayActivity[] => {
  const byDay = new Map(rows.map((row) => [utcDay(row.x), row]));
  const today = Math.floor(now / DAY_MS) * DAY_MS;

  const cells = Array.from({ length: days }, (_, index) => {
    const ts = today - (days - 1 - index) * DAY_MS;
    const date = utcDay(ts);
    const row = byDay.get(date);
    const completed = row?.completed ?? 0;
    const failed = row?.failed ?? 0;
    const runs = completed + failed;
    const rate = runs > 0 ? failed / runs : 0;
    const count = measure === 'completed' ? completed : measure === 'failed' ? failed : rate;
    return { date, completed, failed, rate, count, level: 0, partial: ts === today };
  });

  // Quartiles of the non-empty days, as GitHub does: a steady queue whose every weekday is
  // within 10% of the peak would otherwise paint one flat colour and hide its weekly rhythm.
  const nonEmpty = cells
    .map((cell) => cell.count)
    .filter((count) => count > 0)
    .sort((a, b) => a - b);
  const quantile = (q: number) =>
    nonEmpty[Math.min(nonEmpty.length - 1, Math.floor(q * nonEmpty.length))];
  const thresholds = [quantile(0.25), quantile(0.5), quantile(0.75)];
  const max = nonEmpty[nonEmpty.length - 1] ?? 0;
  const degenerate = nonEmpty.length < 4 || thresholds[0] === thresholds[2];
  for (const cell of cells) {
    if (cell.count <= 0) {
      cell.level = 0;
    } else if (degenerate) {
      cell.level = Math.max(1, Math.ceil((cell.count / max) * MAX_LEVEL));
    } else {
      cell.level = 1 + thresholds.filter((threshold) => cell.count > threshold).length;
    }
  }
  return cells;
};

const formatDay = (date: string, locale: string, options: Intl.DateTimeFormatOptions) => {
  // `yyyy-MM-dd` read as a local date, so the label is that calendar day in every zone.
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(year, month - 1, day);
  try {
    return new Intl.DateTimeFormat(locale, options).format(value);
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(value);
  }
};

interface DailyActivityCardProps {
  rows: ThroughputRow[];
  days: number;
  className?: string;
}

/**
 * "Daily activity": the history page's daily buckets as a contribution graph, one cell per day,
 * coloured by completed jobs, failed jobs or the failure rate. Short ranges read as a single strip;
 * 90 days folds into weeks. Next to it, the peak day, the daily average and an average per
 * weekday, which is the question a calendar view is best at answering.
 */
export const DailyActivityCard = ({ rows, days, className }: DailyActivityCardProps) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const [measure, setMeasure] = useState<ActivityMeasure>('completed');

  const activities = useMemo(() => toDayActivities(rows, days, measure), [rows, days, measure]);
  const layout = days > 31 ? 'weeks' : 'strip';
  const tone = measure === 'completed' ? 'completed' : 'failed';
  const isRate = measure === 'failureRate';

  const formatValue = (value: number) =>
    isRate
      ? formatNumber(value, locale, { style: 'percent', maximumFractionDigits: 1 })
      : formatNumber(Math.round(value), locale);

  const measureLabel = t(MEASURE_LABEL_KEYS[measure]);
  const longDate: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  };

  const labels = useMemo(
    () => ({
      title: t('METRICS_HISTORY.ACTIVITY.GRAPH_LABEL', {
        measure: measureLabel,
        from: activities[0] ? formatDay(activities[0].date, locale, longDate) : '',
        to: activities.length
          ? formatDay(activities[activities.length - 1].date, locale, longDate)
          : '',
      }),
      legend: {
        less: t('METRICS_HISTORY.ACTIVITY.LESS'),
        more: t('METRICS_HISTORY.ACTIVITY.MORE'),
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, measureLabel, activities, locale]
  );

  // Completed days only, not today's partial bucket, so the peak and average are not dragged by
  // a day that is still filling up.
  const settled = activities.filter((activity) => !activity.partial);
  const pool = settled.length > 0 ? settled : activities;
  const peak = pool.reduce<DayActivity | undefined>(
    (best, activity) => (!best || activity.count > best.count ? activity : best),
    undefined
  );
  const totals = pool.reduce(
    (acc, activity) => ({
      completed: acc.completed + activity.completed,
      failed: acc.failed + activity.failed,
    }),
    { completed: 0, failed: 0 }
  );
  const average = isRate
    ? totals.completed + totals.failed > 0
      ? totals.failed / (totals.completed + totals.failed)
      : 0
    : pool.reduce((sum, activity) => sum + activity.count, 0) / Math.max(1, pool.length);

  // Average per weekday, in the locale's week order. A rate is recomputed from the weekday's
  // totals rather than averaged, so a quiet day with one failure does not dominate it.
  const weekStart = localeWeekStart(locale);
  const weekdayStats = Array.from({ length: 7 }, (_, offset) => {
    const weekday = (weekStart + offset) % 7;
    const matching = pool.filter((activity) => {
      const [year, month, day] = activity.date.split('-').map(Number);
      return new Date(year, month - 1, day).getDay() === weekday;
    });
    const completed = matching.reduce((sum, activity) => sum + activity.completed, 0);
    const failed = matching.reduce((sum, activity) => sum + activity.failed, 0);
    const value = isRate
      ? completed + failed > 0
        ? failed / (completed + failed)
        : 0
      : matching.reduce((sum, activity) => sum + activity.count, 0) / Math.max(1, matching.length);
    // 2024-09-01 was a Sunday.
    const name = formatDay(`2024-09-0${1 + weekday}`, locale, { weekday: 'short' });
    return { weekday, name, value, days: matching.length };
  });
  const weekdayMax = Math.max(0, ...weekdayStats.map((stat) => stat.value));

  const hasPartial = activities.some((activity) => activity.partial);

  return (
    <Card className={className} data-testid="daily-activity" aria-labelledby="daily-activity-title">
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-border/60">
            <CalendarDays className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <CardTitle>
              <h3 id="daily-activity-title" className="m-0 text-sm font-semibold">
                {t('METRICS_HISTORY.ACTIVITY.TITLE')}
              </h3>
            </CardTitle>
            <CardDescription className="text-xs">
              {t('METRICS_HISTORY.ACTIVITY.DESCRIPTION')}
            </CardDescription>
          </div>
        </div>
        <CardAction>
          <RangeSelector
            ranges={MEASURES}
            value={measure}
            onChange={setMeasure}
            getLabel={(value) => t(MEASURE_LABEL_KEYS[value])}
            aria-label={t('METRICS_HISTORY.ACTIVITY.MEASURE')}
          />
        </CardAction>
      </CardHeader>

      <CardContent>
        <ContributionGraph
          key={`${layout}-${days}`}
          data={activities}
          layout={layout}
          locale={locale}
          tone={tone}
          maxLevel={MAX_LEVEL}
          blockSize={layout === 'weeks' ? 20 : days <= 7 ? 40 : 32}
          blockMargin={layout === 'weeks' ? 4 : days <= 7 ? 6 : 3}
          labels={labels}
          className="gap-4"
        >
          <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch">
            <div
              className={cn(
                'flex min-w-0 flex-col gap-2',
                // A strip is one row high; centred against the weekday list it does not float at
                // the top of an empty box.
                layout === 'strip' ? 'lg:flex-1 lg:justify-center' : 'shrink-0'
              )}
            >
              <ContributionGraphCalendar className={layout === 'weeks' ? 'lg:pt-1' : undefined}>
                {({ activity, dayIndex, weekIndex }) => {
                  const day = activity as DayActivity;
                  const runsLabel = t('METRICS_HISTORY.BAR_LABEL', {
                    completed: formatNumber(day.completed, locale),
                    failed: formatNumber(day.failed, locale),
                  });
                  const rateLabel =
                    day.completed + day.failed > 0
                      ? t('METRICS_HISTORY.FAILURE_RATE', { rate: formatValue(day.rate) })
                      : undefined;
                  const dateLabel = formatDay(day.date, locale, longDate);
                  return (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <ContributionGraphBlock
                          activity={day}
                          dayIndex={dayIndex}
                          weekIndex={weekIndex}
                          aria-label={[
                            dateLabel,
                            day.partial ? t('METRICS_HISTORY.ACTIVITY.IN_PROGRESS') : undefined,
                            runsLabel,
                            isRate ? rateLabel : undefined,
                          ]
                            .filter(Boolean)
                            .join(', ')}
                        />
                      </TooltipTrigger>
                      <TooltipContent className="flex-col items-start gap-0.5">
                        <span className="font-semibold">
                          {dateLabel}
                          {day.partial && (
                            <span className="font-normal opacity-75">
                              {' · '}
                              {t('METRICS_HISTORY.ACTIVITY.IN_PROGRESS')}
                            </span>
                          )}
                        </span>
                        <span>{runsLabel}</span>
                        {rateLabel && <span className="opacity-80">{rateLabel}</span>}
                      </TooltipContent>
                    </Tooltip>
                  );
                }}
              </ContributionGraphCalendar>
              {layout === 'strip' && (
                <ContributionGraphAxis className="text-[0.66rem] tabular-nums">
                  {({ activity, index }) => {
                    const [year, month, day] = activity.date.split('-').map(Number);
                    const date = new Date(year, month - 1, day);
                    if (days <= 7) {
                      return (
                        <span className="block text-center">
                          {formatDay(activity.date, locale, { weekday: 'short', day: 'numeric' })}
                        </span>
                      );
                    }
                    // A label on the first day of each week (and the first cell), so a month
                    // reads in four or five steps instead of thirty numbers.
                    return index === 0 || date.getDay() === weekStart
                      ? formatDay(activity.date, locale, { month: 'short', day: 'numeric' })
                      : null;
                  }}
                </ContributionGraphAxis>
              )}
            </div>

            <div
              className={cn(
                'grid min-w-0 flex-1 content-start gap-6 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)] lg:border-l lg:pl-6',
                layout === 'strip' && 'lg:max-w-[32rem]'
              )}
            >
              <dl className="m-0 grid content-start gap-4">
                <div className="min-w-0">
                  <dt className={STAT_LABEL}>{t('METRICS_HISTORY.ACTIVITY.PEAK')}</dt>
                  <dd className="m-0 mt-1">
                    <span className="block text-xl leading-tight font-semibold tabular-nums">
                      {formatValue(peak?.count ?? 0)}
                    </span>
                    <span className="block truncate text-[0.7rem] text-muted-foreground">
                      {peak && peak.count > 0
                        ? formatDay(peak.date, locale, {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                          })
                        : '-'}
                    </span>
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className={STAT_LABEL}>
                    {t(
                      isRate
                        ? 'METRICS_HISTORY.ACTIVITY.AVERAGE_RATE'
                        : 'METRICS_HISTORY.ACTIVITY.AVERAGE'
                    )}
                  </dt>
                  <dd className="m-0 mt-1 text-xl leading-tight font-semibold tabular-nums">
                    {formatValue(average)}
                  </dd>
                </div>
              </dl>
              <div className="min-w-0">
                <h4 className={cn(STAT_LABEL, 'm-0')}>
                  {t('METRICS_HISTORY.ACTIVITY.BY_WEEKDAY')}
                </h4>
                <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
                  {weekdayStats.map((stat) => (
                    <li
                      key={stat.weekday}
                      className="grid grid-cols-[2.75rem_minmax(0,1fr)_4rem] items-center gap-2 text-[0.7rem]"
                    >
                      <span className="truncate text-muted-foreground">{stat.name}</span>
                      <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full transition-[width] duration-500"
                          style={{
                            width: `${weekdayMax > 0 ? (stat.value / weekdayMax) * 100 : 0}%`,
                            background: 'var(--cg-level-3)',
                          }}
                        />
                      </span>
                      <span className="text-right tabular-nums">
                        {stat.days > 0 ? formatValue(stat.value) : '-'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <ContributionGraphFooter className="border-t pt-3 text-[0.7rem] text-muted-foreground">
            {hasPartial && (
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="inline-block size-2.5 rounded-[3px] border border-dashed border-muted-foreground/70"
                />
                {t('METRICS_HISTORY.ACTIVITY.PARTIAL_HINT')}
              </span>
            )}
            <ContributionGraphLegend />
          </ContributionGraphFooter>
        </ContributionGraph>
      </CardContent>
    </Card>
  );
};
