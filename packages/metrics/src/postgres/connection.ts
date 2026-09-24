/**
 * The slice of node-postgres this package uses, declared structurally so that the published
 * types never name `pg`: a Redis-only install has neither `pg` nor `@types/pg`, and must not
 * need them to compile.
 */
export interface PgQueryResult {
  rows: Record<string, any>[];
  rowCount?: number | null;
}

export interface PgQueryable {
  query(text: string, values?: unknown[]): Promise<PgQueryResult>;
}

export interface PgPoolClient extends PgQueryable {
  release(error?: Error | boolean): void;
}

/** A `pg.Pool`, or anything shaped like one. */
export interface PgPool extends PgQueryable {
  connect(): Promise<PgPoolClient>;
  end(): Promise<void>;
  on?(event: 'error', listener: (error: Error) => void): unknown;
}

/**
 * A node-postgres pool config (`connectionString`, `host`, `max`, `ssl`, ...). A `schema` key
 * is accepted too, so the object handed to BullMQ's PostgreSQL backend can be reused as is;
 * it is lifted out rather than passed to the pool.
 */
export interface PostgresPoolConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string | (() => string | Promise<string>);
  database?: string;
  max?: number;
  schema?: string;
  [option: string]: unknown;
}

/**
 * Mirrors the ergonomics of BullMQ v6's PostgreSQL connection option: an existing pool, a
 * pool config, or a connection string.
 */
export type PostgresConnection = PgPool | PostgresPoolConfig | string;

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Schema names and table prefixes end up inside DDL, where they cannot be bound as
 * parameters, so they are held to plain identifiers and always quoted.
 */
export function quoteIdentifier(name: string): string {
  if (!IDENTIFIER.test(name) || name.length > 63) {
    throw new Error(
      `Invalid PostgreSQL identifier ${JSON.stringify(name)}: use letters, digits and ` +
        'underscores, starting with a letter or underscore, at most 63 characters.'
    );
  }
  return `"${name}"`;
}

export function isPool(connection: unknown): connection is PgPool {
  const candidate = connection as Partial<PgPool> | null;
  return (
    !!candidate &&
    typeof candidate.connect === 'function' &&
    typeof candidate.query === 'function' &&
    typeof candidate.end === 'function'
  );
}

/**
 * `pg` is an optional peer dependency, so it is required only here, on the first PostgreSQL
 * store that has to build its own pool. Handing in a pool never loads it.
 */
function loadPg(): { Pool: new (config: Record<string, unknown>) => PgPool } {
  try {
    // oxlint-disable-next-line typescript/no-require-imports
    return require('pg');
  } catch {
    throw new Error(
      "PostgreSQL metrics storage needs the optional 'pg' package. Install it with " +
        '`npm install pg`, or pass an existing pg.Pool as `connection`.'
    );
  }
}

export function resolvePool(
  connection: PostgresConnection,
  onError?: (error: Error) => void
): { pool: PgPool; owned: boolean; schema: string | undefined } {
  if (isPool(connection)) {
    return { pool: connection, owned: false, schema: undefined };
  }
  const { schema, ...config } =
    typeof connection === 'string'
      ? ({ connectionString: connection } as PostgresPoolConfig)
      : connection;
  const { Pool } = loadPg();
  const pool = new Pool(config);
  // node-postgres emits `error` for a pooled client that dies while idle (a server restart, a
  // dropped connection). Unhandled, that event takes the whole process down with it.
  pool.on?.('error', (error) => onError?.(error));
  return { pool, owned: true, schema };
}
