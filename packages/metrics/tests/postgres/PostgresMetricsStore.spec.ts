import type { Pool } from 'pg';
import { minuteToDay } from '../../src/keys';
import {
  migratePostgresMetrics,
  PostgresMetricsStore,
} from '../../src/postgres/PostgresMetricsStore';
import { SCHEMA_VERSION } from '../../src/postgres/schema';
import { describePostgres, dropSchema, POSTGRES_URL, testPool, uniqueSchema } from '../postgres';

const RETENTION = { minutes: 7, hours: 90, days: 90 };
const MINUTE = Date.UTC(2020, 2, 10, 12, 0) / 60000;

describePostgres('PostgresMetricsStore', () => {
  let pool: Pool;
  let schema: string;

  beforeAll(() => {
    pool = testPool();
  });

  beforeEach(async () => {
    schema = uniqueSchema('store');
    await dropSchema(pool, schema);
  });

  afterEach(async () => {
    await dropSchema(pool, schema);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function tablesIn(name: string): Promise<string[]> {
    const { rows } = await pool.query(
      'SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename',
      [name]
    );
    return rows.map((row) => row.tablename);
  }

  describe('migration', () => {
    it('creates the schema, the tables and a version row', async () => {
      const store = new PostgresMetricsStore({ connection: pool, schema });
      await store.migrate();

      expect(await tablesIn(schema)).toEqual([
        'bull_board_metrics_counters',
        'bull_board_metrics_histograms',
        'bull_board_metrics_meta',
        'bull_board_metrics_sampler_state',
      ]);
      const { rows } = await pool.query(
        `SELECT value FROM ${store.tables.meta} WHERE name = 'schema_version'`
      );
      expect(rows).toEqual([{ value: String(SCHEMA_VERSION) }]);
    });

    it('is idempotent and safe to race', async () => {
      const stores = Array.from(
        { length: 4 },
        () => new PostgresMetricsStore({ connection: pool, schema })
      );
      await Promise.all(stores.map((store) => store.migrate()));
      await stores[0].migrate();
      expect(await tablesIn(schema)).toHaveLength(4);
    });

    it('migrates lazily on first use with `migrate: true`', async () => {
      const store = new PostgresMetricsStore({ connection: pool, schema, migrate: true });
      await store
        .counterStore(RETENTION)
        .upsertMinutes('Q', 'completed', [{ minute: MINUTE, value: 1 }]);
      expect(
        await store.counterStore(RETENTION).readDailyTotals('Q', 'completed', [minuteToDay(MINUTE)])
      ).toEqual([1]);
    });

    it('refuses to run against missing tables without `migrate`, with instructions', async () => {
      const store = new PostgresMetricsStore({ connection: pool, schema });
      await expect(
        store.counterStore(RETENTION).readDailyTotals('Q', 'completed', ['2020-03-10'])
      ).rejects.toThrow(/migrate: true.*migratePostgresMetrics/);

      // Not memoized as a failure: once a deploy step migrates, the same store works.
      await migratePostgresMetrics({ connection: pool, schema });
      expect(
        await store.counterStore(RETENTION).readDailyTotals('Q', 'completed', ['2020-03-10'])
      ).toEqual([null]);
    });

    it('refuses a schema newer than this build', async () => {
      const store = new PostgresMetricsStore({ connection: pool, schema });
      await store.migrate();
      await pool.query(`UPDATE ${store.tables.meta} SET value = '99'`);

      const fresh = new PostgresMetricsStore({ connection: pool, schema });
      await expect(fresh.ready()).rejects.toThrow(/version 99/);
      await expect(fresh.migrate()).rejects.toThrow(/version 99/);
    });

    it('keeps two boards apart by table prefix in one schema', async () => {
      const a = new PostgresMetricsStore({ connection: pool, schema, migrate: true });
      const b = new PostgresMetricsStore({
        connection: pool,
        schema,
        tablePrefix: 'staging_',
        migrate: true,
      });
      await a
        .counterStore(RETENTION)
        .upsertMinutes('Q', 'completed', [{ minute: MINUTE, value: 3 }]);

      const day = minuteToDay(MINUTE);
      expect(await b.counterStore(RETENTION).readDailyTotals('Q', 'completed', [day])).toEqual([
        null,
      ]);
      expect(await tablesIn(schema)).toContain('staging_counters');
    });
  });

  describe('connection', () => {
    it('rejects identifiers that would need escaping', () => {
      expect(() => new PostgresMetricsStore({ connection: pool, schema: 'bad"name' })).toThrow(
        'Invalid PostgreSQL identifier'
      );
      expect(
        () => new PostgresMetricsStore({ connection: pool, schema, tablePrefix: 'x; drop' })
      ).toThrow('Invalid PostgreSQL identifier');
    });

    it('leaves a pool it was handed open on close', async () => {
      const store = new PostgresMetricsStore({ connection: pool, schema });
      await store.close();
      expect((await pool.query('SELECT 1 AS ok')).rows).toEqual([{ ok: 1 }]);
    });

    it('builds and ends its own pool from a connection string', async () => {
      const store = new PostgresMetricsStore({ connection: POSTGRES_URL!, schema, migrate: true });
      await store.ready();
      await store.close();
      await expect(store.pool.query('SELECT 1')).rejects.toThrow();
    });

    it("takes the schema from a pool config, as BullMQ's own connection option carries it", async () => {
      const store = new PostgresMetricsStore({
        connection: { connectionString: POSTGRES_URL, schema, max: 1 },
        migrate: true,
      });
      await store.ready();
      expect(store.tables.schema).toBe(schema);
      expect(await tablesIn(schema)).toHaveLength(4);
      await store.close();
    });
  });
});
