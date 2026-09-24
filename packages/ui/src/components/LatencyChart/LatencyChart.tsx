import type { MetricsHistoryGranularity } from '@worker-manager/api/typings/app';
import { Fragment, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TooltipContentProps } from 'recharts';
import { useHistoryMetrics } from '../../hooks/useHistoryMetrics';
import { useLatencyMetrics } from '../../hooks/useLatencyMetrics';
import { useSettingsStore } from '../../hooks/useSettings';
import { isPartialBucket } from '../../utils/partialBucket';
import {
  CHART_AXIS_TICK,
  CHART_CURSOR,
  CHART_GRID,
  ChartContainer,
  ChartIndicator,
  ChartLegend,
  ChartTooltipCard,
  ChartTooltipItem,
  ChartTooltipNote,
  ChartTooltipSeparator,
  chartActiveDot,
  useChartAnimation,
} from '../ChartContainer/ChartContainer';
import {
  clampLatencyRowsToLogFloor,
  computeLatencyAxisDomain,
  computeLogTicks,
  confidenceOpacity,
  formatDuration,
  LOW_CONFIDENCE_THRESHOLD,
  PERCENTILES,
  toLatencyRows,
  withPartialLatencyTail,
} from './latencySeries';
import type { LatencyRow, LatencySeriesKey } from './latencySeries';

export interface LatencyChartProps {
  queue?: string;
  from: number;
  to: number;
  granularity: MetricsHistoryGranularity;
  /** Namespaces the gradient <linearGradient> ids so multiple charts on one page do not collide. */
  idPrefix: string;
  height?: number;
}

/**
 * Hue carries the metric (run vs wait), line weight carries the percentile rank: p50 thinnest,
 * p99 heaviest. Each ramp's colour also runs from pale/low-contrast (p50) to dark/high-contrast
 * (p99), so severity reads even when weight alone is hard to judge at a glance. See theme.css
 * for the --latency-* custom properties and why light/dark ramp in opposite directions.
 *
 * `as const` so each `labelKey` keeps its literal type: `t()` is typed against the en-US key
 * union, and a widened `string` would fail that check.
 */
const LATENCY_SERIES_META = [
  {
    key: 'runP50',
    group: 'run',
    labelKey: 'LATENCY.RUN_P50',
    shortLabelKey: 'LATENCY.P50',
    colorVar: '--latency-run-p50',
    strokeWidth: 1.25,
    countKey: 'runCount',
  },
  {
    key: 'runP95',
    group: 'run',
    labelKey: 'LATENCY.RUN_P95',
    shortLabelKey: 'LATENCY.P95',
    colorVar: '--latency-run-p95',
    strokeWidth: 2,
    countKey: 'runCount',
  },
  {
    key: 'runP99',
    group: 'run',
    labelKey: 'LATENCY.RUN_P99',
    shortLabelKey: 'LATENCY.P99',
    colorVar: '--latency-run-p99',
    strokeWidth: 2.75,
    countKey: 'runCount',
  },
  {
    key: 'waitP50',
    group: 'wait',
    labelKey: 'LATENCY.WAIT_P50',
    shortLabelKey: 'LATENCY.P50',
    colorVar: '--latency-wait-p50',
    strokeWidth: 1.25,
    countKey: 'waitCount',
  },
  {
    key: 'waitP95',
    group: 'wait',
    labelKey: 'LATENCY.WAIT_P95',
    shortLabelKey: 'LATENCY.P95',
    colorVar: '--latency-wait-p95',
    strokeWidth: 2,
    countKey: 'waitCount',
  },
  {
    key: 'waitP99',
    group: 'wait',
    labelKey: 'LATENCY.WAIT_P99',
    shortLabelKey: 'LATENCY.P99',
    colorVar: '--latency-wait-p99',
    strokeWidth: 2.75,
    countKey: 'waitCount',
  },
] as const satisfies ReadonlyArray<{
  key: LatencySeriesKey;
  group: 'run' | 'wait';
  labelKey: string;
  /** Bare percentile shown in the legend button itself: the group label right next to it
   *  ("RUN"/"WAIT") already names the metric, so repeating it per item ("Run p50") was the
   *  redundancy that pushed the legend to two rows at the widths these charts actually get. */
  shortLabelKey: string;
  colorVar: string;
  strokeWidth: number;
  countKey: 'runCount' | 'waitCount';
}>;

/** Draw thinnest-to-boldest and back-to-front, across both metrics, so p99 always sits on top
 *  of p95 which sits on top of p50 regardless of which metric it belongs to. */
const PLOT_ORDER = [...LATENCY_SERIES_META].sort((a, b) => a.strokeWidth - b.strokeWidth);

export const LatencyChart = ({
  queue,
  from,
  to,
  granularity,
  idPrefix,
  height = 180,
}: LatencyChartProps) => {
  const { t } = useTranslation();
  const enabledSeries = useSettingsStore((state) => state.latencyChartSeries);
  const setSettings = useSettingsStore((state) => state.setSettings);
  const animation = useChartAnimation();

  const toggleSeries = (key: LatencySeriesKey) => {
    setSettings({
      latencyChartSeries: enabledSeries.includes(key)
        ? enabledSeries.filter((k) => k !== key)
        : [...enabledSeries, key],
    });
  };

  const { points: runPoints, loading: runLoading } = useLatencyMetrics({
    queue,
    metric: 'runtime',
    from,
    to,
    granularity,
    percentiles: PERCENTILES,
  });

  const { points: waitPoints, loading: waitLoading } = useLatencyMetrics({
    queue,
    metric: 'waittime',
    from,
    to,
    granularity,
    percentiles: PERCENTILES,
  });

  // Queue age is not a percentile of finished jobs, it is a live gauge of the oldest job still
  // sitting in the queue right now. That is precisely the signal a completion-derived histogram
  // misses once a queue backs up and stops finishing jobs.
  const { points: queueAgePoints, loading: queueAgeLoading } = useHistoryMetrics({
    queue,
    from,
    to,
    granularity,
    metric: 'queueage',
  });

  // Reused to tell "no latency recorded yet" apart from "this queue completes no jobs": both
  // look identical from the latency endpoint alone (zero points either way).
  const { completed, loading: completedLoading } = useHistoryMetrics({
    queue,
    from,
    to,
    granularity,
  });

  const rows = useMemo(
    () => toLatencyRows(runPoints, waitPoints, queueAgePoints),
    [runPoints, waitPoints, queueAgePoints]
  );

  // Latency is log-distributed: p99 can be two orders of magnitude above p50, which crushes
  // the faster percentiles flat against the bottom of a linear axis. A log axis fixes that,
  // but log(0) is undefined and a data set with no spread collapses a log domain to nothing,
  // so both the domain and the plotted rows fall back to linear when the data can't support it.
  // Only the currently-enabled series feed the domain, so hiding every run-time line lets the
  // axis re-fit around whatever is still visible.
  const axisDomain = useMemo(
    () => computeLatencyAxisDomain(rows, enabledSeries),
    [rows, enabledSeries]
  );
  const isLogAxis = axisDomain.scale === 'log';
  const chartRows = useMemo(
    () => (isLogAxis ? clampLatencyRowsToLogFloor(rows) : rows),
    [rows, isLogAxis]
  );
  const logTicks = useMemo(
    () =>
      isLogAxis &&
      typeof axisDomain.domain[0] === 'number' &&
      typeof axisDomain.domain[1] === 'number'
        ? computeLogTicks(axisDomain.domain[0], axisDomain.domain[1])
        : [],
    [isLogAxis, axisDomain]
  );

  // The last bucket of the current period (today, this hour) only covers however much of it
  // has elapsed so far. Plotted like every complete prior bucket it reads as a cliff, so its
  // closing segment is split off and drawn dashed instead -- see withPartialLatencyTail.
  const isLastPartial = useMemo(
    () => chartRows.length > 0 && isPartialBucket(chartRows[chartRows.length - 1].x, granularity),
    [chartRows, granularity]
  );
  const plotRows = useMemo(
    () => withPartialLatencyTail(chartRows, isLastPartial),
    [chartRows, isLastPartial]
  );

  const loading = runLoading || waitLoading || queueAgeLoading || completedLoading;
  const hasCompletions = completed.some((point) => point.value > 0);

  const formatXTick = (x: number) =>
    granularity === 'hour'
      ? new Date(x).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      : new Date(x).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  const formatTooltipLabel = (x: number) =>
    granularity === 'hour' ? new Date(x).toLocaleString() : new Date(x).toLocaleDateString();

  const gradientStops = (countKey: 'runCount' | 'waitCount') =>
    chartRows.map((row, i) => ({
      offset: chartRows.length > 1 ? (i / (chartRows.length - 1)) * 100 : 100,
      opacity: confidenceOpacity(row[countKey] ?? 0),
    }));

  const isQueueAgeEnabled = enabledSeries.includes('queueAge');
  const visibleSeries = LATENCY_SERIES_META.filter((meta) => enabledSeries.includes(meta.key));

  const renderTooltip = ({ active, payload }: TooltipContentProps) => {
    if (!active || !payload || payload.length === 0) {
      return null;
    }
    const row = payload[0].payload as LatencyRow;
    // A partial point's own duration fields were moved to their `Tail` counterpart by
    // withPartialLatencyTail so the solid line stops short of it; read through to find the
    // value that's still there to display.
    const isPartialPoint = isLastPartial && row.x === chartRows[chartRows.length - 1]?.x;
    const queueAgeValue = row.queueAge ?? row.queueAgeTail;

    return (
      <ChartTooltipCard label={formatTooltipLabel(row.x)}>
        {(['run', 'wait'] as const).map((group) => {
          const groupSeries = visibleSeries.filter((meta) => meta.group === group);
          if (groupSeries.length === 0) {
            return null;
          }
          const count = group === 'run' ? row.runCount : row.waitCount;
          const showLowConfidence =
            count !== undefined && count > 0 && count < LOW_CONFIDENCE_THRESHOLD;

          return (
            <Fragment key={group}>
              {groupSeries.map(({ key, colorVar, labelKey }) => {
                const value = row[key] ?? row[`${key}Tail`];
                if (value === undefined) {
                  return null;
                }
                return (
                  <ChartTooltipItem
                    key={key}
                    color={`var(${colorVar})`}
                    name={t(labelKey)}
                    value={formatDuration(value)}
                  />
                );
              })}
              {showLowConfidence && (
                <ChartTooltipNote>{t('LATENCY.LOW_CONFIDENCE', { count })}</ChartTooltipNote>
              )}
            </Fragment>
          );
        })}
        {isQueueAgeEnabled && queueAgeValue !== undefined && (
          <>
            <ChartTooltipSeparator />
            <ChartTooltipItem
              color="var(--status-delayed)"
              variant="dashed"
              name={t('LATENCY.QUEUE_AGE')}
              value={formatDuration(queueAgeValue)}
            />
          </>
        )}
        {isPartialPoint && <ChartTooltipNote>{t('METRICS.PARTIAL_PERIOD')}</ChartTooltipNote>}
      </ChartTooltipCard>
    );
  };

  if (loading) {
    return null;
  }

  // Real buttons, not divs with onClick, so every series toggle is keyboard reachable. A
  // toggled-off series stays legible (it's still clickable) but visibly recedes.
  const legendButtonClass =
    'inline-flex h-6 items-center gap-1.5 rounded-full border border-transparent px-2 text-xs text-muted-foreground transition-[color,background-color,border-color,opacity] outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:border-border aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs data-[enabled=false]:opacity-55 dark:aria-pressed:bg-input/30';

  const legendGroup = (
    group: 'run' | 'wait',
    labelKey: 'LATENCY.GROUP_RUN' | 'LATENCY.GROUP_WAIT'
  ) => (
    <div className="flex flex-wrap items-center gap-1">
      {/* Reinforces hue = metric with a text label too, so the grouping doesn't rely on colour
          alone. */}
      <span className="mr-0.5 text-[0.68rem] font-semibold tracking-wide text-muted-foreground uppercase">
        {t(labelKey)}
      </span>
      {LATENCY_SERIES_META.filter((meta) => meta.group === group).map(
        ({ key, colorVar, labelKey: seriesLabelKey, shortLabelKey, strokeWidth }) => {
          const enabled = enabledSeries.includes(key);
          return (
            <button
              type="button"
              key={key}
              className={legendButtonClass}
              aria-pressed={enabled}
              aria-label={t(seriesLabelKey)}
              data-enabled={enabled}
              onClick={() => toggleSeries(key)}
            >
              {/* Line-weight swatch: its height mirrors the series' actual stroke width, so
                  the legend teaches the "heavier line = higher percentile" encoding. */}
              <ChartIndicator color={`var(${colorVar})`} variant="line" thickness={strokeWidth} />
              {t(shortLabelKey)}
            </button>
          );
        }
      )}
    </div>
  );

  const visiblePlotOrder = PLOT_ORDER.filter((meta) => enabledSeries.includes(meta.key));

  return (
    <ChartContainer>
      {/* No title here: the card header one level up carries "Job latency" while this tab is
          active (see MetricsHeader), so repeating it here would put the words on screen twice. */}
      {rows.length > 0 && (
        <ChartLegend className="gap-x-4">
          {legendGroup('run', 'LATENCY.GROUP_RUN')}
          {legendGroup('wait', 'LATENCY.GROUP_WAIT')}
          <button
            type="button"
            className={legendButtonClass}
            aria-pressed={isQueueAgeEnabled}
            data-enabled={isQueueAgeEnabled}
            onClick={() => toggleSeries('queueAge')}
          >
            {/* A hollow dashed square, never a filled bar, so queue age never reads as a
                fourth percentile alongside the solid run/wait weight ramps. */}
            <ChartIndicator color="var(--status-delayed)" variant="dashed" />
            {t('LATENCY.QUEUE_AGE')}
          </button>
          {/* Qualifies the whole Y axis, not any one series. An unlabelled log axis reads as
              far flatter than the underlying change. */}
          {isLogAxis && (
            <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[0.68rem] text-muted-foreground italic">
              {t('LATENCY.LOG_SCALE_NOTE')}
            </span>
          )}
        </ChartLegend>
      )}

      {rows.length === 0 ? (
        <p className="m-0 py-6 text-center text-sm text-muted-foreground">
          {t(hasCompletions ? 'LATENCY.EMPTY_NO_DATA' : 'LATENCY.EMPTY_NO_COMPLETIONS')}
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={plotRows} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <defs>
              {visibleSeries.map(({ key, colorVar, countKey }) => (
                <linearGradient key={key} id={`${idPrefix}-${key}`} x1="0" y1="0" x2="1" y2="0">
                  {gradientStops(countKey).map((stop, i) => (
                    <stop
                      key={i}
                      offset={`${stop.offset}%`}
                      stopColor={`var(${colorVar})`}
                      stopOpacity={stop.opacity}
                    />
                  ))}
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid {...CHART_GRID} />
            <XAxis
              dataKey="x"
              tick={CHART_AXIS_TICK}
              tickMargin={10}
              minTickGap={48}
              axisLine={false}
              tickLine={false}
              tickFormatter={formatXTick}
            />
            <YAxis
              width={48}
              tick={CHART_AXIS_TICK}
              axisLine={false}
              tickLine={false}
              scale={isLogAxis ? 'log' : 'linear'}
              domain={axisDomain.domain}
              ticks={isLogAxis ? logTicks : undefined}
              allowDataOverflow={isLogAxis}
              tickFormatter={formatDuration}
            />
            <Tooltip content={renderTooltip} cursor={CHART_CURSOR} isAnimationActive={false} />
            {visiblePlotOrder.map(({ key, colorVar, strokeWidth }) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={`url(#${idPrefix}-${key})`}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                dot={false}
                activeDot={chartActiveDot(`var(${colorVar})`)}
                connectNulls={false}
                {...animation}
              />
            ))}
            {isQueueAgeEnabled && (
              <Line
                type="monotone"
                dataKey="queueAge"
                stroke="var(--status-delayed)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                activeDot={chartActiveDot('var(--status-delayed)')}
                connectNulls={false}
                {...animation}
              />
            )}
            {/* The closing segment of an in-progress bucket, redrawn dashed. Its data only
                covers the last two points (see withPartialLatencyTail), picking up exactly
                where each solid line above stops. */}
            {isLastPartial &&
              visiblePlotOrder.map(({ key, colorVar, strokeWidth }) => (
                <Line
                  key={`${key}-tail`}
                  type="monotone"
                  dataKey={`${key}Tail`}
                  stroke={`url(#${idPrefix}-${key})`}
                  strokeWidth={strokeWidth}
                  strokeDasharray="4 3"
                  dot={false}
                  activeDot={chartActiveDot(`var(${colorVar})`)}
                  connectNulls={false}
                  {...animation}
                />
              ))}
            {isQueueAgeEnabled && isLastPartial && (
              <Line
                type="monotone"
                dataKey="queueAgeTail"
                stroke="var(--status-delayed)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                activeDot={chartActiveDot('var(--status-delayed)')}
                connectNulls={false}
                {...animation}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartContainer>
  );
};
