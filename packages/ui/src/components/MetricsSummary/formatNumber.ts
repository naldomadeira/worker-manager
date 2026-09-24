/**
 * Number formatting in the board's language rather than the browser's, so a German board reads
 * "2.000" and an English one "2,000" whatever the OS locale is. An unknown tag (e.g. i18next's
 * `cimode`) falls back to the runtime default instead of throwing.
 */
export function formatNumber(
  value: number,
  locale?: string,
  options?: Intl.NumberFormatOptions
): string {
  try {
    return value.toLocaleString(locale, options);
  } catch {
    return value.toLocaleString(undefined, options);
  }
}

/**
 * Relative change between the first and second half of a bucketed series, e.g. 0.25 for +25%.
 * The in-progress last bucket (today, this hour) is left out when `dropLast` is set, since it
 * only covers part of its period and would drag the second half down. `null` when there is no
 * earlier half to compare against.
 */
export function halfOverHalfTrend(values: number[], dropLast = false): number | null {
  const series = dropLast ? values.slice(0, -1) : values;
  const half = Math.floor(series.length / 2);
  if (half === 0) {
    return null;
  }
  const sum = (items: number[]) => items.reduce((total, item) => total + item, 0);
  const before = sum(series.slice(0, half));
  const after = sum(series.slice(series.length - half));
  if (before === 0) {
    return null;
  }
  return (after - before) / before;
}
