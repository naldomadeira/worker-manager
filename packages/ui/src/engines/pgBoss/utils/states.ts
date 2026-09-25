import type { PgBossJobState, PgBossStateCounts } from '@worker-manager/api/typings/app';
import type { TFunction } from 'i18next';
import { formatNumber } from '../../../components/MetricsSummary/formatNumber';
import { statusTone, type StatusTone } from '../../../components/StatusTone/statusTone';
import type { PgBossJobCommand } from '../services/PgBossApi';

/** pg-boss's own states, in its enum order: `created < retry < active < completed < ...`. */
export const PGBOSS_STATES = [
  'created',
  'retry',
  'active',
  'completed',
  'cancelled',
  'failed',
] as const satisfies readonly PgBossJobState[];

const STATE_KEYS = {
  created: 'PGBOSS.STATE.CREATED',
  retry: 'PGBOSS.STATE.RETRY',
  active: 'PGBOSS.STATE.ACTIVE',
  completed: 'PGBOSS.STATE.COMPLETED',
  cancelled: 'PGBOSS.STATE.CANCELLED',
  failed: 'PGBOSS.STATE.FAILED',
} as const satisfies Record<PgBossJobState, string>;

export function stateLabel(state: PgBossJobState, t: TFunction): string {
  return t(STATE_KEYS[state]);
}

/**
 * The board's colours for pg-boss's states. `created` is BullMQ's `waiting`; `retry` and
 * `cancelled` have tones of their own; the rest share the BullMQ status of the same name.
 */
const STATE_TONES: Record<PgBossJobState, string> = {
  created: 'waiting',
  retry: 'retry',
  active: 'active',
  completed: 'completed',
  cancelled: 'cancelled',
  failed: 'failed',
};

export function stateTone(state: PgBossJobState): StatusTone {
  return statusTone(STATE_TONES[state]);
}

/** The status-tab key a state is drawn with, so its dot takes the state's colour. */
export function stateToneKey(state: PgBossJobState): string {
  return STATE_TONES[state];
}

/** The same rules the server applies before each single-job command. */
const COMMAND_STATES: Record<PgBossJobCommand, readonly PgBossJobState[]> = {
  retry: ['failed'],
  cancel: ['created', 'retry', 'active'],
  resume: ['cancelled'],
  delete: ['created', 'retry', 'completed', 'cancelled', 'failed'],
};

/** Duplicating makes sense for a job someone might want to run again, per pg-boss's dashboard. */
const DUPLICABLE_STATES: readonly PgBossJobState[] = ['created', 'completed', 'failed'];

export function commandsFor(state: PgBossJobState): PgBossJobCommand[] {
  return (Object.keys(COMMAND_STATES) as PgBossJobCommand[]).filter((command) =>
    COMMAND_STATES[command].includes(state)
  );
}

export function canDuplicate(state: PgBossJobState): boolean {
  return DUPLICABLE_STATES.includes(state);
}

export function parseState(value: string | null | undefined): PgBossJobState | undefined {
  return (PGBOSS_STATES as readonly string[]).includes(value ?? '')
    ? (value as PgBossJobState)
    : undefined;
}

/**
 * A live state count as a tab shows it: the number, `cap+` past the cap, `?` when counting
 * timed out. Undefined while the counts have not arrived.
 */
export function countLabel(
  counts: PgBossStateCounts | null,
  state: PgBossJobState,
  cap: number | null,
  t: TFunction,
  locale: string
): { count?: number; label?: string; title?: string } {
  const entry = counts?.[state];
  if (!entry) return {};
  if (entry.count === null) {
    return { count: 1, label: t('PGBOSS.COUNT.UNKNOWN'), title: t('PGBOSS.COUNT.TIMEOUT') };
  }
  if (entry.capped && cap !== null) {
    return {
      count: entry.count,
      label: t('PGBOSS.COUNT.CAPPED', { cap: formatNumber(cap, locale) }),
      title: t('PGBOSS.COUNT.CAPPED_HINT', { cap: formatNumber(cap, locale) }),
    };
  }
  return { count: entry.count, label: formatNumber(entry.count, locale) };
}
