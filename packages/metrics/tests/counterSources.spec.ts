import type { BaseAdapter } from '@worker-manager/api/baseAdapter';
import type { MetricsHistoryProvider } from '@worker-manager/api/typings/app';
import { Redis } from 'ioredis';
import {
  adapterCounterSource,
  type CounterMetric,
  type CounterSource,
} from '../src/counterSources';
import type { MinutePoint } from '../src/dataMapping';
import { vectorTotal } from '../src/histogram';
import type { FinishedJobs, JobSource } from '../src/jobSources';
import { dayRange } from '../src/keys';
import { MetricsRecorder } from '../src/MetricsRecorder';
import { namespacedHistoryProvider } from '../src/namespacedHistoryProvider';
import { RedisMetricsHistoryProvider } from '../src/RedisMetricsHistoryProvider';
import { RedisMetricsStore } from '../src/RedisMetricsStore';
import { connection } from './connection';

const MS_PER_MINUTE = 60000;
const HOUR_MS = 3600000;
const nowMinute = () => Math.floor(Date.now() / MS_PER_MINUTE);

let counter = 0;
const uniquePrefix = () => `wm-test:sources:${process.env.JEST_WORKER_ID ?? 0}:${counter++}`;

interface Call {
  metric: CounterMetric;
  fromMs: number;
  toMs: number;
}

class FakeSource implements CounterSource {
  readonly calls: Call[] = [];
  points: Record<CounterMetric, MinutePoint[]> = { completed: [], failed: [] };
  jobs: JobSource | null = null;

  constructor(
    readonly name: string,
    readonly rollup?: string
  ) {}

  async readMinutes(metric: CounterMetric, fromMs: number, toMs: number): Promise<MinutePoint[]> {
    this.calls.push({ metric, fromMs, toMs });
    return this.points[metric];
  }

  jobSource(): JobSource | null {
    return this.jobs;
  }
}

async function totalOf(provider: MetricsHistoryProvider, queue?: string) {
  const points = await provider.getHistory({
    queue,
    metric: 'completed',
    from: Date.now() - 2 * 86400000,
    to: Date.now(),
    granularity: 'day',
  });
  return points.reduce((sum, p) => sum + p.value, 0);
}

describe('MetricsRecorder with CounterSources', () => {
  let redis: Redis;
  let prefix: string;
  let store: RedisMetricsStore;
  let provider: RedisMetricsHistoryProvider;

  beforeEach(() => {
    redis = new Redis(connection);
    prefix = uniquePrefix();
    store = new RedisMetricsStore({ connection: redis, prefix });
    provider = new RedisMetricsHistoryProvider({ connection: redis, prefix });
  });

  afterEach(async () => {
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length > 0) await redis.del(...keys);
    await redis.quit();
  });

  it('refuses a recorder with nothing to record', () => {
    expect(() => new MetricsRecorder({ store } as never)).toThrow(/queues.*sources/);
  });

  it('records a source under its name and into its own rollup, leaving __global__ alone', async () => {
    const m = nowMinute();
    const source = new FakeSource('ns:alpha', 'ns:__global__');
    source.points.completed = [
      { minute: m - 2, value: 3 },
      { minute: m - 1, value: 4 },
    ];
    const recorder = new MetricsRecorder({ store, sources: [source], latency: false });

    await recorder.snapshot();

    expect(await totalOf(provider, 'ns:alpha')).toBe(7);
    expect(await totalOf(provider, 'ns:__global__')).toBe(7);
    expect(await totalOf(provider)).toBe(0);
    expect(await totalOf(namespacedHistoryProvider(provider, 'ns:'))).toBe(7);
    expect(await totalOf(namespacedHistoryProvider(provider, 'ns:'), 'alpha')).toBe(7);
  });

  it('asks only for the range past its watermark, ending at the current minute', async () => {
    const m = nowMinute();
    const source = new FakeSource('beta');
    source.points.completed = [{ minute: m - 3, value: 2 }];
    const recorder = new MetricsRecorder({ store, sources: [source], latency: false });

    await recorder.snapshot();
    source.points.completed = [{ minute: m - 1, value: 5 }];
    await recorder.snapshot();

    const completed = source.calls.filter((call) => call.metric === 'completed');
    const windowStart = (m - recorder.retention.minutes * 1440) * MS_PER_MINUTE;
    expect(completed[0].fromMs).toBeGreaterThanOrEqual(windowStart);
    expect(completed[0].fromMs).toBeLessThanOrEqual(windowStart + MS_PER_MINUTE);
    expect(completed[1].fromMs).toBe((m - 2) * MS_PER_MINUTE);
    for (const call of completed) {
      expect(call.toMs % MS_PER_MINUTE).toBe(0);
      expect(call.toMs).toBeGreaterThanOrEqual(m * MS_PER_MINUTE);
      expect(call.toMs).toBeLessThanOrEqual(nowMinute() * MS_PER_MINUTE);
    }
    expect(await totalOf(provider, 'beta')).toBe(7);
    expect(await totalOf(provider)).toBe(7);
  });

  it('does not trust a source with the minute in progress', async () => {
    const m = nowMinute();
    const source = new FakeSource('gamma');
    source.points.completed = [
      { minute: m, value: 9 },
      { minute: m - 1, value: 1 },
    ];
    const recorder = new MetricsRecorder({ store, sources: [source], latency: false });

    await recorder.snapshot();

    expect(await totalOf(provider, 'gamma')).toBe(1);
  });

  it('resumes a cold start from the newest stored minute instead of re-reading the window', async () => {
    const m = nowMinute();
    const first = new FakeSource('delta');
    first.points.completed = [{ minute: m - 5, value: 6 }];
    await new MetricsRecorder({ store, sources: [first], latency: false }).snapshot();

    const second = new FakeSource('delta');
    second.points.completed = [{ minute: m - 5, value: 1 }];
    await new MetricsRecorder({ store, sources: [second], latency: false }).snapshot();

    expect(second.calls.find((call) => call.metric === 'completed')?.fromMs).toBe(
      (m - 4) * MS_PER_MINUTE
    );
    expect(await totalOf(provider, 'delta')).toBe(6);
  });

  it('awaits a sources function on every tick', async () => {
    const m = nowMinute();
    const early = new FakeSource('early');
    early.points.completed = [{ minute: m - 1, value: 1 }];
    const late = new FakeSource('late');
    late.points.completed = [{ minute: m - 1, value: 2 }];
    let tick = 0;
    const recorder = new MetricsRecorder({
      store,
      sources: async () => (tick++ === 0 ? [early] : [early, late]),
      latency: false,
    });

    await recorder.snapshot();
    expect(late.calls).toHaveLength(0);
    await recorder.snapshot();

    expect(await totalOf(provider, 'late')).toBe(2);
    expect(await totalOf(provider)).toBe(3);
  });

  it('samples latency from the source’s JobSource into its rollup', async () => {
    const finished = Date.now() - 1000;
    const jobs: JobSource = {
      async finishedJobs(): Promise<FinishedJobs> {
        return {
          total: 1,
          sampled: 1,
          jobs: [
            {
              timestamp: finished - 3000,
              processedOn: finished - 1000,
              finishedOn: finished,
              attempts: 1,
            },
          ],
        };
      },
      async oldestWaitingAge() {
        return 4200;
      },
    };
    const source = new FakeSource('ns:eps', 'ns:__global__');
    source.jobs = jobs;
    const recorder = new MetricsRecorder({
      store,
      sources: [source],
      latencySafetyMarginMs: 0,
    });

    await recorder.snapshot();

    const latency = store.latencyStore(recorder.retention);
    const days = dayRange(Date.now() - HOUR_MS, Date.now());
    for (const queue of ['ns:eps', 'ns:__global__']) {
      const runtime = await latency.readRange(queue, 'runtime', 'hour', days);
      expect(Object.values(runtime).map(vectorTotal)).toEqual([1]);
      const age = await latency.readQueueAge(queue, 'hour', days);
      expect(Object.values(age)).toEqual([4200]);
    }
    expect(await latency.readRange('__global__', 'runtime', 'hour', days)).toEqual({});
  });

  it('records a queue adapter the same through `queues` and through adapterCounterSource', async () => {
    const m = nowMinute();
    const adapter = (name: string) =>
      ({
        getName: () => name,
        getMetrics: async () => ({
          meta: { count: 3, prevTS: (m + 1) * MS_PER_MINUTE, prevCount: 0 },
          data: [2, 0, 1],
          count: 3,
        }),
        getRedisInfo: async () => null,
      }) as unknown as BaseAdapter;

    await new MetricsRecorder({ store, queues: [adapter('viaQueues')] }).snapshot();
    await new MetricsRecorder({
      store,
      sources: [adapterCounterSource(adapter('viaSources'))],
    }).snapshot();

    expect(await totalOf(provider, 'viaQueues')).toBe(3);
    expect(await totalOf(provider, 'viaSources')).toBe(3);
    const hours = (queue: string) =>
      provider.getHistory({
        queue,
        metric: 'completed',
        from: Date.now() - HOUR_MS * 2,
        to: Date.now(),
        granularity: 'hour',
      });
    expect(await hours('viaSources')).toEqual(await hours('viaQueues'));
  });
});
