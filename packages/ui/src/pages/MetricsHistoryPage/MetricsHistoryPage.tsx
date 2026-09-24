import { ChartArea, Database, EllipsisVertical, Inbox } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LatencyChart } from '../../components/LatencyChart/LatencyChart';
import { formatDuration } from '../../components/LatencyChart/latencySeries';
import { Loader } from '../../components/Loader/Loader';
import {
  MetricsChartPane,
  MetricsChartTabSelector,
} from '../../components/MetricsChartTabs/MetricsChartTabs';
import { halfOverHalfTrend } from '../../components/MetricsSummary/formatNumber';
import { MetricsSummary, StatTile } from '../../components/MetricsSummary/MetricsSummary';
import { RangeSelector } from '../../components/RangeSelector/RangeSelector';
import { ThroughputAreaChart } from '../../components/ThroughputAreaChart/ThroughputAreaChart';
import { sum, toHistoryRows } from '../../components/ThroughputAreaChart/throughputSeries';
import { useHistoryMetrics } from '../../hooks/useHistoryMetrics';
import { useLatencyMetrics } from '../../hooks/useLatencyMetrics';
import { useModal } from '../../hooks/useModal';
import { useQueues } from '../../hooks/useQueues';
import { useRangeWindow } from '../../hooks/useRangeWindow';
import { useSettingsStore } from '../../hooks/useSettings';
import { useUIConfig } from '../../hooks/useUIConfig';
import { isPartialBucket } from '../../utils/partialBucket';
import { DailyActivityCard } from './DailyActivityCard';
import { HistoryStorageModal } from './HistoryStorageModal';
import { QueueThroughputRow, QueueTotals } from './QueueThroughputRow';

type Range = '7d' | '30d' | '90d';

const RANGES: Range[] = ['7d', '30d', '90d'];

const RANGE_LABEL_KEYS: Record<
  Range,
  'METRICS_HISTORY.RANGE_7D' | 'METRICS_HISTORY.RANGE_30D' | 'METRICS_HISTORY.RANGE_90D'
> = {
  '7d': 'METRICS_HISTORY.RANGE_7D',
  '30d': 'METRICS_HISTORY.RANGE_30D',
  '90d': 'METRICS_HISTORY.RANGE_90D',
};

const RANGE_DAYS: Record<Range, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

/** Tile totals only ever need the range's overall p95, never a per-bucket series. */
const P95 = [95];

export const MetricsHistoryPage = () => {
  const { t } = useTranslation();
  const { hasHistoryUsage, hasLatencyHistory = false } = useUIConfig();
  const modal = useModal<'storage'>();
  const [range, setRange] = useState<Range>('7d');
  const activeTab = useSettingsStore((state) => state.metricsChartTab);

  const { from, to } = useRangeWindow(range, RANGE_DAYS[range]);

  const { completed, failed, loading } = useHistoryMetrics({ from, to, granularity: 'day' });

  // Only fetched while the latency tab is actually showing, matching the by-queue table's p95
  // column: same mechanism (granularity: 'range', percentiles: [95]), same reason to skip it
  // when the tiles that would show it are not on screen.
  const showLatencyTiles = hasLatencyHistory && activeTab === 'latency';

  const { points: runP95Points } = useLatencyMetrics({
    metric: 'runtime',
    from,
    to,
    granularity: 'range',
    percentiles: P95,
    enabled: showLatencyTiles,
  });
  const { points: waitP95Points } = useLatencyMetrics({
    metric: 'waittime',
    from,
    to,
    granularity: 'range',
    percentiles: P95,
    enabled: showLatencyTiles,
  });
  const p95RunTime = runP95Points[0]?.values['95'];
  const p95WaitTime = waitP95Points[0]?.values['95'];

  const rows = toHistoryRows(completed, failed);

  const totalCompleted = sum(rows.map((row) => row.completed));
  const totalFailed = sum(rows.map((row) => row.failed));
  const isLastPartial = rows.length > 0 && isPartialBucket(rows[rows.length - 1].x, 'day');
  const completedTrend = halfOverHalfTrend(
    rows.map((row) => row.completed),
    isLastPartial
  );
  const failedTrend = halfOverHalfTrend(
    rows.map((row) => row.failed),
    isLastPartial
  );

  const { queues } = useQueues();
  const [queueTotals, setQueueTotals] = useState<Record<string, QueueTotals>>({});

  useEffect(() => {
    setQueueTotals({});
  }, [range]);

  const handleQueueTotals = useCallback((queueName: string, totals: QueueTotals) => {
    setQueueTotals((prev) => {
      const existing = prev[queueName];
      if (
        existing &&
        existing.completed === totals.completed &&
        existing.failed === totals.failed
      ) {
        return prev;
      }
      return { ...prev, [queueName]: totals };
    });
  }, []);

  const runs = (totals: QueueTotals) => totals.completed + totals.failed;

  const maxQueueRuns = Math.max(0, ...Object.values(queueTotals).map(runs));

  const sortedQueueNames = (queues ?? [])
    .map((queue) => queue.name)
    .sort((a, b) => {
      const totalA = queueTotals[a];
      const totalB = queueTotals[b];
      if (!totalA && !totalB) {
        return a.localeCompare(b);
      }
      if (!totalA) {
        return 1;
      }
      if (!totalB) {
        return -1;
      }
      return runs(totalB) - runs(totalA);
    });

  const headCell = 'h-9 text-[0.68rem] font-semibold tracking-wide text-muted-foreground uppercase';

  return (
    <section className="flex max-w-[1600px] flex-col gap-4 pt-1">
      <Card className="gap-5 shadow-xs animate-fade-in-up">
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15">
              <ChartArea className="size-4.5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <CardTitle>
                <h2 className="m-0 text-lg leading-tight font-semibold tracking-tight">
                  {t('METRICS_HISTORY.TITLE')}
                </h2>
              </CardTitle>
              <CardDescription className="text-xs">{t('METRICS_HISTORY.SUBTITLE')}</CardDescription>
            </div>
          </div>
          <CardAction className="flex flex-wrap items-center gap-2">
            {hasLatencyHistory && <MetricsChartTabSelector />}
            <RangeSelector
              ranges={RANGES}
              value={range}
              onChange={setRange}
              getLabel={(r) => t(RANGE_LABEL_KEYS[r])}
            />
            {/* Storage is an occasional maintenance task, so it lives behind the menu
                rather than competing with the range selector for attention. */}
            {hasHistoryUsage && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={t('METRICS_HISTORY.ACTIONS')}>
                    <EllipsisVertical />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => modal.open('storage')}>
                    <Database />
                    {t('METRICS_HISTORY.STORAGE.TITLE')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </CardAction>
        </CardHeader>

        <CardContent className="flex flex-col gap-5">
          {loading && rows.length === 0 ? (
            <Loader />
          ) : rows.length === 0 ? (
            <Empty className="border py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Inbox />
                </EmptyMedia>
                <EmptyDescription>{t('METRICS_HISTORY.EMPTY')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : showLatencyTiles ? (
            <MetricsSummary key="latency">
              <StatTile
                value={
                  p95RunTime !== undefined
                    ? formatDuration(p95RunTime)
                    : t('METRICS_HISTORY.NOT_AVAILABLE')
                }
                label={t('METRICS_HISTORY.P95_RUN_TIME')}
                dotColor="var(--latency-run-p95)"
                valueClassName="text-3xl"
              />
              <StatTile
                value={
                  p95WaitTime !== undefined
                    ? formatDuration(p95WaitTime)
                    : t('METRICS_HISTORY.NOT_AVAILABLE')
                }
                label={t('METRICS_HISTORY.P95_WAIT_TIME')}
                dotColor="var(--latency-wait-p95)"
                valueClassName="text-3xl"
              />
            </MetricsSummary>
          ) : (
            <MetricsSummary key="throughput">
              <StatTile
                value={totalCompleted}
                label={t('METRICS_HISTORY.TOTAL_COMPLETED')}
                dotColor="var(--status-completed)"
                valueClassName="text-3xl"
                trend={completedTrend}
              />
              <StatTile
                value={totalFailed}
                label={t('METRICS_HISTORY.TOTAL_FAILED')}
                dotColor="var(--status-failed)"
                valueClassName="text-3xl"
                trend={failedTrend}
                trendPolarity="up-is-bad"
              />
            </MetricsSummary>
          )}

          <MetricsChartPane
            throughput={
              rows.length > 0 ? (
                <ThroughputAreaChart
                  idPrefix="global-history"
                  data={rows}
                  height={280}
                  showAxis
                  granularity="day"
                  formatXTick={(x) =>
                    new Date(x).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                  }
                  formatTooltipLabel={(row) => new Date(row.x).toLocaleDateString()}
                />
              ) : undefined
            }
            latency={
              hasLatencyHistory ? (
                <LatencyChart
                  from={from}
                  to={to}
                  granularity="day"
                  idPrefix="global-latency"
                  height={280}
                />
              ) : undefined
            }
          />
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <DailyActivityCard
          rows={rows}
          days={RANGE_DAYS[range]}
          className="gap-4 shadow-xs animate-fade-in-up [animation-delay:40ms]"
        />
      )}

      {sortedQueueNames.length > 0 && (
        <Card className="gap-0 py-0 shadow-xs animate-fade-in-up [animation-delay:80ms]">
          <CardHeader className="border-b py-3.5">
            <CardTitle>
              <h3 className="m-0 text-sm font-semibold">{t('METRICS_HISTORY.BY_QUEUE')}</h3>
            </CardTitle>
          </CardHeader>
          <TooltipProvider>
            <Table className="min-w-[760px]">
              <TableHeader className="bg-muted/40">
                <TableRow className="hover:bg-transparent">
                  <TableHead className={`${headCell} pl-4`}>{t('METRICS_HISTORY.QUEUE')}</TableHead>
                  <TableHead className={headCell}>{t('METRICS_HISTORY.TREND')}</TableHead>
                  <TableHead className={headCell}>{t('METRICS_HISTORY.RUNS')}</TableHead>
                  <TableHead className={`${headCell} text-right`}>
                    {t('METRICS_HISTORY.COMPLETED')}
                  </TableHead>
                  {/* Padded by the rate slot beside the counts, so the label sits over the
                      counts rather than the rate. */}
                  <TableHead className={`${headCell} pr-18 text-right`}>
                    {t('METRICS_HISTORY.FAILED')}
                  </TableHead>
                  {hasLatencyHistory && (
                    <TableHead className={`${headCell} pr-4 text-right`}>
                      {t('METRICS_HISTORY.P95_RUNTIME')}
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedQueueNames.map((queueName, index) => (
                  <QueueThroughputRow
                    key={queueName}
                    index={index}
                    queueName={queueName}
                    from={from}
                    to={to}
                    maxTotal={maxQueueRuns}
                    onTotals={handleQueueTotals}
                    hasLatencyHistory={hasLatencyHistory}
                  />
                ))}
              </TableBody>
            </Table>
          </TooltipProvider>
        </Card>
      )}

      {modal.isMounted('storage') && (
        <HistoryStorageModal
          open={modal.isOpen('storage')}
          from={from}
          rangeLabel={t(RANGE_LABEL_KEYS[range])}
          onClose={modal.close('storage')}
        />
      )}
    </section>
  );
};
