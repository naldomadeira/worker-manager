/**
 * An elapsed time as a rounded, unit-labelled amount in the dashboard language: "5 seconds",
 * "3 minutes", "2 days". `Intl.RelativeTimeFormat` would frame it as "ago"/"in", and stripping
 * that suffix only ever worked in English.
 */
export function formatElapsed(seconds: number, locale: string): string {
  const units: [Intl.NumberFormatOptions['unit'], number][] = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  const [unit, size] = units.find(([, size]) => seconds >= size) ?? ['second', 1];

  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit,
    unitDisplay: 'long',
    maximumFractionDigits: 0,
  }).format(Math.round(seconds / size));
}
