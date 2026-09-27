import type { TFunction } from 'i18next';

/** The warning types pg-boss 12 writes. A newer one shows under its own name. */
export const PGBOSS_WARNING_TYPES = [
  'slow_query',
  'queue_backlog',
  'index_bloat',
  'xmin_horizon',
  'autovacuum_disabled',
  'monitor_backoff',
  'clock_skew',
  'invalid_schedule',
] as const;

const TYPE_KEYS = {
  slow_query: 'PGBOSS.WARNINGS.TYPE.SLOW_QUERY',
  queue_backlog: 'PGBOSS.WARNINGS.TYPE.QUEUE_BACKLOG',
  index_bloat: 'PGBOSS.WARNINGS.TYPE.INDEX_BLOAT',
  xmin_horizon: 'PGBOSS.WARNINGS.TYPE.XMIN_HORIZON',
  autovacuum_disabled: 'PGBOSS.WARNINGS.TYPE.AUTOVACUUM_DISABLED',
  monitor_backoff: 'PGBOSS.WARNINGS.TYPE.MONITOR_BACKOFF',
  clock_skew: 'PGBOSS.WARNINGS.TYPE.CLOCK_SKEW',
  invalid_schedule: 'PGBOSS.WARNINGS.TYPE.INVALID_SCHEDULE',
} as const satisfies Record<(typeof PGBOSS_WARNING_TYPES)[number], string>;

export function warningTypeLabel(type: string, t: TFunction): string {
  const key = TYPE_KEYS[type as keyof typeof TYPE_KEYS];
  return key ? t(key) : type;
}

/** The tone a warning type is drawn in: a backlog is the queue's problem, the rest the database's. */
export function warningTone(type: string): 'failed' | 'delayed' {
  return type === 'queue_backlog' || type === 'invalid_schedule' || type === 'slow_query'
    ? 'delayed'
    : 'failed';
}
