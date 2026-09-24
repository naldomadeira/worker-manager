import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { TableCell, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatDuration } from '../../components/LatencyChart/latencySeries';
import { formatNumber } from '../../components/MetricsSummary/formatNumber';
import { Sparkline } from '../../components/Sparkline/Sparkline';
import { sum, toHistoryRows } from '../../components/ThroughputAreaChart/throughputSeries';
import { useHistoryMetrics } from '../../hooks/useHistoryMetrics';
import { useLatencyMetrics } from '../../hooks/useLatencyMetrics';

/** Percent of the track below which a non-zero segment would round away to nothing. */
const MIN_SEGMENT = 1;

const P95 = [95];

/** Rows fade up one after another, capped so a long list never waits on its last row. */
const STAGGER_MS = 35;
const MAX_STAGGER_MS = 420;

export interface QueueTotals {
  completed: number;
  failed: number;
}

export interface QueueThroughputRowProps {
  queueName: string;
  from: number;
  to: number;
  /** Runs of the busiest queue in the range; every bar is scaled against it. */
  maxTotal: number;
  onTotals: (queueName: string, totals: QueueTotals) => void;
  /** Adds the p95 run-time column, and fetches it, only when the board has a latency provider. */
  hasLatencyHistory: boolean;
  /** Position in the table, used only to stagger the entrance animation. */
  index?: number;
}

const Placeholder = () => (
  <span className="inline-block h-3 w-8 animate-pulse rounded bg-muted align-middle" aria-hidden />
);

export const QueueThroughputRow = ({
  queueName,
  from,
  to,
  maxTotal,
  onTotals,
  hasLatencyHistory,
  index = 0,
}: QueueThroughputRowProps) => {
  const { t, i18n } = useTranslation();
  const reduceMotion = useReducedMotion();
  const { completed, failed, loading } = useHistoryMetrics({
    queue: queueName,
    from,
    to,
    granularity: 'day',
  });

  const { points: latencyPoints, loading: latencyLoading } = useLatencyMetrics({
    queue: queueName,
    metric: 'runtime',
    from,
    to,
    granularity: 'range',
    percentiles: P95,
    enabled: hasLatencyHistory,
  });
  const p95Runtime = latencyPoints[0]?.values['95'];

  const totalCompleted = sum(completed.map((point) => point.value));
  const totalFailed = sum(failed.map((point) => point.value));
  const total = totalCompleted + totalFailed;

  const daily = useMemo(() => toHistoryRows(completed, failed), [completed, failed]);

  useEffect(() => {
    if (!loading) {
      onTotals(queueName, { completed: totalCompleted, failed: totalFailed });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueName, loading, totalCompleted, totalFailed]);

  const format = (value: number) => formatNumber(value, i18n.language);
  const formatRate = (rate: number): string => {
    if (rate > 0 && rate < 0.1) {
      return `<${formatNumber(0.1, i18n.language)}%`;
    }
    return `${formatNumber(rate, i18n.language, { maximumFractionDigits: 1 })}%`;
  };

  const scale = maxTotal > 0 ? 100 / maxTotal : 0;
  const segment = (value: number) => (value > 0 ? Math.max(value * scale, MIN_SEGMENT) : 0);
  const completedSegment = segment(totalCompleted);
  const failedSegment = segment(totalFailed);
  const failureRate = total > 0 ? (totalFailed / total) * 100 : 0;

  const barLabel = t('METRICS_HISTORY.BAR_LABEL', {
    completed: format(totalCompleted),
    failed: format(totalFailed),
  });

  const rowStyle: CSSProperties = {
    animationDelay: `${Math.min(index * STAGGER_MS, MAX_STAGGER_MS)}ms`,
  };

  return (
    <TableRow className="group/row animate-fade-in-up hover:bg-state-hover" style={rowStyle}>
      <TableCell className="w-full py-2.5 pl-4 font-medium text-foreground">{queueName}</TableCell>
      <TableCell className="py-2.5">
        {loading ? (
          <span className="block h-7 w-28 animate-pulse rounded-md bg-muted/70" aria-hidden />
        ) : (
          <Sparkline
            series={[
              {
                values: daily.map((row) => row.completed),
                color: 'var(--status-completed)',
                area: true,
              },
              { values: daily.map((row) => row.failed), color: 'var(--status-failed)' },
            ]}
          />
        )}
      </TableCell>
      <TableCell className="py-2.5">
        {loading ? (
          <span className="block h-2 w-48 rounded-full bg-muted" aria-hidden />
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              {/* Hidden from the accessibility tree, not labelled: the tooltip and the two
                  cells beside it already announce these numbers. */}
              <span
                className="relative block h-2 w-48 overflow-hidden rounded-full bg-muted ring-border transition-shadow group-hover/row:ring-1"
                aria-hidden="true"
              >
                {/* Full-width and scaled rather than sized, so a totals refresh stays on the
                    compositor instead of relaying out every row. */}
                <motion.span
                  className="absolute inset-0"
                  style={{ originX: 0 }}
                  initial={reduceMotion ? false : { scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                >
                  <span
                    className="absolute inset-0 origin-left rounded-full bg-status-completed transition-transform duration-300"
                    style={{ transform: `scaleX(${completedSegment / 100})` }}
                  />
                  <span
                    className="absolute inset-0 origin-left rounded-full bg-status-failed transition-transform duration-300"
                    style={{
                      transform: `translateX(${completedSegment}%) scaleX(${failedSegment / 100})`,
                    }}
                  />
                </motion.span>
              </span>
            </TooltipTrigger>
            <TooltipContent>{barLabel}</TooltipContent>
          </Tooltip>
        )}
      </TableCell>
      <TableCell className="py-2.5 text-right font-mono text-foreground tabular-nums">
        {loading ? <Placeholder /> : format(totalCompleted)}
      </TableCell>
      <TableCell className="py-2.5 text-right font-mono tabular-nums">
        <span className="inline-flex items-center justify-end gap-2">
          <span
            className={cn(
              totalFailed > 0 ? 'font-semibold text-status-failed' : 'text-muted-foreground'
            )}
          >
            {loading ? <Placeholder /> : format(totalFailed)}
          </span>
          {/* Always reserves its slot, so the counts line up down the column whether or not
              a row has failures. */}
          <span className="inline-flex w-14 justify-start">
            {totalFailed > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help rounded-full bg-status-failed/10 px-1.5 py-0.5 font-sans text-[0.68rem] font-medium text-status-failed">
                    {formatRate(failureRate)}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {t('METRICS_HISTORY.FAILURE_RATE', { rate: formatRate(failureRate) })}
                </TooltipContent>
              </Tooltip>
            )}
          </span>
        </span>
      </TableCell>
      {hasLatencyHistory && (
        <TableCell className="py-2.5 pr-4 text-right font-mono text-foreground tabular-nums">
          {latencyLoading ? (
            <Placeholder />
          ) : p95Runtime !== undefined ? (
            formatDuration(p95Runtime)
          ) : (
            <span className="text-muted-foreground">{t('METRICS_HISTORY.NOT_AVAILABLE')}</span>
          )}
        </TableCell>
      )}
    </TableRow>
  );
};
