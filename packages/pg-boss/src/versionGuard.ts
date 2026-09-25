import type { TranslatableMessage } from '@worker-manager/api/typings/app';
import type { Reader } from './connection';
import type { Statements } from './sql';

/**
 * The pg-boss schema versions whose tables the read queries are written against. 35 is
 * pg-boss 12.24.0, the first with `queue_stats` and `ready_history`; 42 is 12.33.0 through at
 * least 12.34.0. Columns added inside the range are probed, not assumed.
 */
export const SCHEMA_MIN = 35;
export const SCHEMA_MAX = 42;

export interface SchemaState {
  installed: boolean;
  version: number | null;
  readable: boolean;
  unavailableReason: TranslatableMessage | null;
  /** `schedule.kind` and `schedule.last_job_id`, schema 41 and later. */
  scheduleKindColumns: boolean;
}

export async function probeSchema(
  reader: Reader,
  statements: Statements,
  schema: string
): Promise<SchemaState> {
  const [{ installed }] = await reader.query(statements.installed, [`"${schema}".version`]);
  if (!installed) {
    return {
      installed: false,
      version: null,
      readable: false,
      unavailableReason: { key: 'ERRORS.PGBOSS_NOT_INSTALLED' },
      scheduleKindColumns: false,
    };
  }

  const [row] = await reader.query(statements.version);
  const version = row ? Number(row.version) : null;
  const supported = version !== null && version >= SCHEMA_MIN && version <= SCHEMA_MAX;
  const [{ found }] = await reader.query(statements.scheduleColumns, [schema]);

  return {
    installed: true,
    version,
    readable: supported,
    unavailableReason: supported
      ? null
      : {
          key: 'ERRORS.PGBOSS_SCHEMA_UNSUPPORTED',
          options: { found: version, min: SCHEMA_MIN, max: SCHEMA_MAX },
        },
    scheduleKindColumns: found === 2,
  };
}

/**
 * Why a writer on schema `writerVersion` must not touch a database on `state.version`, or null.
 * pg-boss's own `start()` refuses anything but an exact match, and its SQL names columns of its
 * own version, so an unstarted writer is held to the same rule.
 */
export function writeRefusal(
  state: SchemaState,
  writerVersion: number | null | undefined
): TranslatableMessage | null {
  if (!state.readable) {
    return state.unavailableReason;
  }
  if (writerVersion === undefined) {
    return null;
  }
  if (writerVersion === null) {
    return { key: 'ERRORS.PGBOSS_WRITER_UNAVAILABLE' };
  }
  return writerVersion === state.version
    ? null
    : {
        key: 'ERRORS.PGBOSS_SCHEMA_MISMATCH',
        options: { found: state.version, expected: writerVersion },
      };
}
