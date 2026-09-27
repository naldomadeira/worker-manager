import type { GetPgBossWarningsResponse } from '../../schemas/responses';
import type { PgBossWarning } from '../../types';
import { decodePgBossCursor, encodePgBossCursor } from './cursor';
import type { PgBossQueueDepthWindow } from './types';

type DepthRange = '1h' | '6h' | '24h' | '7d';

/** Each window's bucket width, picked to keep the chart between about 60 and 100 points. */
const DEPTH_BUCKETS: Record<DepthRange, { spanMs: number; bucketSeconds: number }> = {
  '1h': { spanMs: 3_600_000, bucketSeconds: 60 },
  '6h': { spanMs: 6 * 3_600_000, bucketSeconds: 300 },
  '24h': { spanMs: 24 * 3_600_000, bucketSeconds: 900 },
  '7d': { spanMs: 7 * 24 * 3_600_000, bucketSeconds: 7200 },
};

/** The window a depth range reads, ending now. */
export function depthWindow(
  range: DepthRange,
  aggregate: 'max' | 'avg',
  now = Date.now()
): PgBossQueueDepthWindow {
  const { spanMs, bucketSeconds } = DEPTH_BUCKETS[range];
  return { from: now - spanMs, to: now, bucketSeconds, aggregate };
}

/** The keys pg-boss puts a queue name under in a warning's data. */
const QUEUE_KEYS = ['name', 'queue', 'queueName'] as const;

/**
 * The queue a warning is about, when its data names one of `known`. `queue_backlog` stores the
 * queue row (`name`), the timekeeper's warnings store `queue`.
 */
export function warningQueueName(data: unknown, known: ReadonlySet<string>): string | null {
  if (!data || typeof data !== 'object') return null;
  for (const key of QUEUE_KEYS) {
    const value = (data as Record<string, unknown>)[key];
    if (typeof value === 'string' && known.has(value)) return value;
  }
  return null;
}

/**
 * Whether a warning mentions the queue `name` anywhere: as its queue, or quoted in its message
 * or anywhere in its data, which is where a slow query's parameters put it. Deliberately broad,
 * since a false positive only hides a warning while a false negative leaks a hidden queue name.
 */
export function mentionsQueue(
  warning: Pick<PgBossWarning, 'message' | 'data'>,
  name: string
): boolean {
  if (warningQueueName(warning.data, new Set([name])) === name) return true;
  const data =
    warning.data === undefined || warning.data === null ? '' : JSON.stringify(warning.data);
  // A JSON string value, a double- or single-quoted mention, and a quoted mention inside a
  // JSON string. Never the bare name: `a` would otherwise hide every warning.
  const forms = [JSON.stringify(name), `"${name}"`, `'${name}'`, `\\"${name}\\"`];
  return [warning.message ?? '', data].some((text) => forms.some((form) => text.includes(form)));
}

/** A warning as a store reads it, with the key the next page starts after. */
export type PgBossWarningRow = PgBossWarning & {
  /** The keyset position, at the store's own precision. `createdOn` when absent. */
  cursorKey?: string;
};

/** Reads up to `limit` warnings strictly past `after`, in the order asked for. */
export type PgBossWarningReader = (
  after: { createdOn: string; id: string } | null,
  descending: boolean,
  limit: number
) => Promise<PgBossWarningRow[]>;

const WARNING_ROUNDS = 5;

/**
 * One keyset page of warnings, newest first, with the warnings `keep` refuses taken out. A
 * page that loses rows to the filter reads on, a few batches at most, so hidden warnings cost
 * the page its length rather than its place: past that, the cursor points at the last warning
 * examined and the next page carries on from there.
 */
export async function pageWarnings(
  read: PgBossWarningReader,
  query: { cursor?: string; limit: string | number },
  keep: (warning: PgBossWarning) => Promise<boolean>,
  /** The cursor encoding. Node's `Buffer` by default; a browser mock passes its own. */
  codec: { encode: typeof encodePgBossCursor; decode: typeof decodePgBossCursor } = {
    encode: encodePgBossCursor,
    decode: decodePgBossCursor,
  }
): Promise<GetPgBossWarningsResponse> {
  const limit = Number(query.limit);
  const cursor = query.cursor ? codec.decode(query.cursor) : null;
  const backwards = cursor?.direction === 'prev';
  const batch = Math.max(limit + 1, 50);

  let after = cursor ? { createdOn: cursor.createdOn, id: cursor.id } : null;
  const kept: PgBossWarningRow[] = [];
  let exhausted = false;
  for (let round = 0; round < WARNING_ROUNDS && kept.length <= limit; round++) {
    const rows = await read(after, !backwards, batch);
    for (const row of rows) {
      after = { createdOn: row.cursorKey ?? row.createdOn, id: row.id };
      if (await keep(row)) {
        kept.push(row);
        if (kept.length > limit) break;
      }
    }
    if (rows.length < batch && kept.length <= limit) {
      exhausted = true;
      break;
    }
  }

  const hasMore = kept.length > limit || !exhausted;
  const page = kept.slice(0, limit);
  // Where the next read in this direction starts: the last row shown, or the last one looked at
  // when the filter left the page short.
  const frontier =
    kept.length > limit ? page[page.length - 1] : after && { ...after, cursorKey: after.createdOn };
  if (backwards) page.reverse();

  const keyOf = (
    row: { createdOn: string; id: string; cursorKey?: string },
    direction: 'next' | 'prev'
  ) => codec.encode({ direction, createdOn: row.cursorKey ?? row.createdOn, id: row.id });
  const first = page[0];
  const last = page[page.length - 1];

  const onward = hasMore && frontier ? frontier : null;
  return {
    warnings: page.map(({ cursorKey: _key, ...warning }) => warning),
    nextCursor: backwards
      ? last
        ? keyOf(last, 'next')
        : null
      : onward
        ? keyOf(onward, 'next')
        : null,
    prevCursor: backwards
      ? onward
        ? keyOf(onward, 'prev')
        : null
      : cursor && first
        ? keyOf(first, 'prev')
        : null,
  };
}
