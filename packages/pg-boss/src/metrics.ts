import type { PgBossEngine } from '@worker-manager/api/engine';
// Types only: `@worker-manager/metrics` is an optional peer, and nothing here loads it at runtime.
import type {
  CounterMetric,
  CounterSource,
  FinishedJob,
  FinishedJobs,
  JobSource,
  MinutePoint,
} from '@worker-manager/metrics';
import type { Reader } from './connection';
import { createPgBossEngine } from './engine';
import { internalsOf } from './internals';
import { quoteSchema } from './sql';
import type { PgBossBoardOptions } from './types';

const GLOBAL_QUEUE = '__global__';
const DEFAULT_SAFETY_MARGIN_MS = 5000;
const DEFAULT_INDEX_RECHECK_MS = 5 * 60_000;

/** The prefix pg-boss queues of `schema` are recorded under: `pgboss:<schema>:`. */
export function pgBossMetricsNamespace(schema = 'pgboss'): string {
  return `pgboss:${schema}:`;
}

/**
 * The index the counters and the latency scan need. Without it every tick reads every retained
 * row of the queue. Printed in the warning and in the docs; this package never runs it.
 */
export function pgBossMetricsIndexDdl(schema = 'pgboss'): string {
  const s = quoteSchema(schema);
  return `CREATE INDEX wm_job_completed_on ON ${s}.job (name, completed_on);`;
}

export interface PgBossMetricsOptions {
  /**
   * A queue whose counters are off because no usable `(name, completed_on)` index exists, or a
   * schema this package cannot read. Once per queue per state change. Defaults to `console.warn`,
   * since it is a configuration problem that otherwise looks exactly like an idle queue.
   */
  onWarning?: (message: string) => void;
  /** A read that failed. The tick records nothing for that queue and retries. Silent by default. */
  onError?: (error: unknown, queue: string | null) => void;
  /**
   * How long before the database's current minute a minute counts as closed. pg-boss stamps
   * `completed_on` with the time the completing transaction started, so a job can become
   * visible slightly after its minute ended. Default 5000.
   */
  safetyMarginMs?: number;
  /** How often a queue's index is looked up again. Default five minutes. */
  indexRecheckMs?: number;
}

/** A tick's queue list for `MetricsRecorder`'s `sources`, plus what it holds open. */
export interface PgBossMetricsSources {
  (): Promise<CounterSource[]>;
  /** The recorded-name prefix, for `namespacedHistoryProvider(provider, sources.namespace)`. */
  readonly namespace: string;
  /** Closes the engine this built from connection options. An engine handed in stays open. */
  close(): Promise<void>;
}

interface IndexState {
  usable: boolean;
  checkedAt: number;
  pending: Promise<boolean> | null;
}

interface Context {
  reader: Reader;
  schema: string;
  quoted: string;
  namespace: string;
  safetyMarginMs: number;
  indexRecheckMs: number;
  warn(message: string): void;
  fail(error: unknown, queue: string | null): void;
  indexed(queue: string): Promise<boolean>;
}

/** `$n` epoch milliseconds as a timestamptz, exactly: a float would round at microseconds. */
const at = (param: string) => `(timestamptz 'epoch' + ${param}::bigint * interval '1 millisecond')`;

/**
 * An index on `(name, completed_on, ...)` of the queue's table or of the partitioned `job`
 * parent, valid, with no predicate or one that keeps both finished states.
 */
export function isUsableMetricsIndex(indexdef: string): boolean {
  // Parsed with plain string scanning: a regex over `indexdef`, which comes from the database,
  // would be an input-dependent backtracking risk (CodeQL js/polynomial-redos).
  const lower = indexdef.toLowerCase();
  const using = lower.indexOf('using btree (');
  if (using === -1) return false;
  const open = using + 'using btree ('.length;
  const close = indexdef.indexOf(')', open);
  if (close === -1) return false;

  const columns = indexdef
    .slice(open, close)
    .split(',')
    .map((column) => column.trim().replace(/"/g, ''));
  const second = columns[1] ?? '';
  const secondIsCompletedOn =
    second === 'completed_on' ||
    second.startsWith('completed_on ') ||
    second.startsWith('completed_on\t');
  if (columns[0] !== 'name' || !secondIsCompletedOn) return false;

  const where = lower.indexOf(' where ', close);
  if (where === -1) return true;
  const predicate = lower.slice(where + ' where '.length);
  return predicate.includes("'completed'") && predicate.includes("'failed'");
}

function indexQuery(quoted: string): string {
  return `
    SELECT i.indexdef, x.indisvalid AS valid
      FROM pg_indexes i
      JOIN pg_namespace n ON n.nspname = i.schemaname
      JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = i.indexname
      JOIN pg_index x ON x.indexrelid = c.oid
     WHERE i.schemaname = $1
       AND i.tablename IN (
         'job',
         coalesce((SELECT table_name FROM ${quoted}.queue WHERE name = $2), 'job_common')
       )`;
}

function context(
  reader: Reader,
  schema: string,
  options: PgBossMetricsOptions
): Omit<Context, 'indexed'> & { indexState: Map<string, IndexState> } {
  const warned = new Set<string>();
  return {
    reader,
    schema,
    quoted: quoteSchema(schema),
    namespace: pgBossMetricsNamespace(schema),
    safetyMarginMs: options.safetyMarginMs ?? DEFAULT_SAFETY_MARGIN_MS,
    indexRecheckMs: options.indexRecheckMs ?? DEFAULT_INDEX_RECHECK_MS,
    indexState: new Map(),
    warn(message) {
      if (warned.has(message)) return;
      warned.add(message);
      try {
        (options.onWarning ?? console.warn)(message);
      } catch {
        // A throwing reporter must not take the tick down.
      }
    },
    fail(error, queue) {
      try {
        options.onError?.(error, queue);
      } catch {
        // Same.
      }
    },
  };
}

function withIndexCheck(base: ReturnType<typeof context>): Context {
  const ctx: Context = {
    ...base,
    async indexed(queue) {
      let state = base.indexState.get(queue);
      if (state && (state.pending || Date.now() - state.checkedAt < base.indexRecheckMs)) {
        return state.pending ?? state.usable;
      }
      state ??= { usable: false, checkedAt: 0, pending: null };
      base.indexState.set(queue, state);
      const current = state;
      current.pending = (async () => {
        try {
          const rows = await base.reader.query(indexQuery(base.quoted), [base.schema, queue]);
          const usable = rows.some((row) => row.valid && isUsableMetricsIndex(row.indexdef));
          if (!usable) {
            base.warn(
              `[worker-manager] pg-boss queue "${queue}" (schema "${base.schema}") has no usable ` +
                `index on (name, completed_on), so its throughput and latency history is off. ` +
                `Create it with: ${pgBossMetricsIndexDdl(base.schema)} ` +
                `(see the historical metrics recipe for the non-blocking variant).`
            );
          }
          current.usable = usable;
        } catch (error) {
          base.fail(error, queue);
          current.usable = false;
        }
        current.checkedAt = Date.now();
        current.pending = null;
        return current.usable;
      })();
      return current.pending;
    },
  };
  return ctx;
}

/**
 * Job timings of one pg-boss queue, for the latency sampler. Run time is `completed_on -
 * started_on`; wait is `started_on - start_after` rather than `- created_on`, so a job deferred
 * on purpose does not count as waiting; attempts are `retry_count + 1`, which makes the sampler
 * leave retried jobs out of the wait histogram as it does for BullMQ.
 */
export class PgBossJobSource implements JobSource {
  constructor(
    private readonly ctx: Context,
    private readonly queue: string
  ) {}

  /** Same uniform pick in SQL as the BullMQ PostgreSQL source, off the same index as the counters. */
  async finishedJobs(afterMs: number, upToMs: number, maxSamples: number): Promise<FinishedJobs> {
    if (!(await this.ctx.indexed(this.queue))) {
      return { total: 0, sampled: 0, jobs: [] };
    }
    const max = Math.max(1, Math.floor(maxSamples));
    const rows = await this.ctx.reader.query(
      `WITH finished AS (
         SELECT (extract(epoch FROM start_after) * 1000)::float8 AS start_after_ms,
                (extract(epoch FROM started_on) * 1000)::float8 AS started_ms,
                (extract(epoch FROM completed_on) * 1000)::float8 AS completed_ms,
                retry_count,
                row_number() OVER (ORDER BY completed_on, id) - 1 AS i,
                count(*) OVER () AS total
           FROM ${this.ctx.quoted}.job
          WHERE name = $1
            AND state IN ('completed', 'failed')
            AND completed_on > ${at('$2')}
            AND completed_on <= ${at('$3')}
       )
       SELECT start_after_ms, started_ms, completed_ms, retry_count, total
         FROM finished
        WHERE total <= $4
           OR ((i * $4 + total - 1) / total) * total / $4 = i`,
      [this.queue, Math.floor(afterMs), Math.floor(upToMs), max]
    );
    if (rows.length === 0) {
      return { total: 0, sampled: 0, jobs: [] };
    }
    const jobs: FinishedJob[] = [];
    for (const row of rows) {
      if (row.started_ms == null || row.completed_ms == null) continue;
      jobs.push({
        timestamp: row.start_after_ms == null ? null : Number(row.start_after_ms),
        processedOn: Number(row.started_ms),
        finishedOn: Number(row.completed_ms),
        attempts: Number(row.retry_count ?? 0) + 1,
      });
    }
    return { total: Number(rows[0].total), sampled: rows.length, jobs };
  }

  /**
   * The oldest job that could run now and has not: queued (`state < 'active'`), not blocked
   * by a dependency, and due. On the database clock, since `start_after` is. The fetch index
   * (`job_i11`, `job_i5` on the floor) covers this predicate, so it needs no extra index.
   */
  async oldestWaitingAge(): Promise<number | null> {
    const [row] = await this.ctx.reader.query(
      `SELECT (extract(epoch FROM now() - min(start_after)) * 1000)::float8 AS age
         FROM ${this.ctx.quoted}.job
        WHERE name = $1 AND state < 'active' AND NOT blocked AND start_after <= now()`,
      [this.queue]
    );
    return row?.age == null ? 0 : Math.max(0, Number(row.age));
  }
}

class PgBossCounterSource implements CounterSource {
  readonly name: string;
  readonly rollup: string;
  private readonly jobs: PgBossJobSource;

  constructor(
    private readonly ctx: Context,
    private readonly queue: string
  ) {
    this.name = `${ctx.namespace}${queue}`;
    this.rollup = `${ctx.namespace}${GLOBAL_QUEUE}`;
    this.jobs = new PgBossJobSource(ctx, queue);
  }

  /**
   * Terminal jobs by the minute of `completed_on`. The state filter matters: pg-boss also
   * stamps `completed_on` on a cancel. The upper bound is the earlier of the recorder's and the
   * database's closed minute, so neither clock can hand over a minute that is still filling.
   */
  async readMinutes(metric: CounterMetric, fromMs: number, toMs: number): Promise<MinutePoint[]> {
    if (!(await this.ctx.indexed(this.queue))) return [];
    try {
      const rows = await this.ctx.reader.query(
        `SELECT floor(extract(epoch FROM completed_on) / 60)::bigint AS minute,
                count(*)::int AS value
           FROM ${this.ctx.quoted}.job
          WHERE name = $1
            AND state = $2::text::${this.ctx.quoted}.job_state
            AND completed_on >= ${at('$3')}
            AND completed_on < least(
              ${at('$4')},
              timestamptz 'epoch'
                + floor((extract(epoch FROM now()) * 1000 - $5::float8) / 60000)::float8
                  * interval '1 minute'
            )
          GROUP BY 1
          ORDER BY 1 DESC`,
        [this.queue, metric, Math.floor(fromMs), Math.floor(toMs), this.ctx.safetyMarginMs]
      );
      return rows.map((row) => ({ minute: Number(row.minute), value: Number(row.value) }));
    } catch (error) {
      this.ctx.fail(error, this.queue);
      return [];
    }
  }

  jobSource(): JobSource {
    return this.jobs;
  }
}

function resolveEngine(target: PgBossEngine | PgBossBoardOptions): {
  engine: PgBossEngine;
  owned: boolean;
} {
  if (internalsOf(target)) {
    return { engine: target as PgBossEngine, owned: false };
  }
  if (typeof (target as Partial<PgBossEngine>).listQueues === 'function') {
    throw new Error(
      'pgBossMetricsSources needs an engine made by createPgBossEngine or createPgBossBoard, ' +
        'or the same options createPgBossBoard takes under `pgBoss`.'
    );
  }
  return {
    engine: createPgBossEngine(target as PgBossBoardOptions, { readOnly: true }),
    owned: true,
  };
}

/**
 * The queues of one pg-boss schema as `MetricsRecorder` sources, recorded as
 * `pgboss:<schema>:<queue>` and rolled up into `pgboss:<schema>:__global__`:
 *
 * ```ts
 * const { engine } = createPgBossBoard({ serverAdapter, pgBoss: { connection, schema: 'pgboss' } });
 * new MetricsRecorder({ store, sources: pgBossMetricsSources(engine) }).start();
 * ```
 *
 * The queue list, the engine's allowlist included, is read again on every tick. Each queue's
 * `(name, completed_on)` index is looked up when it first appears and every `indexRecheckMs`
 * after; without one its counters and latency scan stay off (`onWarning` says so) and only the
 * queue-age gauge is recorded. The history only reaches back as far as pg-boss keeps finished
 * jobs (`deleteAfterSeconds`, a week by default).
 */
export function pgBossMetricsSources(
  target: PgBossEngine | PgBossBoardOptions,
  options: PgBossMetricsOptions = {}
): PgBossMetricsSources {
  const { engine, owned } = resolveEngine(target);
  const internals = internalsOf(engine)!;
  const ctx = withIndexCheck(context(internals.reader, internals.schema, options));
  const sources = new Map<string, PgBossCounterSource>();

  const resolve = async (): Promise<CounterSource[]> => {
    try {
      const unreadable = await engine.readGate();
      if (unreadable) {
        ctx.warn(
          `[worker-manager] pg-boss schema "${ctx.schema}" cannot be read (${unreadable.key}), ` +
            `so no pg-boss history is recorded.`
        );
        return [];
      }
      const queues = await engine.listQueues();
      await Promise.all(queues.map((queue) => ctx.indexed(queue.name)));
      return queues.map((queue) => {
        let source = sources.get(queue.name);
        if (!source) {
          source = new PgBossCounterSource(ctx, queue.name);
          sources.set(queue.name, source);
        }
        return source;
      });
    } catch (error) {
      ctx.fail(error, null);
      return [];
    }
  };

  return Object.assign(resolve, {
    namespace: ctx.namespace,
    close: async () => {
      if (owned) await engine.close();
    },
  });
}

export interface PgBossQueueDepthPoint {
  /** Bucket start, epoch ms. */
  ts: number;
  deferred: number;
  queued: number;
  ready: number;
  active: number;
  failed: number;
  total: number;
}

export interface PgBossQueueDepthQuery {
  /** Inclusive bounds, epoch ms. */
  from: number;
  to: number;
  /** Bucket width. Default 300. */
  bucketSeconds?: number;
  /** How a bucket folds its snapshots. Default `max`, the worst backlog seen in it. */
  aggregate?: 'max' | 'avg';
}

/**
 * Queue depth over time, from the snapshots pg-boss itself keeps in `queue_stats` when a
 * queue runs with `persistQueueStats` and some instance supervises it. The same bucketing as
 * pg-boss's `getQueueStatsHistoryBucketed`, on epoch-aligned buckets. Empty for a queue with no
 * snapshots, or one the engine's allowlist hides. Nothing here creates snapshots.
 *
 * Not served by any route yet: see the historical metrics recipe.
 */
export async function readPgBossQueueDepth(
  engine: PgBossEngine,
  queue: string,
  { from, to, bucketSeconds = 300, aggregate = 'max' }: PgBossQueueDepthQuery
): Promise<PgBossQueueDepthPoint[]> {
  const internals = internalsOf(engine);
  if (!internals) {
    throw new Error('readPgBossQueueDepth needs an engine made by createPgBossEngine.');
  }
  if (!(await engine.getQueue(queue))) return [];
  const fold = aggregate === 'avg' ? 'avg' : 'max';
  const width = Math.max(1, Math.floor(bucketSeconds));
  const columns = ['deferred', 'queued', 'ready', 'active', 'failed', 'total'] as const;
  const rows = await internals.reader.query(
    `SELECT (floor(extract(epoch FROM captured_on) / $4) * $4 * 1000)::float8 AS ts,
            ${columns.map((c) => `round(${fold}(${c}_count))::int AS ${c}`).join(', ')}
       FROM ${quoteSchema(internals.schema)}.queue_stats
      WHERE name = $1 AND captured_on >= ${at('$2')} AND captured_on <= ${at('$3')}
      GROUP BY 1
      ORDER BY 1`,
    [queue, Math.floor(from), Math.floor(to), width]
  );
  return rows.map((row) => ({
    ts: Number(row.ts),
    deferred: Number(row.deferred),
    queued: Number(row.queued),
    ready: Number(row.ready),
    active: Number(row.active),
    failed: Number(row.failed),
    total: Number(row.total),
  }));
}
