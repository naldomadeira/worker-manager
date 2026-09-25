import type { PgBossQueueSummary } from '@worker-manager/api/typings/app';
import {
  ActivityIcon,
  CircleXIcon,
  HourglassIcon,
  LayersIcon,
  type LucideIcon,
  TimerIcon,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { AnimatedNumber } from '../../../components/AnimatedNumber/AnimatedNumber';
import { formatNumber } from '../../../components/MetricsSummary/formatNumber';

/** What a KPI tile filters the overview's cards down to. */
export type PgBossOverviewFilter = 'ready' | 'deferred' | 'active' | 'failed';

export const OVERVIEW_FILTERS: readonly PgBossOverviewFilter[] = [
  'ready',
  'deferred',
  'active',
  'failed',
];

interface Tile {
  id: PgBossOverviewFilter | 'total';
  label: string;
  value: number;
  hint: string;
  icon: LucideIcon;
  tint: string;
  alert?: boolean;
  pulse?: boolean;
}

export function summarise(queues: PgBossQueueSummary[]) {
  const totals = { ready: 0, deferred: 0, active: 0, failed: 0, queued: 0, total: 0 };
  let backlogged = 0;
  for (const queue of queues) {
    totals.ready += queue.counts.ready;
    totals.deferred += queue.counts.deferred;
    totals.active += queue.counts.active;
    totals.failed += queue.counts.failed;
    totals.queued += queue.counts.queued;
    totals.total += queue.counts.total;
    if (queue.backlogged) backlogged += 1;
  }
  return { totals, backlogged };
}

/** Board-wide totals from pg-boss's cached counters, as tiles that filter the cards below. */
export const PgBossOverviewKpis = ({
  queues,
  filter,
  filterLink,
}: {
  queues: PgBossQueueSummary[];
  filter?: PgBossOverviewFilter;
  filterLink(filter?: PgBossOverviewFilter): { pathname: string; search: string };
}) => {
  const { t, i18n } = useTranslation();
  const reduceMotion = useReducedMotion();
  const { totals, backlogged } = useMemo(() => summarise(queues), [queues]);
  const share = (value: number) =>
    t('DASHBOARD.KPI.SHARE', {
      percent: totals.total > 0 ? Math.round((value / totals.total) * 100) : 0,
    });

  const tiles: Tile[] = [
    {
      id: 'ready',
      label: t('PGBOSS.KPI.READY'),
      value: totals.ready,
      hint: t('PGBOSS.KPI.QUEUED_HINT', { value: formatNumber(totals.queued, i18n.language) }),
      icon: HourglassIcon,
      tint: 'bg-status-waiting/15 text-status-waiting',
    },
    {
      id: 'deferred',
      label: t('PGBOSS.KPI.DEFERRED'),
      value: totals.deferred,
      hint: share(totals.deferred),
      icon: TimerIcon,
      tint: 'bg-status-delayed/15 text-status-delayed',
    },
    {
      id: 'active',
      label: t('PGBOSS.KPI.ACTIVE'),
      value: totals.active,
      hint: share(totals.active),
      icon: ActivityIcon,
      tint: 'bg-status-active/15 text-status-active',
      pulse: totals.active > 0,
    },
    {
      id: 'failed',
      label: t('PGBOSS.KPI.FAILED'),
      value: totals.failed,
      hint: share(totals.failed),
      icon: CircleXIcon,
      tint: 'bg-status-failed/15 text-status-failed',
      alert: totals.failed > 0,
    },
    {
      id: 'total',
      label: t('PGBOSS.KPI.TOTAL'),
      value: totals.total,
      hint:
        backlogged > 0
          ? t('PGBOSS.KPI.BACKLOGGED', { value: formatNumber(backlogged, i18n.language) })
          : t('PGBOSS.KPI.NONE_BACKLOGGED'),
      icon: LayersIcon,
      tint: 'bg-primary/10 text-primary',
    },
  ];

  return (
    <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((tile, index) => {
        const Icon = tile.icon;
        const selected = tile.id === 'total' ? !filter : filter === tile.id;
        const to = tile.id === 'total' ? filterLink() : filterLink(tile.id);
        return (
          <motion.li
            key={tile.id}
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: index * 0.05, ease: [0.16, 1, 0.3, 1] }}
            className={cn(index === 4 && 'max-sm:col-span-2')}
          >
            <Link
              to={to}
              aria-current={selected ? 'page' : undefined}
              className={cn(
                'group/kpi relative flex h-full flex-col gap-2 overflow-hidden rounded-xl bg-card p-4 text-card-foreground no-underline shadow-xs ring-1 ring-foreground/10',
                'transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-md hover:ring-foreground/20 motion-reduce:hover:translate-y-0',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                selected && 'ring-2 ring-primary/40 hover:ring-primary/50',
                tile.alert && !selected && 'ring-status-failed/35 hover:ring-status-failed/50'
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {tile.label}
                </span>
                <span
                  className={cn(
                    'grid size-7 shrink-0 place-items-center rounded-lg transition-transform duration-200 group-hover/kpi:scale-110 motion-reduce:group-hover/kpi:scale-100',
                    tile.tint,
                    tile.pulse && 'animate-pulse-ring'
                  )}
                >
                  <Icon aria-hidden="true" className="size-4" />
                </span>
              </span>
              <AnimatedNumber
                value={tile.value}
                className={cn(
                  'text-2xl leading-none font-semibold tracking-tight text-foreground',
                  tile.alert && 'text-status-failed'
                )}
              />
              <span className="truncate text-xs text-muted-foreground">{tile.hint}</span>
            </Link>
          </motion.li>
        );
      })}
    </ul>
  );
};
