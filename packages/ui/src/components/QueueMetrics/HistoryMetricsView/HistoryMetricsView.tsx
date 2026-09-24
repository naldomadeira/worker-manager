import { useTranslation } from 'react-i18next';
import { useHistoryMetrics } from '../../../hooks/useHistoryMetrics';
import { useLatencyMetrics } from '../../../hooks/useLatencyMetrics';
import { useRangeWindow } from '../../../hooks/useRangeWindow';
import { useSettingsStore } from '../../../hooks/useSettings';
import { useUIConfig } from '../../../hooks/useUIConfig';
import { isPartialBucket } from '../../../utils/partialBucket';
import { LatencyChart } from '../../LatencyChart/LatencyChart';
import { formatDuration } from '../../LatencyChart/latencySeries';
import { MetricsChartPane } from '../../MetricsChartTabs/MetricsChartTabs';
import { halfOverHalfTrend } from '../../MetricsSummary/formatNumber';
import { MetricsSummary, StatTile } from '../../MetricsSummary/MetricsSummary';
import { ThroughputAreaChart } from '../../ThroughputAreaChart/ThroughputAreaChart';
import { sum, toHistoryRows } from '../../ThroughputAreaChart/throughputSeries';
import type { Range } from '../QueueMetrics';

const RANGE_DAYS: Record<Exclude<Range, '60m'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

/** Tile totals only ever need the range's overall p95, never a per-bucket series. */
const P95 = [95];

interface HistoryMetricsViewProps {
  queueName: string;
  range: Range;
}

export const HistoryMetricsView = ({ queueName, range }: HistoryMetricsViewProps) => {
  const { t } = useTranslation();
  const { hasLatencyHistory = false } = useUIConfig();
  const activeTab = useSettingsStore((state) => state.metricsChartTab);

  const { from, to } = useRangeWindow(range, RANGE_DAYS[range as Exclude<Range, '60m'>]);

  const { completed, failed, loading } = useHistoryMetrics({
    queue: queueName,
    from,
    to,
    granularity: 'day',
  });

  // Only fetched while the latency tab is actually showing, matching the by-queue table's
  // p95 column: same mechanism (granularity: 'range', percentiles: [95]), same reason to skip
  // it when the tiles that would show it are not on screen.
  const showLatencyTiles = hasLatencyHistory && activeTab === 'latency';

  const { points: runP95Points } = useLatencyMetrics({
    queue: queueName,
    metric: 'runtime',
    from,
    to,
    granularity: 'range',
    percentiles: P95,
    enabled: showLatencyTiles,
  });
  const { points: waitP95Points } = useLatencyMetrics({
    queue: queueName,
    metric: 'waittime',
    from,
    to,
    granularity: 'range',
    percentiles: P95,
    enabled: showLatencyTiles,
  });

  const rows = toHistoryRows(completed, failed);

  if (rows.length === 0) {
    return <p className="m-0 py-2 text-sm text-muted-foreground">{t('METRICS.HISTORY_EMPTY')}</p>;
  }

  if (loading) {
    return null;
  }

  const dailyCompletedTotal = sum(rows.map((row) => row.completed));
  const dailyFailedTotal = sum(rows.map((row) => row.failed));
  const isLastPartial = isPartialBucket(rows[rows.length - 1].x, 'day');
  const completedTrend = halfOverHalfTrend(
    rows.map((row) => row.completed),
    isLastPartial
  );
  const failedTrend = halfOverHalfTrend(
    rows.map((row) => row.failed),
    isLastPartial
  );
  const p95RunTime = runP95Points[0]?.values['95'];
  const p95WaitTime = waitP95Points[0]?.values['95'];

  return (
    <>
      {showLatencyTiles ? (
        <MetricsSummary>
          <StatTile
            value={
              p95RunTime !== undefined ? formatDuration(p95RunTime) : t('METRICS.NOT_AVAILABLE')
            }
            label={t('METRICS.P95_RUN_TIME')}
            dotColor="var(--latency-run-p95)"
          />
          <StatTile
            value={
              p95WaitTime !== undefined ? formatDuration(p95WaitTime) : t('METRICS.NOT_AVAILABLE')
            }
            label={t('METRICS.P95_WAIT_TIME')}
            dotColor="var(--latency-wait-p95)"
          />
        </MetricsSummary>
      ) : (
        <MetricsSummary>
          <StatTile
            value={dailyCompletedTotal}
            label={t('METRICS.DAILY_COMPLETED')}
            dotColor="var(--status-completed)"
            trend={completedTrend}
          />
          <StatTile
            value={dailyFailedTotal}
            label={t('METRICS.DAILY_FAILED')}
            dotColor="var(--status-failed)"
            trend={failedTrend}
            trendPolarity="up-is-bad"
          />
        </MetricsSummary>
      )}

      <MetricsChartPane
        throughput={
          <ThroughputAreaChart
            idPrefix="queue-history"
            data={rows}
            height={180}
            showAxis
            granularity="day"
            formatXTick={(x) =>
              new Date(x).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
            }
            formatTooltipLabel={(row) => new Date(row.x).toLocaleDateString()}
          />
        }
        latency={
          hasLatencyHistory ? (
            <LatencyChart
              queue={queueName}
              from={from}
              to={to}
              granularity="day"
              idPrefix="queue-latency"
            />
          ) : undefined
        }
      />
    </>
  );
};
