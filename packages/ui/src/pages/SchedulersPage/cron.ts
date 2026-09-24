/**
 * A small, dependency-free cron expander for the scheduler timeline.
 *
 * The API reports only a scheduler's `next` run, and pulling BullMQ's `cron-parser` into the UI
 * bundle to draw a few dots is not worth it. This covers the syntax schedulers are written in
 * practice -- five or six fields (seconds first), `*`, `?`, lists, ranges, steps, month and weekday
 * names, `@daily` and friends -- and evaluates it in the scheduler's time zone. Anything it does
 * not understand (`L`, `W`, `#`, `H`) makes `parseCron` return null, and the timeline falls back to
 * the `next` run the server computed rather than guessing.
 *
 * Day matching follows cron-parser: when both day of month and day of week are restricted, a
 * day matches if either does.
 */

export interface CronFields {
  seconds: number[];
  minutes: number[];
  hours: number[];
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  /** `*` or `?` in the day of month field. */
  anyDayOfMonth: boolean;
  /** `*` or `?` in the day of week field. */
  anyDayOfWeek: boolean;
}

const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

const MONTH_NAMES = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];
const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

interface FieldSpec {
  min: number;
  max: number;
  names?: string[];
  /** Offset added to a name's index, e.g. 1 for months (JAN = 1). */
  nameBase?: number;
}

const SPECS: Record<'second' | 'minute' | 'hour' | 'dom' | 'month' | 'dow', FieldSpec> = {
  second: { min: 0, max: 59 },
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  dom: { min: 1, max: 31 },
  month: { min: 1, max: 12, names: MONTH_NAMES, nameBase: 1 },
  // 7 is Sunday as well, folded onto 0 below.
  dow: { min: 0, max: 7, names: DAY_NAMES, nameBase: 0 },
};

const parseValue = (token: string, spec: FieldSpec): number | null => {
  const upper = token.toUpperCase();
  const nameIndex = spec.names?.indexOf(upper) ?? -1;
  if (nameIndex >= 0) {
    return nameIndex + (spec.nameBase ?? 0);
  }
  if (!/^\d+$/.test(token)) {
    return null;
  }
  const value = Number(token);
  return value >= spec.min && value <= spec.max ? value : null;
};

/** One field into its sorted values, or null when it uses syntax this parser does not cover. */
const parseField = (field: string, spec: FieldSpec): number[] | null => {
  const values = new Set<number>();

  for (const part of field.split(',')) {
    const [rangePart, stepPart, extra] = part.split('/');
    if (extra !== undefined || rangePart === '') {
      return null;
    }
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) {
      return null;
    }

    let start: number;
    let end: number;
    if (rangePart === '*' || rangePart === '?') {
      start = spec.min;
      end = spec.max;
    } else if (rangePart.includes('-')) {
      const [from, to, more] = rangePart.split('-');
      const a = parseValue(from, spec);
      const b = parseValue(to, spec);
      if (more !== undefined || a === null || b === null || a > b) {
        return null;
      }
      start = a;
      end = b;
    } else {
      const value = parseValue(rangePart, spec);
      if (value === null) {
        return null;
      }
      start = value;
      // `5/15` means "from 5, every 15", to the end of the field's range.
      end = stepPart === undefined ? value : spec.max;
    }

    for (let value = start; value <= end; value += step) {
      values.add(value);
    }
  }

  return [...values].sort((a, b) => a - b);
};

export const parseCron = (pattern: string): CronFields | null => {
  const trimmed = pattern.trim();
  const expanded = MACROS[trimmed.toLowerCase()] ?? trimmed;
  const parts = expanded.split(/\s+/);
  if (parts.length !== 5 && parts.length !== 6) {
    return null;
  }
  const [second, minute, hour, dom, month, dow] = parts.length === 6 ? parts : ['0', ...parts];

  const seconds = parseField(second, SPECS.second);
  const minutes = parseField(minute, SPECS.minute);
  const hours = parseField(hour, SPECS.hour);
  const daysOfMonth = parseField(dom, SPECS.dom);
  const months = parseField(month, SPECS.month);
  const daysOfWeek = parseField(dow, SPECS.dow);

  if (!seconds || !minutes || !hours || !daysOfMonth || !months || !daysOfWeek) {
    return null;
  }

  return {
    seconds,
    minutes,
    hours,
    daysOfMonth: new Set(daysOfMonth),
    months: new Set(months),
    daysOfWeek: new Set(daysOfWeek.map((day) => day % 7)),
    anyDayOfMonth: dom === '*' || dom === '?',
    anyDayOfWeek: dow === '*' || dow === '?',
  };
};

const matchesDay = (fields: CronFields, month: number, day: number, weekday: number) => {
  if (!fields.months.has(month)) {
    return false;
  }
  const domMatch = fields.daysOfMonth.has(day);
  const dowMatch = fields.daysOfWeek.has(weekday);
  if (fields.anyDayOfMonth && fields.anyDayOfWeek) {
    return true;
  }
  if (fields.anyDayOfMonth) {
    return dowMatch;
  }
  if (fields.anyDayOfWeek) {
    return domMatch;
  }
  return domMatch || dowMatch;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

const zoneFormatter = (timeZone: string) => {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
};

/**
 * Wall clock minus UTC, in ms, at the instant `ms`. With no zone this is the browser's own offset,
 * which is also what BullMQ falls back to on a server running in the same zone.
 * Throws a RangeError for an unknown zone.
 */
export const zoneOffset = (ms: number, timeZone?: string): number => {
  if (!timeZone) {
    return -new Date(ms).getTimezoneOffset() * 60_000;
  }
  const parts: Record<string, number> = {};
  for (const part of zoneFormatter(timeZone).formatToParts(ms)) {
    if (part.type !== 'literal') {
      parts[part.type] = Number(part.value);
    }
  }
  const wall = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour % 24,
    parts.minute,
    parts.second
  );
  return wall - (ms - (((ms % 1000) + 1000) % 1000));
};

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CronOccurrences {
  times: number[];
  /** More occurrences exist in the window than `cap` allowed through. */
  truncated: boolean;
}

/**
 * Fire times of `fields` in `[from, to]`, in the given time zone, oldest first, at most `cap`.
 * Walks the zone's calendar day by day and only visits the hours and minutes the pattern names,
 * so a sparse schedule over a month costs a few dozen steps rather than 43,200 minutes.
 */
export const cronOccurrences = (
  fields: CronFields,
  from: number,
  to: number,
  timeZone: string | undefined,
  cap: number
): CronOccurrences => {
  const times: number[] = [];
  // The zone's calendar date `from` falls on, as a UTC midnight to walk from.
  const startWall = from + zoneOffset(from, timeZone);
  let dayStart = Math.floor(startWall / DAY_MS) * DAY_MS;
  const lastWall = to + zoneOffset(to, timeZone);

  while (dayStart <= lastWall) {
    const date = new Date(dayStart);
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();

    if (matchesDay(fields, month, day, date.getUTCDay())) {
      // One offset lookup per end of the day; they only differ on a DST change, and only then is
      // each time resolved on its own.
      const offsetAtStart = zoneOffset(dayStart - zoneOffset(dayStart, timeZone), timeZone);
      const offsetAtEnd = zoneOffset(dayStart + DAY_MS - offsetAtStart, timeZone);

      for (const hour of fields.hours) {
        for (const minute of fields.minutes) {
          for (const second of fields.seconds) {
            const wall = dayStart + hour * 3_600_000 + minute * 60_000 + second * 1000;
            const offset =
              offsetAtStart === offsetAtEnd
                ? offsetAtStart
                : zoneOffset(wall - offsetAtStart, timeZone);
            const time = wall - offset;
            if (time < from) {
              continue;
            }
            if (time > to) {
              return { times, truncated: false };
            }
            if (times.length >= cap) {
              return { times, truncated: true };
            }
            times.push(time);
          }
        }
      }
    }

    dayStart += DAY_MS;
  }

  return { times, truncated: false };
};
