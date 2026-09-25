// Compile-only gate, run once per pg-boss alias by `yarn typecheck:pgboss`: a real instance of
// either end of the peer range must satisfy the structural type the engine is written against.
import { PgBoss } from 'pg-boss';
import type { PgBossBoardOptions, PgBossLike } from '../../src/index.js';

const boss = new PgBoss({ connectionString: 'postgres://localhost/unused' });

export const fits: PgBossLike = boss;
export const options: PgBossBoardOptions = { instance: boss, schema: 'pgboss' };
