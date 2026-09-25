import pg from 'pg';
import { loadPgBoss } from './pg-boss-loader';

export const POSTGRES_URL = process.env.POSTGRES_URL;

const worker = process.env.JEST_WORKER_ID ?? '1';

export async function installPgBossSchema(tag: string) {
  const schema = `wm_nest_${worker}_${tag}`;
  const admin = new pg.Pool({ connectionString: POSTGRES_URL, max: 2 });
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);

  const loaded = await loadPgBoss();
  const PgBoss = loaded.PgBoss ?? loaded.default?.PgBoss;
  const boss = new PgBoss({
    connectionString: POSTGRES_URL,
    schema,
    migrate: true,
    supervise: false,
    schedule: false,
  });
  boss.on('error', () => undefined);
  await boss.start();

  return {
    schema,
    boss,
    admin,
    async moveTo(queue: string, id: string, state: 'active' | 'failed') {
      await admin.query(
        `UPDATE "${schema}".job
            SET state = $3::text::"${schema}".job_state,
                started_on = now(),
                completed_on = CASE WHEN $3::text = 'active' THEN NULL ELSE now() END
          WHERE name = $1 AND id = $2`,
        [queue, id, state]
      );
    },
    async teardown() {
      await boss.stop({ graceful: false, close: true });
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    },
  };
}
