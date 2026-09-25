import * as v from 'valibot';
import { pgBossJobIdSchema } from '../../schemas/pgBoss';
import { PgBossEngineError } from './errors';

/** Which side of the key the page lies on, in the list's own order. */
export type PgBossCursorDirection = 'next' | 'prev';

export interface PgBossCursor {
  direction: PgBossCursorDirection;
  createdOn: string;
  id: string;
}

export function encodePgBossCursor({ direction, createdOn, id }: PgBossCursor): string {
  return Buffer.from(`${direction}|${createdOn}|${id}`, 'utf8').toString('base64url');
}

export function decodePgBossCursor(cursor: string): PgBossCursor {
  const [direction, createdOn, id, ...rest] = Buffer.from(cursor, 'base64url')
    .toString('utf8')
    .split('|');

  const valid =
    rest.length === 0 &&
    (direction === 'next' || direction === 'prev') &&
    !!createdOn &&
    !Number.isNaN(Date.parse(createdOn)) &&
    v.is(pgBossJobIdSchema, id);

  if (!valid) {
    throw new PgBossEngineError(400, 'ERRORS.PGBOSS_INVALID_CURSOR');
  }

  return { direction: direction as PgBossCursorDirection, createdOn, id };
}
