import { useQuery } from '@tanstack/react-query';
import { DATASTORES } from '@worker-manager/api/constants/datastores';
import { DatabaseIcon, type LucideIcon, ServerIcon } from 'lucide-react';
import formatBytes from 'pretty-bytes';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { queryKeys } from '../../hooks/queryKeys';
import { useApi } from '../../hooks/useApi';
import { Modal } from '../Modal/Modal';

const getMemoryUsage = (used?: number, total?: number) => {
  if (used === undefined) {
    return '-';
  }

  if (total === undefined) {
    return formatBytes(used);
  }

  return `${((used / total) * 100).toFixed(2)}%`;
};

/** How each datastore presents itself at the top of the panel. Brand names stay untranslated. */
const DATASTORE_LOOK: Record<DATASTORES, { name: string; icon: LucideIcon; tint: string }> = {
  [DATASTORES.redis]: {
    name: 'Redis',
    icon: ServerIcon,
    tint: 'bg-destructive/10 text-destructive',
  },
  [DATASTORES.postgres]: {
    name: 'PostgreSQL',
    icon: DatabaseIcon,
    tint: 'bg-chart-2/15 text-chart-2',
  },
};

interface StatItem {
  title: string;
  value: ReactNode;
  wide?: boolean;
}

export interface RedisStatsModalProps {
  open: boolean;

  onClose(): void;
}

export const RedisStatsModal = ({ open, onClose }: RedisStatsModalProps) => {
  const { t, i18n } = useTranslation();
  const api = useApi();

  const { data: stats } = useQuery({
    queryKey: queryKeys.redisStats,
    queryFn: () => api.getStats(),
    enabled: open,
    refetchInterval: 5000,
  });

  if (!stats) {
    return null;
  }

  // A server older than the PostgreSQL support sends no `backend`, and could only be Redis.
  const isPostgres = stats.backend === DATASTORES.postgres;
  const look = DATASTORE_LOOK[isPostgres ? DATASTORES.postgres : DATASTORES.redis];
  const DatastoreIcon = look.icon;

  const uptime = (() => {
    const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' });
    const seconds = stats.uptime;
    if (seconds < 60) return rtf.format(-Math.round(seconds), 'second').replace(/ ago$/, '');
    const minutes = seconds / 60;
    if (minutes < 60) return rtf.format(-Math.round(minutes), 'minute').replace(/ ago$/, '');
    const hours = minutes / 60;
    if (hours < 24) return rtf.format(-Math.round(hours), 'hour').replace(/ ago$/, '');
    return rtf.format(-Math.round(hours / 24), 'day').replace(/ ago$/, '');
  })();

  const memory = stats.memory;
  const memoryPercent =
    memory?.used !== undefined && memory?.total ? (memory.used / memory.total) * 100 : undefined;

  // PostgreSQL has no answer for memory usage or replication mode, so those rows are dropped
  // rather than filled with a number that means something else.
  const items: StatItem[] = [
    ...(memory
      ? [
          { title: t('REDIS.PEEK_MEMORY'), value: formatBytes(memory.peak) },
          { title: t('REDIS.FRAGMENTATION_RATIO'), value: memory.fragmentationRatio },
        ]
      : []),
    { title: t('REDIS.CONNECTED_CLIENTS'), value: stats.clients.connected },
    { title: t('REDIS.BLOCKED_CLIENTS'), value: stats.clients.blocked },
    { title: t('REDIS.VERSION'), value: stats.version },
    ...(stats.mode ? [{ title: t('REDIS.MODE'), value: stats.mode }] : []),
    ...(isPostgres ? [{ title: t('REDIS.PORT'), value: stats.port }] : []),
    { title: t('REDIS.UP_TIME'), value: uptime },
    ...(stats.os ? [{ title: t('REDIS.OS'), value: stats.os, wide: true }] : []),
  ];

  return (
    <Modal
      width="small"
      open={open}
      onClose={onClose}
      title={isPostgres ? t('REDIS.TITLE_POSTGRES') : t('REDIS.TITLE')}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
          <div className={cn('grid size-10 shrink-0 place-items-center rounded-lg', look.tint)}>
            <DatastoreIcon aria-hidden="true" className="size-5" />
          </div>
          <span className="flex-1 text-base font-semibold tracking-tight text-foreground">
            {look.name}
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              aria-hidden="true"
              className="size-1.5 animate-pulse-ring rounded-full bg-status-completed text-status-completed"
            />
            {t('REDIS.LIVE')}
          </span>
        </div>

        {memory && (
          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-muted-foreground">{t('REDIS.MEMORY_USAGE')}</span>
              <span className="font-mono text-base font-semibold text-foreground tabular-nums">
                {getMemoryUsage(memory.used, memory.total)}
              </span>
            </div>
            {memoryPercent !== undefined && (
              <Progress
                value={Math.min(memoryPercent, 100)}
                className={cn(
                  'h-1.5',
                  memoryPercent >= 90
                    ? '*:data-[slot=progress-indicator]:bg-destructive'
                    : memoryPercent >= 70
                      ? '*:data-[slot=progress-indicator]:bg-status-delayed'
                      : '*:data-[slot=progress-indicator]:bg-status-completed'
                )}
              />
            )}
            {memory.total && memory.used ? (
              <small className="text-xs text-muted-foreground tabular-nums">
                {t('REDIS.MEMORY_USED_OF', {
                  used: formatBytes(memory.used),
                  total: formatBytes(memory.total),
                })}
              </small>
            ) : (
              <small className="text-xs text-destructive">{t('REDIS.ERROR.MEMORY_USAGE')}</small>
            )}
          </div>
        )}

        <dl className="m-0 grid grid-cols-2 gap-2">
          {items.map((item) => (
            <div
              key={item.title}
              className={cn(
                'flex min-w-0 flex-col gap-1 rounded-lg border bg-card p-3',
                item.wide && 'col-span-2'
              )}
            >
              <dt className="text-xs text-muted-foreground">{item.title}</dt>
              <dd className="m-0 truncate font-mono text-sm font-medium text-foreground tabular-nums">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Modal>
  );
};
