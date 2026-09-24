import type { AppQueue, Status } from '@worker-manager/api/typings/app';
import {
  ActivityIcon,
  CircleCheckIcon,
  CircleXIcon,
  HourglassIcon,
  LayersIcon,
  type LucideIcon,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { AnimatedNumber } from '../../components/AnimatedNumber/AnimatedNumber';
import { useSearchParams } from '../../hooks/useSearchParams';
import { dynamicTranslationKey } from '../../utils/dynamicTranslationKey';
import { links } from '../../utils/links';

type KpiStatus = Extract<Status, 'active' | 'waiting' | 'failed' | 'completed'>;

interface KpiTile {
  id: 'queues' | KpiStatus;
  label: string;
  value: number;
  hint: string;
  icon: LucideIcon;
  /** Icon chip colours; static strings so Tailwind can see them. */
  tint: string;
  to: ReturnType<typeof links.dashboardPage>;
  selected: boolean;
  alert?: boolean;
  pulse?: boolean;
}

const STATUS_TILES: { status: KpiStatus; icon: LucideIcon; tint: string }[] = [
  { status: 'active', icon: ActivityIcon, tint: 'bg-status-active/15 text-status-active' },
  { status: 'waiting', icon: HourglassIcon, tint: 'bg-status-waiting/15 text-status-waiting' },
  { status: 'failed', icon: CircleXIcon, tint: 'bg-status-failed/15 text-status-failed' },
  {
    status: 'completed',
    icon: CircleCheckIcon,
    tint: 'bg-status-completed/15 text-status-completed',
  },
];

/** Board-wide totals, summed only over the statuses each queue actually reports. */
function summarise(queues: AppQueue[]) {
  const byStatus: Record<KpiStatus, number> = { active: 0, waiting: 0, failed: 0, completed: 0 };
  let totalJobs = 0;
  let paused = 0;

  for (const queue of queues) {
    if (queue.isPaused) paused += 1;
    for (const status of queue.statuses) {
      const count = queue.counts[status] || 0;
      totalJobs += count;
      if (status in byStatus) byStatus[status as KpiStatus] += count;
    }
  }

  return { byStatus, totalJobs, paused };
}

export const OverviewKpisSkeleton = () => (
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
    {Array.from({ length: 5 }, (_, index) => (
      <div
        key={index}
        className={cn(
          'flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10',
          index === 0 && 'max-sm:col-span-2'
        )}
      >
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-7 w-16" />
        <Skeleton className="h-3 w-24" />
      </div>
    ))}
  </div>
);

export const OverviewKpis = ({ queues }: { queues: AppQueue[] }) => {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const { status: selectedStatus } = useSearchParams();
  const { byStatus, totalJobs, paused } = useMemo(() => summarise(queues), [queues]);

  const share = (value: number) =>
    t('DASHBOARD.KPI.SHARE', {
      percent: totalJobs > 0 ? Math.round((value / totalJobs) * 100) : 0,
    });

  const tiles: KpiTile[] = [
    {
      id: 'queues',
      label: t('DASHBOARD.KPI.QUEUES'),
      value: queues.length,
      hint:
        paused > 0 ? t('DASHBOARD.KPI.PAUSED', { count: paused }) : t('DASHBOARD.KPI.ALL_RUNNING'),
      icon: LayersIcon,
      tint: 'bg-primary/10 text-primary',
      to: links.dashboardPage(),
      selected: !selectedStatus,
    },
    ...STATUS_TILES.map(({ status, icon, tint }) => ({
      id: status,
      label: t(dynamicTranslationKey(`QUEUE.STATUS.${status.toUpperCase()}`)),
      value: byStatus[status],
      hint: share(byStatus[status]),
      icon,
      tint,
      to: links.dashboardPage(status),
      selected: selectedStatus === status,
      alert: status === 'failed' && byStatus.failed > 0,
      pulse: status === 'active' && byStatus.active > 0,
    })),
  ];

  return (
    <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((tile, index) => {
        const Icon = tile.icon;
        return (
          <motion.li
            key={tile.id}
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: index * 0.05, ease: [0.16, 1, 0.3, 1] }}
            className={cn(index === 0 && 'max-sm:col-span-2')}
          >
            <Link
              to={tile.to}
              aria-current={tile.selected ? 'page' : undefined}
              className={cn(
                'group/kpi relative flex h-full flex-col gap-2 overflow-hidden rounded-xl bg-card p-4 text-card-foreground no-underline shadow-xs ring-1 ring-foreground/10',
                'transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-md hover:ring-foreground/20 motion-reduce:hover:translate-y-0',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                tile.selected && 'ring-2 ring-primary/40 hover:ring-primary/50',
                tile.alert && !tile.selected && 'ring-status-failed/35 hover:ring-status-failed/50'
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
