import type { AppJobScheduler } from '@worker-manager/api/typings/app';
import { cronOccurrences, parseCron } from '../../src/pages/SchedulersPage/cron';
import {
  findHotspots,
  MAX_MARKERS,
  schedulerRuns,
  type TimelineWindow,
} from '../../src/pages/SchedulersPage/timeline';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const utc = (iso: string) => new Date(iso).getTime();
const iso = (times: number[]) => times.map((time) => new Date(time).toISOString());

describe('parseCron', () => {
  it('expands lists, ranges, steps and names', () => {
    const fields = parseCron('*/20 9-11 * JAN,MAR mon-fri');
    expect(fields?.minutes).toEqual([0, 20, 40]);
    expect(fields?.hours).toEqual([9, 10, 11]);
    expect([...(fields?.months ?? [])]).toEqual([1, 3]);
    expect([...(fields?.daysOfWeek ?? [])]).toEqual([1, 2, 3, 4, 5]);
  });

  it('reads a six-field pattern as seconds first, and folds 7 onto Sunday', () => {
    const fields = parseCron('30 0 12 * * 7');
    expect(fields?.seconds).toEqual([30]);
    expect([...(fields?.daysOfWeek ?? [])]).toEqual([0]);
  });

  it('knows the macros', () => {
    expect(parseCron('@daily')?.hours).toEqual([0]);
    expect(parseCron('@hourly')?.minutes).toEqual([0]);
  });

  it('refuses syntax it does not expand rather than guessing', () => {
    expect(parseCron('0 0 L * *')).toBeNull();
    expect(parseCron('0 0 * * 5#3')).toBeNull();
    expect(parseCron('0 0 15W * *')).toBeNull();
    expect(parseCron('not a cron')).toBeNull();
    expect(parseCron('61 * * * *')).toBeNull();
  });
});

describe('cronOccurrences', () => {
  it('lists the fire times inside the window, in UTC', () => {
    const fields = parseCron('0 3 * * *')!;
    const { times } = cronOccurrences(
      fields,
      utc('2026-09-24T00:00:00Z'),
      utc('2026-09-26T23:59:00Z'),
      'UTC',
      100
    );
    expect(iso(times)).toEqual([
      '2026-09-24T03:00:00.000Z',
      '2026-09-25T03:00:00.000Z',
      '2026-09-26T03:00:00.000Z',
    ]);
  });

  it("evaluates the pattern on the scheduler's own clock", () => {
    // Midnight in Jerusalem is 21:00 UTC the day before while Israel is on summer time (UTC+3).
    const fields = parseCron('0 0 * * *')!;
    const { times } = cronOccurrences(
      fields,
      utc('2026-09-24T00:00:00Z'),
      utc('2026-09-25T23:00:00Z'),
      'Asia/Jerusalem',
      10
    );
    expect(iso(times)).toEqual(['2026-09-24T21:00:00.000Z', '2026-09-25T21:00:00.000Z']);
  });

  it('matches either day field when both are restricted, as cron-parser does', () => {
    // The 1st of the month or any Monday.
    const fields = parseCron('0 12 1 * 1')!;
    const { times } = cronOccurrences(
      fields,
      utc('2026-09-26T00:00:00Z'),
      utc('2026-10-06T00:00:00Z'),
      'UTC',
      10
    );
    expect(iso(times)).toEqual([
      '2026-09-28T12:00:00.000Z',
      '2026-10-01T12:00:00.000Z',
      '2026-10-05T12:00:00.000Z',
    ]);
  });

  it('stops at the cap and says so', () => {
    const fields = parseCron('* * * * *')!;
    const result = cronOccurrences(fields, 0, DAY, 'UTC', 10);
    expect(result.times).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });
});

const scheduler = (overrides: Partial<AppJobScheduler>): AppJobScheduler => ({
  id: 'sched',
  queueName: 'queue',
  name: 'task',
  ...overrides,
});

const now = utc('2026-09-24T12:00:00Z');
const day: TimelineWindow = {
  start: now - 2 * HOUR,
  end: now + 22 * HOUR,
  unit: 'hour',
  columns: 24,
};

describe('schedulerRuns', () => {
  it('repeats an interval from the server-computed next run', () => {
    const row = schedulerRuns(scheduler({ every: 6 * HOUR, next: now + HOUR }), day);
    expect(row.runs).toEqual([now + HOUR, now + 7 * HOUR, now + 13 * HOUR, now + 19 * HOUR]);
    expect(row.dense).toBeNull();
  });

  it('turns a run every minute into one band instead of hundreds of markers', () => {
    const row = schedulerRuns(scheduler({ every: 60_000, next: now + 30_000 }), day);
    expect(row.runs).toEqual([]);
    expect(row.dense).toMatchObject({ from: now + 30_000, interval: 60_000 });
    expect(row.runsInView).toBeGreaterThan(MAX_MARKERS);
  });

  it('keeps the band of a capped cron expansion running to the end of the window', () => {
    const month: TimelineWindow = { start: now, end: now + 30 * DAY, unit: 'day', columns: 30 };
    const row = schedulerRuns(
      scheduler({ pattern: '*/15 * * * *', tz: 'UTC', next: now + 15 * 60_000 }),
      month
    );
    expect(row.dense?.to).toBe(month.end);
    expect(row.runsInView).toBe(30 * 24 * 4);
  });

  it('starts a cron series at `next` and follows the pattern after it', () => {
    const row = schedulerRuns(
      scheduler({ pattern: '0 */6 * * *', tz: 'UTC', next: utc('2026-09-24T18:00:00Z') }),
      day
    );
    expect(iso(row.runs)).toEqual([
      '2026-09-24T18:00:00.000Z',
      '2026-09-25T00:00:00.000Z',
      '2026-09-25T06:00:00.000Z',
    ]);
  });

  it('honours the remaining limit', () => {
    const row = schedulerRuns(
      scheduler({ every: HOUR, next: now + HOUR, limit: 10, iterationCount: 8 }),
      day
    );
    expect(row.runs).toHaveLength(2);
  });

  it('falls back to the next run alone for a pattern it cannot expand', () => {
    const row = schedulerRuns(scheduler({ pattern: '0 0 L * *', next: now + HOUR }), day);
    expect(row.runs).toEqual([now + HOUR]);
    expect(row.nextOnly).toBe(true);
  });

  it('has nothing to draw for a scheduler with no next run', () => {
    expect(schedulerRuns(scheduler({ every: HOUR }), day).runs).toEqual([]);
  });
});

describe('findHotspots', () => {
  it('flags minutes where two or more schedulers start, ignoring dense rows', () => {
    const rows = [
      schedulerRuns(scheduler({ id: 'a', every: 6 * HOUR, next: now + HOUR }), day),
      schedulerRuns(scheduler({ id: 'b', every: 12 * HOUR, next: now + HOUR + 20_000 }), day),
      schedulerRuns(scheduler({ id: 'c', every: 60_000, next: now + HOUR }), day),
    ];
    const hotspots = findHotspots(rows);
    expect(hotspots).toEqual([
      { minute: now + HOUR, keys: ['queue:a', 'queue:b'] },
      { minute: now + 13 * HOUR, keys: ['queue:a', 'queue:b'] },
    ]);
  });
});
