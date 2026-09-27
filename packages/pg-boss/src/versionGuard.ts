import type {
  PgBossFeature,
  PgBossFeatures,
  TranslatableMessage,
} from '@worker-manager/api/typings/app';
import type { Reader } from './connection';
import type { SchemaColumns, Statements } from './sql';

/**
 * The pg-boss schema versions the read queries are tested against. 35 is pg-boss 12.24.0, the
 * first with `queue_stats` and `ready_history`; 42 is 12.33.0 through at least 12.34.0.
 *
 * Below the floor the board reads nothing. Above the ceiling it keeps reading: the tables and
 * columns are probed, whatever is still there is read, and what is gone is switched off. Writes
 * stay off above the ceiling unless the board sets `allowUntestedSchema`.
 */
export const SCHEMA_MIN = 35;
export const SCHEMA_MAX = 42;

/** The tables the board reads, probed in one `information_schema` query. */
export const PROBED_TABLES = [
  'queue',
  'job',
  'schedule',
  'job_dependency',
  'queue_stats',
  'warning',
] as const;

type Table = (typeof PROBED_TABLES)[number];
type Needs = readonly (readonly [Table, readonly string[]])[];

/**
 * What no read can do without. A schema missing any of these is not a pg-boss schema this
 * board can make sense of, whatever its version says.
 */
const REQUIRED: Needs = [
  ['queue', ['name', 'policy', 'created_on', 'updated_on']],
  ['job', ['id', 'name', 'state', 'created_on', 'start_after', 'singleton_key']],
];

/**
 * The optional parts, each with the schema version that introduced it. A part missing on a
 * schema older than its `since` is simply not there yet; one missing on a later schema was
 * taken away, and the board says so.
 */
const FEATURES: Record<PgBossFeature, { since: number; needs: Needs }> = {
  queueCounters: {
    since: 35,
    needs: [
      [
        'queue',
        [
          'deferred_count',
          'queued_count',
          'ready_count',
          'active_count',
          'failed_count',
          'total_count',
          'monitor_on',
        ],
      ],
    ],
  },
  readyHistory: { since: 35, needs: [['queue', ['ready_history']]] },
  schedules: {
    since: 35,
    needs: [
      [
        'schedule',
        ['name', 'key', 'cron', 'timezone', 'data', 'options', 'created_on', 'updated_on'],
      ],
    ],
  },
  scheduleKind: { since: 41, needs: [['schedule', ['kind', 'last_job_id']]] },
  dependencies: {
    since: 35,
    needs: [
      ['job_dependency', ['parent_name', 'parent_id', 'child_name', 'child_id']],
      ['job', ['blocked', 'blocking', 'pending_dependencies']],
    ],
  },
  deadLetterSource: {
    since: 35,
    needs: [['job', ['source_name', 'source_id', 'source_created_on', 'source_retry_count']]],
  },
  queueDepth: {
    since: 35,
    needs: [
      [
        'queue_stats',
        [
          'name',
          'captured_on',
          'deferred_count',
          'queued_count',
          'ready_count',
          'active_count',
          'failed_count',
          'total_count',
        ],
      ],
    ],
  },
  warnings: { since: 35, needs: [['warning', ['id', 'type', 'message', 'data', 'created_on']]] },
};

export interface SchemaState {
  installed: boolean;
  version: number | null;
  readable: boolean;
  /** Newer than {@link SCHEMA_MAX}: read by probing, written only when the board allows it. */
  untested: boolean;
  unavailableReason: TranslatableMessage | null;
  columns: SchemaColumns;
  features: PgBossFeatures;
  /** Features this version should have and this schema lacks. */
  disabledFeatures: PgBossFeature[];
}

const NO_COLUMNS: SchemaColumns = { has: () => false, hasTable: () => false };

const NO_FEATURES = Object.fromEntries(
  Object.keys(FEATURES).map((feature) => [feature, false])
) as PgBossFeatures;

function unreadable(
  installed: boolean,
  version: number | null,
  reason: TranslatableMessage
): SchemaState {
  return {
    installed,
    version,
    readable: false,
    untested: false,
    unavailableReason: reason,
    columns: NO_COLUMNS,
    features: NO_FEATURES,
    disabledFeatures: [],
  };
}

export function columnSet(rows: { table_name: string; column_name: string }[]): SchemaColumns {
  const tables = new Map<string, Set<string>>();
  for (const { table_name: table, column_name: column } of rows) {
    let columns = tables.get(table);
    if (!columns) tables.set(table, (columns = new Set()));
    columns.add(column);
  }
  return {
    has: (table, column) => !!tables.get(table)?.has(column),
    hasTable: (table) => tables.has(table),
  };
}

const satisfied = (columns: SchemaColumns, needs: Needs) =>
  needs.every(([table, list]) => list.every((column) => columns.has(table, column)));

const missingOf = (columns: SchemaColumns, needs: Needs) =>
  needs.flatMap(([table, list]) =>
    list.filter((column) => !columns.has(table, column)).map((column) => `${table}.${column}`)
  );

/**
 * What the board may read from a schema of `version` with these `columns`. Pure, so the specs
 * can drive it with any shape of schema.
 */
export function assessSchema(version: number | null, columns: SchemaColumns): SchemaState {
  if (version === null || version < SCHEMA_MIN) {
    return unreadable(true, version, {
      key: 'ERRORS.PGBOSS_SCHEMA_UNSUPPORTED',
      options: { found: version, min: SCHEMA_MIN, max: SCHEMA_MAX },
    });
  }

  const missing = missingOf(columns, REQUIRED);
  if (missing.length > 0) {
    return unreadable(true, version, {
      key: 'ERRORS.PGBOSS_SCHEMA_INCOMPATIBLE',
      options: { found: version, missing: missing.join(', ') },
    });
  }

  const features = Object.fromEntries(
    Object.entries(FEATURES).map(([feature, { needs }]) => [feature, satisfied(columns, needs)])
  ) as PgBossFeatures;
  const disabledFeatures = (Object.keys(FEATURES) as PgBossFeature[]).filter(
    (feature) => !features[feature] && version >= FEATURES[feature].since
  );

  return {
    installed: true,
    version,
    readable: true,
    untested: version > SCHEMA_MAX,
    unavailableReason: null,
    columns,
    features,
    disabledFeatures,
  };
}

/**
 * Probes the schema. The installation and the version are read every time; the columns only
 * when the version differs from the one `cache` holds them for, so on a steady database the
 * `information_schema` query runs once per board and again only after pg-boss migrates.
 */
export async function probeSchema(
  reader: Reader,
  statements: Statements,
  schema: string,
  cache: { version: number | null; columns: SchemaColumns } | null
): Promise<{
  state: SchemaState;
  cache: { version: number | null; columns: SchemaColumns } | null;
}> {
  const [{ installed }] = await reader.query(statements.installed, [`"${schema}".version`]);
  if (!installed) {
    return {
      state: unreadable(false, null, { key: 'ERRORS.PGBOSS_NOT_INSTALLED' }),
      cache: null,
    };
  }

  const [row] = await reader.query(statements.version);
  const version = row ? Number(row.version) : null;
  if (version === null || version < SCHEMA_MIN) {
    return { state: assessSchema(version, NO_COLUMNS), cache };
  }

  let columns = cache?.version === version ? cache.columns : null;
  if (!columns) {
    columns = columnSet(await reader.query(statements.columns, [schema, [...PROBED_TABLES]]));
  }
  return { state: assessSchema(version, columns), cache: { version, columns } };
}

/**
 * Why a writer on schema `writerVersion` must not touch a database on `state.version`, or null.
 * pg-boss's own `start()` refuses anything but an exact match, and its SQL names columns of its
 * own version, so an unstarted writer is held to the same rule. A schema newer than the board
 * is tested with is not written at all unless the board said `allowUntestedSchema`.
 */
export function writeRefusal(
  state: SchemaState,
  writerVersion: number | null | undefined,
  allowUntestedSchema = false
): TranslatableMessage | null {
  if (!state.readable) {
    return state.unavailableReason;
  }
  if (state.untested && !allowUntestedSchema) {
    return {
      key: 'ERRORS.PGBOSS_SCHEMA_UNTESTED',
      options: { found: state.version, max: SCHEMA_MAX },
    };
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
