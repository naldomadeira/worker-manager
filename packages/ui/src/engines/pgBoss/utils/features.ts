import type { PgBossFeature } from '@worker-manager/api/typings/app';
import type { TFunction } from 'i18next';

const FEATURE_KEYS = {
  queueCounters: 'PGBOSS.FEATURE.QUEUE_COUNTERS',
  readyHistory: 'PGBOSS.FEATURE.READY_HISTORY',
  schedules: 'PGBOSS.FEATURE.SCHEDULES',
  scheduleKind: 'PGBOSS.FEATURE.SCHEDULE_KIND',
  dependencies: 'PGBOSS.FEATURE.DEPENDENCIES',
  deadLetterSource: 'PGBOSS.FEATURE.DEAD_LETTER_SOURCE',
  queueDepth: 'PGBOSS.FEATURE.QUEUE_DEPTH',
  warnings: 'PGBOSS.FEATURE.WARNINGS',
} as const satisfies Record<PgBossFeature, string>;

export function featureLabel(feature: PgBossFeature, t: TFunction): string {
  return t(FEATURE_KEYS[feature]);
}

/** "a, b and c" in the reader's language; a plain comma list where Intl cannot. */
export function joinList(items: string[], locale: string): string {
  try {
    return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items);
  } catch {
    return items.join(', ');
  }
}
