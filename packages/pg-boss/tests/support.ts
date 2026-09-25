import { ExpressAdapter } from '@worker-manager/express';
import pg from 'pg';
import request from 'supertest';
import { createPgBossBoard, type CreatePgBossBoardOptions, type PgBossBoardOptions } from '../src';

export const POSTGRES_URL = process.env.POSTGRES_URL;

/** Set by the jest config from the pg-boss alias it maps, so a mapping that stops applying fails. */
export const EXPECTED_SCHEMA: number = Number((globalThis as Record<string, any>).PGBOSS_SCHEMA);
export const EXPECTED_VERSION: string = String((globalThis as Record<string, any>).PGBOSS_VERSION);

const worker = process.env.JEST_WORKER_ID ?? '1';

/** Skips loudly without a database: a silent pass would look exactly like coverage. */
export function describeWithPostgres(name: string, body: () => void) {
  if (!POSTGRES_URL) {
    describe.skip(`${name} (skipped: POSTGRES_URL is not set)`, () => {
      it('needs POSTGRES_URL', () => undefined);
    });
    return;
  }
  describe(`${name} on pg-boss@${EXPECTED_VERSION}`, body);
}

export function adminPool(): pg.Pool {
  return new pg.Pool({ connectionString: POSTGRES_URL, max: 2 });
}

/** A pg-boss schema of this worker's own, freshly installed by the pg-boss the config maps. */
export async function installSchema(tag: string) {
  const schema = `wm_pgb_${worker}_${tag}`;
  const admin = adminPool();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);

  const { PgBoss } = (await import('pg-boss')) as any;
  const app = new PgBoss({
    connectionString: POSTGRES_URL,
    schema,
    supervise: false,
    schedule: false,
  });
  app.on('error', () => undefined);
  await app.start();

  return {
    schema,
    app,
    admin,
    async teardown() {
      await app.stop({ graceful: false, close: true });
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    },
  };
}

export function mountBoard(
  pgBoss: PgBossBoardOptions,
  options: CreatePgBossBoardOptions['options'] = {}
) {
  const serverAdapter = new ExpressAdapter();
  const board = createPgBossBoard({ serverAdapter, pgBoss, options });
  return { agent: request(serverAdapter.getRouter()), ...board };
}

/**
 * Sends a job and moves it into `state` with the columns a worker would leave behind. Written as
 * SQL rather than through fetch/fail, so the job that moves is the one that was sent.
 */
export async function jobIn(
  seed: { app: any; admin: pg.Pool; schema: string },
  queue: string,
  state: 'created' | 'active' | 'completed' | 'failed' | 'cancelled',
  data: object = {}
): Promise<string> {
  const id: string = await seed.app.send(queue, data, { retryLimit: 0 });
  if (state === 'created') return id;
  await seed.admin.query(
    `UPDATE "${seed.schema}".job
        SET state = $3::text::"${seed.schema}".job_state,
            started_on = now(),
            completed_on = CASE WHEN $3::text = 'active' THEN NULL ELSE now() END,
            output = CASE WHEN $3::text = 'failed' THEN '{"message":"boom"}'::jsonb ELSE NULL END
      WHERE name = $1 AND id = $2`,
    [queue, id, state]
  );
  return id;
}
