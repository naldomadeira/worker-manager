import type { AppJobScheduler } from '@worker-manager/api/typings/app';
import { addDays, addHours, startOfDay, startOfHour } from 'date-fns';
import { cronOccurrences, parseCron } from './cron';

export type TimelineZoom = 'day' | 'week' | 'month';

export const TIMELINE_ZOOMS: TimelineZoom[] = ['day', 'week', 'month'];

export interface TimelineWindow {
  start: number;
  end: number;
  unit: 'hour' | 'day';
  columns: number;
}

/**
 * The span each zoom shows. Each opens a little before now, so the run that just happened and
 * the "now" line are both on screen, and is cut on whole hours or days so the grid lines fall on
 * round times in the viewer's zone.
 */
export const timelineWindow = (zoom: TimelineZoom, now: number): TimelineWindow => {
  if (zoom === 'day') {
    const start = addHours(startOfHour(now), -2).getTime();
    return { start, end: addHours(start, 24).getTime(), unit: 'hour', columns: 24 };
  }
  const days = zoom === 'week' ? 7 : 30;
  const start = startOfDay(now).getTime();
  return { start, end: addDays(start, days).getTime(), unit: 'day', columns: days };
};

/**
 * More runs than this in one row stop being individual markers: at month zoom an hourly job
 * would be 720 dots on top of each other. The row becomes one band that states its cadence.
 */
export const MAX_MARKERS = 48;

export interface SchedulerTimelineRow {
  scheduler: AppJobScheduler;
  key: string;
  /** Upcoming fire times inside the window, `next` first. Empty for a dense row. */
  runs: number[];
  /** Set when the runs are too close together to draw one by one. */
  dense: { from: number; to: number; interval: number } | null;
  /** Runs in the window, including the ones a dense band stands for. */
  runsInView: number;
  lastRun?: number;
  /** The pattern could not be expanded, so only `next` is known. */
  nextOnly: boolean;
}

export const schedulerKey = (scheduler: AppJobScheduler) =>
  `${scheduler.queueName}:${scheduler.id}`;

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/**
 * Where a scheduler fires inside the window. The server's `next` is the anchor for both kinds of
 * schedule: an `every` interval repeats from it, and a cron pattern is expanded from it onwards, so
 * the first marker is always the run BullMQ actually has queued. `limit` and `endDate` cut the
 * series short the way they would cut the real schedule.
 */
export const schedulerRuns = (
  scheduler: AppJobScheduler,
  window: TimelineWindow
): SchedulerTimelineRow => {
  const base = {
    scheduler,
    key: schedulerKey(scheduler),
    lastRun: scheduler.lastRun,
  };
  const { next } = scheduler;
  const remaining = scheduler.limit
    ? Math.max(0, scheduler.limit - (scheduler.iterationCount ?? 0))
    : Number.POSITIVE_INFINITY;
  const end = Math.min(window.end, scheduler.endDate ?? Number.POSITIVE_INFINITY);

  if (!next || remaining === 0 || next > end) {
    return { ...base, runs: [], dense: null, runsInView: 0, nextOnly: false };
  }

  if (scheduler.every && !scheduler.pattern) {
    const every = scheduler.every;
    const total = Math.min(remaining, Math.floor((end - next) / every) + 1);
    if (total > MAX_MARKERS) {
      return {
        ...base,
        runs: [],
        dense: { from: next, to: next + (total - 1) * every, interval: every },
        runsInView: total,
        nextOnly: false,
      };
    }
    const runs = Array.from({ length: total }, (_, index) => next + index * every);
    return { ...base, runs, dense: null, runsInView: runs.length, nextOnly: false };
  }

  const fields = scheduler.pattern ? parseCron(scheduler.pattern) : null;
  if (!fields) {
    return { ...base, runs: [next], dense: null, runsInView: 1, nextOnly: true };
  }

  let expanded: number[];
  let truncated: boolean;
  try {
    // One second of slack so `next` itself, stored in ms, is not lost to rounding.
    ({ times: expanded, truncated } = cronOccurrences(
      fields,
      next + 1000,
      end,
      scheduler.tz,
      Math.min(remaining, MAX_MARKERS * 40)
    ));
  } catch {
    // An unknown time zone: the server accepted it, so trust its `next` and stop there.
    return { ...base, runs: [next], dense: null, runsInView: 1, nextOnly: true };
  }

  const runs = [next, ...expanded].slice(0, remaining);
  if (runs.length > MAX_MARKERS) {
    const gaps = runs.slice(1).map((time, index) => time - runs[index]);
    const interval = median(gaps);
    // Past the expansion cap the schedule keeps its cadence to the end of the window, so the band
    // runs on to there and the count is extrapolated from the same cadence.
    const cut = truncated && runs.length < remaining;
    const to = cut ? end : runs[runs.length - 1];
    const runsInView = cut
      ? Math.min(remaining, Math.floor((end - runs[0]) / Math.max(1, interval)) + 1)
      : runs.length;
    return {
      ...base,
      runs: [],
      dense: { from: runs[0], to, interval },
      runsInView,
      nextOnly: false,
    };
  }
  return { ...base, runs, dense: null, runsInView: runs.length, nextOnly: false };
};

export interface TimelineHotspot {
  /** Start of the minute, epoch ms. */
  minute: number;
  keys: string[];
}

const MINUTE_MS = 60_000;

/**
 * Minutes in which two or more schedulers start a run. Dense rows are left out: a job that runs
 * every minute overlaps with everything by definition, and flagging it everywhere would bury
 * the collisions worth spreading out.
 */
export const findHotspots = (rows: SchedulerTimelineRow[]): TimelineHotspot[] => {
  const byMinute = new Map<number, Set<string>>();
  for (const row of rows) {
    for (const run of row.runs) {
      const minute = Math.floor(run / MINUTE_MS) * MINUTE_MS;
      const keys = byMinute.get(minute) ?? new Set<string>();
      keys.add(row.key);
      byMinute.set(minute, keys);
    }
  }
  return [...byMinute.entries()]
    .filter(([, keys]) => keys.size > 1)
    .map(([minute, keys]) => ({ minute, keys: [...keys] }))
    .sort((a, b) => a.minute - b.minute);
};

export const minuteOf = (time: number) => Math.floor(time / MINUTE_MS) * MINUTE_MS;
