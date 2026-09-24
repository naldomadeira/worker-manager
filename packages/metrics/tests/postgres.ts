import { Pool } from 'pg';
import {
  PostgresMetricsStore,
  type PostgresMetricsStoreOptions,
} from '../src/postgres/PostgresMetricsStore';

export const POSTGRES_URL = process.env.POSTGRES_URL;

/**
 * Runs the PostgreSQL specs when POSTGRES_URL is set and skips them loudly otherwise, the same
 * way the BullMQ-on-PostgreSQL matrix specs do, so a green run without a database never
 * passes for a tested one.
 */
export function describePostgres(title: string, body: () => void): void {
  if (!POSTGRES_URL) {
    describe.skip(`${title} (skipped: POSTGRES_URL is not set)`, () => {
      it('needs a database to talk to', () => undefined);
    });
    return;
  }
  describe(title, body);
}

let counter = 0;

/**
 * A schema of its own per spec: the `__global__` rollup and the admin's table-wide stats are
 * shared by everything in one set of tables, so specs running in parallel workers against one
 * database would otherwise see each other's rows. Dropped first, so a rerun starts clean.
 */
export function uniqueSchema(label: string): string {
  const worker = process.env.JEST_WORKER_ID ?? '0';
  return `wm_test_${label}_w${worker}_${counter++}`.toLowerCase();
}

export function testPool(): Pool {
  return new Pool({ connectionString: POSTGRES_URL, max: 4 });
}

export async function dropSchema(pool: Pool, schema: string): Promise<void> {
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

export async function freshStore(
  pool: Pool,
  label: string,
  overrides: Partial<PostgresMetricsStoreOptions> = {}
): Promise<PostgresMetricsStore> {
  const schema = uniqueSchema(label);
  await dropSchema(pool, schema);
  return new PostgresMetricsStore({ connection: pool, schema, migrate: true, ...overrides });
}
