import type { MetricsClient } from './connection';
import type { MetricsKeys } from './keys';

/**
 * The version of the Redis key layout this build reads and writes, the Redis counterpart of
 * the PostgreSQL store's schema version. It changes only when the key shapes or the encoding
 * of their values change, and never within a major release.
 *
 * It is recorded in one hash per namespace, `<namespace>:__meta__`, field `layout`. The key
 * shares the namespace, and therefore its `{...}` hash tag on a Redis Cluster. A namespace
 * without the hash was written by a build that predates the marker, and is layout 1.
 */
export const REDIS_LAYOUT_VERSION = 1;

export const LAYOUT_FIELD = 'layout';

/**
 * Writes the marker when the namespace has none, and answers what it holds either way, in one
 * round trip. KEYS[1] meta hash, ARGV[1] field, ARGV[2] this build's layout.
 */
const CLAIM_LAYOUT = `
local current = redis.call('HGET', KEYS[1], ARGV[1])
if current then
  return current
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
return ARGV[2]
`;

export class NewerRedisLayoutError extends Error {
  constructor(
    readonly namespace: string,
    readonly layout: string
  ) {
    super(
      `The metrics history in Redis namespace "${namespace}" uses storage layout ${layout}, ` +
        `newer than the ${REDIS_LAYOUT_VERSION} this build of @worker-manager/metrics ` +
        'understands, so it refuses to write there. Upgrade the package.'
    );
    this.name = 'NewerRedisLayoutError';
  }
}

function assertKnown(namespace: string, raw: string): void {
  const layout = Number(raw);
  if (!Number.isInteger(layout) || layout > REDIS_LAYOUT_VERSION) {
    throw new NewerRedisLayoutError(namespace, raw);
  }
}

/** Claims the namespace for this layout, or throws when a newer build already claimed it. */
export async function claimLayout(redis: MetricsClient, keys: MetricsKeys): Promise<void> {
  const raw = await redis.eval(
    CLAIM_LAYOUT,
    1,
    keys.meta,
    LAYOUT_FIELD,
    String(REDIS_LAYOUT_VERSION)
  );
  assertKnown(keys.namespace, String(raw));
}

/** Throws when the namespace holds a newer layout. Writes nothing. */
export async function assertLayoutKnown(redis: MetricsClient, keys: MetricsKeys): Promise<void> {
  const raw = await redis.hget(keys.meta, LAYOUT_FIELD);
  if (raw !== null) {
    assertKnown(keys.namespace, raw);
  }
}
