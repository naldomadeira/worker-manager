// A small next-occurrence calculator for the demo's schedules, standing in for pg-boss's
// `previewSchedule()`. It covers 5- and 6-field cron and the common RRULE parts (FREQ, INTERVAL,
// BYDAY, BYHOUR, BYMINUTE, BYMONTHDAY, DTSTART), evaluated minute by minute at the time zone's
// current offset. Good enough to draw a believable table; not a replacement for the real parser.

const MINUTE = 60_000;
/** Search a year ahead at most, so an impossible date (31 February) ends instead of spinning. */
const HORIZON_MINUTES = 366 * 24 * 60;

type FieldSet = Set<number> | null; // null matches anything

interface Matcher {
  minutes: FieldSet;
  hours: FieldSet;
  monthDays: FieldSet;
  months: FieldSet;
  weekDays: FieldSet;
  /** Standard cron: when both day fields are restricted, either one matching is enough. */
  dayOr: boolean;
}

export class InvalidScheduleError extends Error {}

const DAY_NAMES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const CRON_DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function parseCronField(field: string, min: number, max: number, names?: string[]): FieldSet {
  if (field === '*' || field === '?') return null;
  const values = new Set<number>();
  for (const part of field.split(',')) {
    const [range, stepText] = part.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new InvalidScheduleError(field);
    const value = (text: string) => {
      const named = names?.indexOf(text.toUpperCase()) ?? -1;
      const number = named >= 0 ? named : Number(text);
      if (!Number.isInteger(number)) throw new InvalidScheduleError(field);
      return number;
    };
    let from: number;
    let to: number;
    if (range === '*') {
      from = min;
      to = max;
    } else if (range.includes('-')) {
      const [a, b] = range.split('-');
      from = value(a);
      to = value(b);
    } else {
      from = value(range);
      to = stepText === undefined ? from : max;
    }
    if (from < min || to > max || from > to) throw new InvalidScheduleError(field);
    for (let current = from; current <= to; current += step) values.add(current);
  }
  return values;
}

function cronMatcher(expression: string): Matcher {
  let fields = expression.trim().split(/\s+/);
  if (fields.length === 6) fields = fields.slice(1); // seconds add no precision below a minute
  if (fields.length !== 5) throw new InvalidScheduleError(expression);
  const [minute, hour, monthDay, month, weekDay] = fields;
  const weekDays = parseCronField(weekDay, 0, 7, CRON_DAY_NAMES);
  if (weekDays?.has(7)) weekDays.add(0);
  return {
    minutes: parseCronField(minute, 0, 59),
    hours: parseCronField(hour, 0, 23),
    monthDays: parseCronField(monthDay, 1, 31),
    months: parseCronField(month, 1, 12),
    weekDays,
    dayOr: monthDay !== '*' && weekDay !== '*',
  };
}

function rruleMatcher(expression: string): Matcher {
  const lines = expression
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  let start: Date | null = null;
  let rule = '';
  for (const line of lines) {
    if (line.startsWith('DTSTART')) {
      const value = line.split(':').pop() ?? '';
      const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
      if (!match) throw new InvalidScheduleError(line);
      const [, y, mo, d, h, mi] = match.map(Number);
      start = new Date(Date.UTC(y, mo - 1, d, h, mi));
    } else if (line.startsWith('RRULE:')) {
      rule = line.slice('RRULE:'.length);
    } else if (line.includes('FREQ=')) {
      rule = line;
    } else {
      throw new InvalidScheduleError(line);
    }
  }
  const parts = Object.fromEntries(
    rule.split(';').map((part) => {
      const [name, value] = part.split('=');
      if (!name || value === undefined) throw new InvalidScheduleError(part);
      return [name.toUpperCase(), value];
    })
  );
  const freq = parts.FREQ;
  const levels = ['MINUTELY', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
  if (!levels.includes(freq)) throw new InvalidScheduleError(rule);
  const interval = parts.INTERVAL ? Number(parts.INTERVAL) : 1;
  if (!Number.isInteger(interval) || interval < 1) throw new InvalidScheduleError(rule);

  const list = (text: string | undefined, min: number, max: number): FieldSet => {
    if (!text) return null;
    return new Set(
      text.split(',').map((item) => {
        const number = Number(item);
        if (!Number.isInteger(number) || number < min || number > max) {
          throw new InvalidScheduleError(item);
        }
        return number;
      })
    );
  };
  const every = (max: number, step: number) =>
    new Set(Array.from({ length: Math.ceil(max / step) }, (_, i) => i * step));

  const at = start ?? new Date(Date.UTC(2026, 0, 1, 0, 0));
  const level = levels.indexOf(freq);
  const byDay = parts.BYDAY
    ? new Set(
        parts.BYDAY.split(',').map((day: string) => {
          const index = DAY_NAMES.indexOf(day.slice(-2).toUpperCase());
          if (index === -1) throw new InvalidScheduleError(day);
          return index;
        })
      )
    : null;

  return {
    minutes:
      list(parts.BYMINUTE, 0, 59) ??
      (level === 0 ? every(60, interval) : new Set([at.getUTCMinutes()])),
    hours:
      list(parts.BYHOUR, 0, 23) ??
      (level === 0 ? null : level === 1 ? every(24, interval) : new Set([at.getUTCHours()])),
    monthDays:
      list(parts.BYMONTHDAY, 1, 31) ?? (level >= 4 && !byDay ? new Set([at.getUTCDate()]) : null),
    months: level === 5 ? new Set([at.getUTCMonth() + 1]) : null,
    weekDays: byDay ?? (level === 3 ? new Set([at.getUTCDay()]) : null),
    dayOr: false,
  };
}

export function scheduleKind(expression: string): 'cron' | 'rrule' {
  return /[=:;]/.test(expression) ? 'rrule' : 'cron';
}

/** The zone's offset from UTC right now, in minutes. Throws on an unknown zone. */
function zoneOffsetMinutes(timeZone: string, at: number): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    }).formatToParts(new Date(at));
  } catch {
    throw new InvalidScheduleError(timeZone);
  }
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((local - Math.floor(at / MINUTE) * MINUTE) / MINUTE);
}

const has = (set: FieldSet, value: number) => set === null || set.has(value);

/** The next `count` occurrences after `from`, as ISO strings. Throws InvalidScheduleError. */
export function nextRuns(
  expression: string,
  { tz = 'UTC', count = 5, from = Date.now() }: { tz?: string; count?: number; from?: number } = {}
): string[] {
  const matcher =
    scheduleKind(expression) === 'rrule' ? rruleMatcher(expression) : cronMatcher(expression);
  const offset = zoneOffsetMinutes(tz, from);
  const runs: string[] = [];
  let minute = Math.floor(from / MINUTE) + 1;
  for (let step = 0; step < HORIZON_MINUTES && runs.length < count; step++, minute++) {
    const local = new Date((minute + offset) * MINUTE);
    if (!has(matcher.minutes, local.getUTCMinutes())) continue;
    if (!has(matcher.hours, local.getUTCHours())) continue;
    if (!has(matcher.months, local.getUTCMonth() + 1)) continue;
    const monthDay = has(matcher.monthDays, local.getUTCDate());
    const weekDay = has(matcher.weekDays, local.getUTCDay());
    if (matcher.dayOr ? !(monthDay || weekDay) : !(monthDay && weekDay)) continue;
    runs.push(new Date(minute * MINUTE).toISOString());
  }
  return runs;
}
