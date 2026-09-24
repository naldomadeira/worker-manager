import type { MetricsHistoryGranularity } from '@worker-manager/api/typings/app';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TooltipContentProps } from 'recharts';
import { isPartialBucket } from '../../utils/partialBucket';
import {
  CHART_AXIS_TICK,
  CHART_CURSOR,
  CHART_GRID,
  ChartContainer,
  ChartLegend,
  ChartLegendItem,
  ChartTooltipCard,
  ChartTooltipItem,
  ChartTooltipNote,
  chartActiveDot,
  useChartAnimation,
} from '../ChartContainer/ChartContainer';
import { withPartialThroughputTail } from './throughputSeries';
import type { ThroughputPlotRow, ThroughputRow } from './throughputSeries';

export interface ThroughputAreaChartProps {
  data: ThroughputRow[];
  /** Namespaces the gradient <linearGradient> ids so multiple charts on one page do not collide. */
  idPrefix: string;
  height?: number;
  /** Formats the tooltip's top label line from a row (e.g. "3 minutes ago" or a date). */
  formatTooltipLabel: (row: ThroughputRow) => string;
  /** Optional unit shown after each tooltip value (e.g. "/min"). Omit for daily counts. */
  valueUnit?: string;
  /** Show horizontal gridlines and X/Y axis ticks. Off by default to keep compact charts clean. */
  showAxis?: boolean;
  /** Formats the X axis ticks (only when showAxis). */
  formatXTick?: (x: number) => string;
  /** `data`'s bucket period, so the chart can tell a still-forming bucket (today, this hour)
   *  apart from a complete one and draw its closing segment dashed. Omit for series that
   *  aren't calendar buckets, e.g. the native 60-minute view's per-minute index. */
  granularity?: MetricsHistoryGranularity;
}

const COMPLETED_COLOR = 'var(--status-completed)';
const FAILED_COLOR = 'var(--status-failed)';

const compactNumber = (value: number): string => {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  }
  return String(value);
};

export const ThroughputAreaChart = ({
  data,
  idPrefix,
  height = 140,
  formatTooltipLabel,
  valueUnit,
  showAxis = false,
  formatXTick,
  granularity,
}: ThroughputAreaChartProps) => {
  const { t, i18n } = useTranslation();
  const animation = useChartAnimation();
  const completedGradientId = `${idPrefix}-completed`;
  const failedGradientId = `${idPrefix}-failed`;

  // See LatencyChart for the same treatment: the last bucket of the current period only
  // covers however much of it has elapsed so far, so its closing segment is split off and
  // drawn dashed instead of cliffing next to complete prior buckets.
  const lastRow = data[data.length - 1];
  const isLastPartial = Boolean(granularity && lastRow && isPartialBucket(lastRow.x, granularity));
  const plotData = useMemo(
    () => withPartialThroughputTail(data, isLastPartial),
    [data, isLastPartial]
  );

  const formatCount = (value: number) => {
    try {
      return value.toLocaleString(i18n.language);
    } catch {
      return value.toLocaleString();
    }
  };

  const renderTooltip = ({ active, payload }: TooltipContentProps) => {
    if (!active || !payload || payload.length === 0) {
      return null;
    }
    const point = payload[0].payload as ThroughputPlotRow;
    // A partial point's own completed/failed were moved to their `Tail` counterpart by
    // withPartialThroughputTail so the solid area stops short of it; read through to find the
    // value that's still there to display.
    const row: ThroughputRow = {
      x: point.x,
      completed: point.completed ?? point.completedTail ?? 0,
      failed: point.failed ?? point.failedTail ?? 0,
    };
    const isPartialPoint = isLastPartial && point.x === lastRow?.x;

    return (
      <ChartTooltipCard label={formatTooltipLabel(row)}>
        <ChartTooltipItem
          color={COMPLETED_COLOR}
          name={t('METRICS.COMPLETED')}
          value={formatCount(row.completed)}
          unit={valueUnit}
        />
        <ChartTooltipItem
          color={FAILED_COLOR}
          name={t('METRICS.FAILED')}
          value={formatCount(row.failed)}
          unit={valueUnit}
        />
        {isPartialPoint && <ChartTooltipNote>{t('METRICS.PARTIAL_PERIOD')}</ChartTooltipNote>}
      </ChartTooltipCard>
    );
  };

  const areaProps = (color: string, gradientId: string) => ({
    type: 'monotone' as const,
    stroke: color,
    strokeWidth: 2,
    fill: `url(#${gradientId})`,
    dot: false,
    activeDot: chartActiveDot(color),
    connectNulls: false,
    ...animation,
  });

  return (
    <ChartContainer>
      {/* Static swatches, not toggles -- there is nothing to hide behind them, unlike the
          latency legend's per-percentile buttons. Mirrors LatencyChart's legend position so
          throughput and latency read as one consistent layout. */}
      {data.length > 0 && (
        <ChartLegend>
          <ChartLegendItem color={COMPLETED_COLOR}>{t('METRICS.COMPLETED')}</ChartLegendItem>
          <ChartLegendItem color={FAILED_COLOR}>{t('METRICS.FAILED')}</ChartLegendItem>
        </ChartLegend>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart
          data={plotData}
          margin={
            showAxis
              ? { top: 8, right: 8, bottom: 4, left: 0 }
              : { top: 8, right: 4, bottom: 0, left: 4 }
          }
        >
          <defs>
            <linearGradient id={completedGradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COMPLETED_COLOR} stopOpacity={0.4} />
              <stop offset="60%" stopColor={COMPLETED_COLOR} stopOpacity={0.12} />
              <stop offset="100%" stopColor={COMPLETED_COLOR} stopOpacity={0} />
            </linearGradient>
            <linearGradient id={failedGradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={FAILED_COLOR} stopOpacity={0.4} />
              <stop offset="60%" stopColor={FAILED_COLOR} stopOpacity={0.12} />
              <stop offset="100%" stopColor={FAILED_COLOR} stopOpacity={0} />
            </linearGradient>
          </defs>
          {showAxis ? <CartesianGrid {...CHART_GRID} /> : null}
          {showAxis ? (
            <XAxis
              dataKey="x"
              tick={CHART_AXIS_TICK}
              tickMargin={10}
              minTickGap={48}
              axisLine={false}
              tickLine={false}
              tickFormatter={formatXTick}
            />
          ) : (
            <XAxis dataKey="x" hide />
          )}
          {showAxis ? (
            <YAxis
              width={44}
              tick={CHART_AXIS_TICK}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
              domain={[0, 'dataMax']}
              tickFormatter={compactNumber}
            />
          ) : (
            <YAxis hide domain={[0, 'dataMax']} />
          )}
          <Tooltip content={renderTooltip} cursor={CHART_CURSOR} isAnimationActive={false} />
          <Area dataKey="completed" {...areaProps(COMPLETED_COLOR, completedGradientId)} />
          <Area dataKey="failed" {...areaProps(FAILED_COLOR, failedGradientId)} />
          {isLastPartial && (
            <>
              {/* The closing segment of an in-progress bucket, redrawn dashed. Its data only
                covers the last two points (see withPartialThroughputTail), picking up exactly
                where each solid area above stops. */}
              <Area
                dataKey="completedTail"
                strokeDasharray="4 3"
                {...areaProps(COMPLETED_COLOR, completedGradientId)}
              />
              <Area
                dataKey="failedTail"
                strokeDasharray="4 3"
                {...areaProps(FAILED_COLOR, failedGradientId)}
              />
            </>
          )}
        </AreaChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
};
