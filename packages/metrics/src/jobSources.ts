import type { BaseAdapter } from '@worker-manager/api/baseAdapter';
import type { MetricsClient } from './connection';
import { quoteIdentifier, type PgQueryable } from './postgres/connection';

/** The timing fields of one finished job, as the latency sampler needs them. */
export interface FinishedJob {
  /** Creation time, `null` when the job carries none. */
  timestamp: number | null;
  processedOn: number;
  finishedOn: number;
  /** Attempts made, counting the one that finished. */
  attempts: number;
}

export interface FinishedJobs {
  /** Jobs that finished in the range, before any subsampling. */
  total: number;
  /** How many of them were selected for reading. `total / sampled` scales counts back up. */
  sampled: number;
  jobs: FinishedJob[];
}

/**
 * Where the sampler reads job timings from: the queue's own datastore, which is independent
 * of where history is stored. A PostgreSQL-backed queue can record into Redis and vice versa.
 */
export interface JobSource {
  /**
   * Jobs whose finish time is in `(afterMs, upToMs]`. Above `maxSamples` a uniform subset is
   * read rather than the first N, which would bias towards the start of the range.
   */
  finishedJobs(afterMs: number, upToMs: number, maxSamples: number): Promise<FinishedJobs>;
  /**
   * Age of the oldest waiting job, 0 for an empty backlog, and `null` when the backlog could
   * not be read cleanly: a gap in the series reads as "not measured", a zero as "healthy".
   */
  oldestWaitingAge(now: number): Promise<number | null>;
}

interface AdapterWithKeys extends BaseAdapter {
  getQueueKey(set: string): string;
}

/**
 * A BullMQ queue stored in Redis, read with the same commands BullMQ itself writes.
 *
 * BullMQ's moveToFinished does `ZADD targetSet, timestamp, jobId` and writes the same value to
 * finishedOn, so the completed and failed sets are sorted sets scored by finish time.
 */
export class RedisJobSource implements JobSource {
  constructor(
    private readonly redis: MetricsClient,
    private readonly adapter: AdapterWithKeys
  ) {}

  async finishedJobs(afterMs: number, upToMs: number, maxSamples: number): Promise<FinishedJobs> {
    const ids: string[] = [];
    for (const set of ['completed', 'failed']) {
      const found = await this.redis.zrangebyscore(
        this.adapter.getQueueKey(set),
        `(${afterMs}`,
        upToMs
      );
      ids.push(...found);
    }
    if (ids.length === 0) {
      return { total: 0, sampled: 0, jobs: [] };
    }

    // The id list is one cheap round trip; the HMGETs are the real cost.
    const selected = ids.length > maxSamples ? sampleUniformly(ids, maxSamples) : ids;

    const pipeline = this.redis.pipeline();
    for (const id of selected) {
      pipeline.hmget(
        this.adapter.getQueueKey(String(id)),
        'timestamp',
        'processedOn',
        'finishedOn',
        // BullMQ 5 counts attempts in `atm`; `attemptsMade` is the pre-v5 name and is read
        // as a fallback exactly the way Job.fromJSON does.
        'atm',
        'attemptsMade'
      );
    }
    const rows = await pipeline.exec();

    const jobs: FinishedJob[] = [];
    for (const row of rows ?? []) {
      const values = row?.[1] as (string | null)[] | undefined;
      if (!values) {
        continue;
      }
      const [timestamp, processedOn, finishedOn, atm, attemptsMade] = values;
      if (!processedOn || !finishedOn) {
        continue;
      }
      jobs.push({
        timestamp: timestamp ? Number(timestamp) : null,
        processedOn: Number(processedOn),
        finishedOn: Number(finishedOn),
        attempts: Number(atm ?? attemptsMade ?? 0),
      });
    }
    return { total: ids.length, sampled: selected.length, jobs };
  }

  /**
   * The backlog is not all in one place. `wait` holds it while the queue is running, but
   * pausing RENAMEs that list to `paused` and routes new jobs there, and anything added with
   * a priority goes to the `prioritized` sorted set instead, which can leave `wait`
   * permanently empty. Reading only `wait` reports a healthy zero for a queue that is badly
   * backed up, which is the opposite of what this gauge is for, so all three are consulted
   * and the worst age wins.
   */
  async oldestWaitingAge(now: number): Promise<number | null> {
    const candidates = await this.redis
      .pipeline()
      // BullMQ LPUSHes to the wait list and workers RPOPLPUSH from it, so the tail is oldest.
      .lrange(this.adapter.getQueueKey('wait'), -1, -1)
      .lrange(this.adapter.getQueueKey('paused'), -1, -1)
      // The prioritized set is scored by priority, not by time, so neither end is guaranteed
      // to hold the oldest job. Both ends are an approximation, and a cheap one: the true
      // oldest would mean fetching the whole set every tick.
      // String indices: ioredis v6 types `zrange`'s stop arg as string-only (Redis coerces
      // either way), so numeric literals no longer typecheck. '0'/'-1' are the first/last members.
      .zrange(this.adapter.getQueueKey('prioritized'), '0', '0')
      .zrange(this.adapter.getQueueKey('prioritized'), '-1', '-1')
      .exec();

    // A pipeline reports failures per command: a Redis error arrives in the entry's error
    // slot next to a null result, rather than as a throw. Reading only the result slot turns
    // a failed read into an empty backlog and records an age of 0, which is the most
    // reassuring number this gauge can produce, at the moment it is least entitled to.
    if (!candidates || candidates.some(([error]) => error)) {
      return null;
    }

    const ids = new Set<string>();
    for (const entry of candidates) {
      for (const id of (entry[1] as string[] | null) ?? []) {
        ids.add(String(id));
      }
    }
    if (ids.size === 0) {
      return 0;
    }

    const stamps = this.redis.pipeline();
    for (const id of ids) {
      stamps.hget(this.adapter.getQueueKey(id), 'timestamp');
    }
    const rows = await stamps.exec();
    // Same reasoning: a failed timestamp read does not zero the gauge, it understates it,
    // which is the same wrong-but-reassuring answer in a quieter form.
    if (!rows || rows.some(([error]) => error)) {
      return null;
    }

    let oldest = 0;
    for (const row of rows) {
      const raw = row[1] as string | null | undefined;
      if (!raw) {
        continue;
      }
      const enqueuedAt = Number(raw);
      if (!Number.isFinite(enqueuedAt)) {
        continue;
      }
      oldest = Math.max(oldest, now - enqueuedAt);
    }
    return Math.max(0, oldest);
  }
}

/**
 * A BullMQ v6 queue stored in PostgreSQL. BullMQ keeps every job in one `job` table with a
 * `state` column, and indexes finished jobs on `(queue, state, finished_at_ms)`, which is the
 * exact shape of the range scan below.
 */
export class PostgresJobSource implements JobSource {
  private readonly job: string;

  constructor(
    private readonly pool: PgQueryable,
    schema: string,
    private readonly queueName: string
  ) {
    this.job = `${quoteIdentifier(schema)}.job`;
  }

  /**
   * One round trip. The selection is the same evenly spaced pick the Redis source makes,
   * done in SQL so a busy tick transfers at most `maxSamples` rows: row `i` of `total` is
   * kept when it is `floor(k * total / max)` for some `k`, which integer arithmetic decides
   * without enumerating the `k`s.
   */
  async finishedJobs(afterMs: number, upToMs: number, maxSamples: number): Promise<FinishedJobs> {
    const max = Math.max(1, Math.floor(maxSamples));
    const { rows } = await this.pool.query(
      `WITH finished AS (
         SELECT added_at_ms, processed_at_ms, finished_at_ms, attempts_made,
                row_number() OVER (ORDER BY finished_at_ms, id) - 1 AS i,
                count(*) OVER () AS total
           FROM ${this.job}
          WHERE queue = $1
            AND state IN ('completed', 'failed')
            AND finished_at_ms > $2
            AND finished_at_ms <= $3
       )
       SELECT added_at_ms, processed_at_ms, finished_at_ms, attempts_made, total
         FROM finished
        WHERE total <= $4
           OR ((i * $4 + total - 1) / total) * total / $4 = i`,
      [this.queueName, afterMs, upToMs, max]
    );
    if (rows.length === 0) {
      return { total: 0, sampled: 0, jobs: [] };
    }
    const total = Number(rows[0].total);
    const jobs: FinishedJob[] = [];
    for (const row of rows) {
      if (row.processed_at_ms == null || row.finished_at_ms == null) {
        continue;
      }
      jobs.push({
        timestamp: row.added_at_ms == null ? null : Number(row.added_at_ms),
        processedOn: Number(row.processed_at_ms),
        finishedOn: Number(row.finished_at_ms),
        attempts: Number(row.attempts_made ?? 0),
      });
    }
    return { total, sampled: rows.length, jobs };
  }

  /**
   * Paused and prioritized are not physical states here: a paused queue's jobs stay
   * `waiting`, and a prioritized job is a waiting job with `priority > 0`. The ready index
   * orders waiting jobs by `(priority, seq)`, so the three ends read below are index probes,
   * not a scan of the backlog: the next job to run, the far end of the prioritized range, and
   * the far end of the unprioritized range, which holds the oldest job of a LIFO queue.
   * Like the Redis prioritized read, this is an approximation that never reads the whole set.
   */
  async oldestWaitingAge(now: number): Promise<number | null> {
    const { rows } = await this.pool.query(
      `SELECT min(added_at_ms) AS oldest FROM (
         (SELECT added_at_ms FROM ${this.job}
           WHERE queue = $1 AND state = 'waiting' ORDER BY priority, seq LIMIT 1)
         UNION ALL
         (SELECT added_at_ms FROM ${this.job}
           WHERE queue = $1 AND state = 'waiting' ORDER BY priority DESC, seq DESC LIMIT 1)
         UNION ALL
         (SELECT added_at_ms FROM ${this.job}
           WHERE queue = $1 AND state = 'waiting' AND priority = 0 ORDER BY seq DESC LIMIT 1)
       ) AS ends`,
      [this.queueName]
    );
    const oldest = rows[0]?.oldest;
    if (oldest == null) {
      return 0;
    }
    return Math.max(0, now - Number(oldest));
  }
}

interface PostgresBackendLike {
  schema?: unknown;
  queueName?: unknown;
  connection?: { pool?: Partial<PgQueryable>; schema?: unknown };
}

interface QueueLike {
  name?: unknown;
  getBackend?: () => PostgresBackendLike | undefined;
}

/**
 * The PostgreSQL pool behind a BullMQ v6 queue, or `null` for anything else.
 *
 * This is a structural probe of BullMQAdapter's queue and BullMQ's backend rather than a
 * public API of either, so every step is optional and a shape it does not recognise simply
 * reads as "not PostgreSQL". The pool is used directly rather than through the backend's
 * `query()`, which parks a query forever once the queue starts closing and would leave a
 * recorder tick hanging on a queue that was just removed from the board.
 */
export function postgresSourceOf(adapter: BaseAdapter): PostgresJobSource | null {
  const queue = (adapter as unknown as { queue?: QueueLike }).queue;
  if (!queue || typeof queue.getBackend !== 'function') {
    return null;
  }
  let backend: PostgresBackendLike | undefined;
  try {
    backend = queue.getBackend();
  } catch {
    return null;
  }
  const pool = backend?.connection?.pool;
  if (!pool || typeof pool.query !== 'function') {
    return null;
  }
  const schema = backend?.schema ?? backend?.connection?.schema ?? 'bullmq';
  const name = backend?.queueName ?? queue.name;
  if (typeof schema !== 'string' || typeof name !== 'string') {
    return null;
  }
  try {
    return new PostgresJobSource(pool as PgQueryable, schema, name);
  } catch {
    return null; // a schema name BullMQ itself would have refused
  }
}

/** Evenly spaced pick across the list, which preserves the distribution's shape. */
function sampleUniformly(ids: string[], target: number): string[] {
  const stride = ids.length / target;
  const out: string[] = [];
  for (let i = 0; i < target; i++) {
    out.push(ids[Math.floor(i * stride)]);
  }
  return out;
}
