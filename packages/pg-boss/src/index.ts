import { buildPgBossRoutes, mountBoard, type PgBossEngine } from '@worker-manager/api/engine';
import type { BoardOptions, IServerAdapter } from '@worker-manager/api/typings/app';
import { createPgBossEngine } from './engine';
import type { PgBossBoardOptions } from './types';

export { createPgBossEngine } from './engine';
export type { PgBossBoardOptions, PgBossConnection, PgBossLike } from './types';
export { SCHEMA_MAX, SCHEMA_MIN } from './versionGuard';

export interface CreatePgBossBoardOptions {
  serverAdapter: IServerAdapter;
  pgBoss: PgBossBoardOptions;
  options?: BoardOptions & { readOnly?: boolean };
}

/**
 * Mounts a board over a pg-boss schema on any Worker Manager server adapter. Experimental: the
 * `/api/pg-boss` contract may still change in a minor release.
 *
 * Nothing here migrates, supervises or creates anything in the database. With only a
 * `connection`, writes go through a pg-boss instance that is never started, and only while the
 * database is on the exact schema version that pg-boss writes.
 */
export function createPgBossBoard({
  serverAdapter,
  pgBoss,
  options = {},
}: CreatePgBossBoardOptions): { engine: PgBossEngine; close(): Promise<void> } {
  const { readOnly = false, ...boardOptions } = options;
  const engine = createPgBossEngine(pgBoss, { readOnly });

  mountBoard({
    engine: 'pg-boss',
    routes: buildPgBossRoutes(engine, { readOnly }),
    serverAdapter,
    options: boardOptions,
    isReadOnly: () => readOnly,
    readOnlyAtMount: readOnly,
  });

  return { engine, close: () => engine.close() };
}
