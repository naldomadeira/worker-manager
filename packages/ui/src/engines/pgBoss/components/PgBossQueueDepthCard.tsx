import type { PgBossInfo, PgBossQueueDepthPoint } from '@worker-manager/api/typings/app';
import { ChartLineIcon, DatabaseZapIcon, Inbox } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  CHART_AXIS_TICK,
  CHART_CURSOR,
  CHART_GRID,
  ChartContainer,
  ChartLegend,
  ChartLegendItem,
  ChartTooltipCard,
  ChartTooltipItem,
  chartActiveDot,
  useChartAnimation,
} from '../../../components/ChartContainer/ChartContainer';
import { formatNumber } from '../../../components/MetricsSummary/formatNumber';
import { RangeSelector } from '../../../components/RangeSelector/RangeSelector';
import { usePgBossQueueDepth } from '../hooks/usePgBossQueueDepth';
import type { PgBossDepthRange } from '../services/PgBossApi';

const RANGES = ['1h', '6h', '24h', '7d'] as const satisfies readonly PgBossDepthRange[];

const RANGE_KEYS = {
  '1h': 'PGBOSS.DEPTH.RANGE_1H',
  '6h': 'PGBOSS.DEPTH.RANGE_6H',
  '24h': 'PGBOSS.DEPTH.RANGE_24H',
  '7d': 'PGBOSS.DEPTH.RANGE_7D',
} as const satisfies Record<PgBossDepthRange, string>;

/** The series drawn, in the colours the board gives the matching job states. */
const SERIES = [
  { key: 'ready', color: 'var(--status-waiting)', label: 'PGBOSS.KPI.READY' },
  { key: 'deferred', color: 'var(--status-delayed)', label: 'PGBOSS.KPI.DEFERRED' },
  { key: 'active', color: 'var(--status-active)', label: 'PGBOSS.KPI.ACTIVE' },
  { key: 'failed', color: 'var(--status-failed)', label: 'PGBOSS.KPI.FAILED' },
] as const satisfies readonly {
  key: keyof PgBossQueueDepthPoint;
  color: string;
  label: string;
}[];

const compact = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k` : String(value);

const HEIGHT = 200;

/**
 * A queue's backlog over time, from the snapshots pg-boss's monitor writes to `queue_stats`.
 * Each point is the highest value seen in its bucket, so a short spike is never averaged away.
 */
export const PgBossQueueDepthCard = ({
  queueName,
  info,
}: {
  queueName: string;
  info: PgBossInfo | null;
}) => {
  const { t, i18n } = useTranslation();
  const animation = useChartAnimation();
  const [range, setRange] = useState<PgBossDepthRange>('24h');
  const available = !!info?.features.queueDepth;
  const persisted = !!info?.persistQueueStats;
  const { depth, loading, isTransitioning, error } = usePgBossQueueDepth(
    queueName,
    range,
    available && persisted
  );

  if (!info || !info.readable) {
    return null;
  }

  const points = depth?.points ?? [];
  const spanDays = range === '7d';
  // A week gets one tick per local midnight, so no date shows twice.
  const dayTicks = (() => {
    if (!spanDays || !depth) return undefined;
    const ticks: number[] = [];
    const day = new Date(depth.from);
    day.setHours(24, 0, 0, 0);
    while (day.getTime() <= depth.to) {
      ticks.push(day.getTime());
      day.setDate(day.getDate() + 1);
    }
    return ticks;
  })();
  const formatTick = (ts: number) =>
    new Intl.DateTimeFormat(
      i18n.language,
      spanDays ? { month: 'short', day: 'numeric' } : { hour: '2-digit', minute: '2-digit' }
    ).format(ts);
  const formatLabel = (ts: number) =>
    new Intl.DateTimeFormat(i18n.language, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(ts);

  const renderTooltip = ({ active, payload }: TooltipContentProps) => {
    if (!active || !payload?.length) return null;
    const point = payload[0].payload as PgBossQueueDepthPoint;
    return (
      <ChartTooltipCard label={formatLabel(point.ts)}>
        {SERIES.map(({ key, color, label }) => (
          <ChartTooltipItem
            key={key}
            color={color}
            name={t(label)}
            value={formatNumber(point[key], i18n.language)}
          />
        ))}
      </ChartTooltipCard>
    );
  };

  const empty = (icon: ReactNode, title: string, hint?: string) => (
    <Empty className="border py-8">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle className="text-sm font-normal text-muted-foreground">{title}</EmptyTitle>
        {hint && <EmptyDescription className="text-xs">{hint}</EmptyDescription>}
      </EmptyHeader>
    </Empty>
  );

  const renderBody = () => {
    if (!available) {
      return empty(<DatabaseZapIcon />, t('PGBOSS.DEPTH.DISABLED'));
    }
    if (!persisted) {
      return empty(<Inbox />, t('PGBOSS.DEPTH.NEVER'), t('PGBOSS.DEPTH.NEVER_HINT'));
    }
    if (loading && !depth) {
      return (
        <Skeleton
          data-testid="pgboss-depth-skeleton"
          className="w-full"
          style={{ height: HEIGHT }}
        />
      );
    }
    if (error && !depth) {
      return empty(<DatabaseZapIcon />, t('PGBOSS.DEPTH.LOAD_ERROR'));
    }
    if (points.length === 0) {
      return empty(<Inbox />, t('PGBOSS.DEPTH.EMPTY'), t('PGBOSS.DEPTH.NEVER_HINT'));
    }
    return (
      <ChartContainer
        aria-busy={isTransitioning || undefined}
        className={cn('transition-opacity', isTransitioning && 'opacity-60')}
      >
        <ChartLegend>
          {SERIES.map(({ key, color, label }) => (
            <ChartLegendItem key={key} color={color} variant="line">
              {t(label)}
            </ChartLegendItem>
          ))}
        </ChartLegend>
        <ResponsiveContainer width="100%" height={HEIGHT}>
          <LineChart data={points} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid {...CHART_GRID} />
            <XAxis
              dataKey="ts"
              type="number"
              scale="time"
              domain={[depth?.from ?? 'dataMin', depth?.to ?? 'dataMax']}
              tick={CHART_AXIS_TICK}
              tickMargin={10}
              minTickGap={48}
              axisLine={false}
              tickLine={false}
              tickFormatter={formatTick}
              ticks={dayTicks}
            />
            <YAxis
              width={44}
              tick={CHART_AXIS_TICK}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
              domain={[0, 'dataMax']}
              tickFormatter={compact}
            />
            <Tooltip content={renderTooltip} cursor={CHART_CURSOR} isAnimationActive={false} />
            {SERIES.map(({ key, color }) => (
              <Line
                key={key}
                dataKey={key}
                type="monotone"
                stroke={color}
                strokeWidth={2}
                dot={false}
                activeDot={chartActiveDot(color)}
                {...animation}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </ChartContainer>
    );
  };

  return (
    <Card data-testid="pgboss-depth-card" className="gap-4 shadow-xs animate-fade-in-up">
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15">
            <ChartLineIcon className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <CardTitle>
              <h2 className="m-0 text-sm leading-tight font-semibold tracking-tight">
                {t('PGBOSS.DEPTH.TITLE')}
              </h2>
            </CardTitle>
            <CardDescription className="text-xs">{t('PGBOSS.DEPTH.DESCRIPTION')}</CardDescription>
          </div>
        </div>
        {available && persisted && (
          <CardAction>
            <RangeSelector
              ranges={RANGES}
              value={range}
              onChange={setRange}
              getLabel={(value) => t(RANGE_KEYS[value])}
              aria-label={t('PGBOSS.DEPTH.RANGE_LABEL')}
            />
          </CardAction>
        )}
      </CardHeader>
      <CardContent>{renderBody()}</CardContent>
    </Card>
  );
};
