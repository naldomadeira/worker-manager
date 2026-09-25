import type { DateFormats } from '@worker-manager/api/typings/app';
import { formatDate } from '../../../utils/formatDate';
import { formatElapsed } from '../../../utils/formatElapsed';

/** A duration pg-boss stores in seconds, in the board's language. */
export function formatSeconds(seconds: number | null | undefined, locale: string): string {
  if (seconds === null || seconds === undefined) return '-';
  return formatElapsed(seconds, locale);
}

/** An ISO timestamp from the API, in the board's date format. */
export function formatIso(
  value: string | null | undefined,
  locale: string,
  dateFormats?: DateFormats
): string {
  if (!value) return '-';
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? value : formatDate(ts, locale, dateFormats);
}
