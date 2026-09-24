import { motion, useReducedMotion } from 'motion/react';
import { useId } from 'react';
import { cn } from '@/lib/utils';

export interface SparklineSeries {
  values: number[];
  /** A CSS colour, normally a token: `var(--status-completed)`. */
  color: string;
  /** Fill the area under the line with a fading gradient. */
  area?: boolean;
}

export interface SparklineProps {
  series: SparklineSeries[];
  width?: number;
  height?: number;
  className?: string;
}

const PAD = 2;

/**
 * A tiny, axis-free trend line for table cells. Plain SVG rather than Recharts: a board can list
 * dozens of queues, and a full chart instance per row costs far more than a path. All series
 * share one Y scale so a failure line sits honestly under its completions. Decorative only
 * (`aria-hidden`): the numbers beside it in the row carry the same information in text.
 */
export const Sparkline = ({ series, width = 112, height = 28, className }: SparklineProps) => {
  const gradientPrefix = useId();
  const reduceMotion = useReducedMotion();
  const length = Math.max(0, ...series.map((s) => s.values.length));
  const max = Math.max(0, ...series.flatMap((s) => s.values));

  const x = (i: number) => (length > 1 ? PAD + (i / (length - 1)) * (width - PAD * 2) : width / 2);
  const y = (v: number) => (max > 0 ? height - PAD - (v / max) * (height - PAD * 2) : height - PAD);

  const linePath = (values: number[]) =>
    values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ');

  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('block overflow-visible', className)}
    >
      {/* Baseline, so an all-zero queue still reads as "flat", not "missing". */}
      <line
        x1={PAD}
        x2={width - PAD}
        y1={height - PAD}
        y2={height - PAD}
        stroke="var(--border)"
        strokeDasharray="2 3"
      />
      {length > 1 &&
        series.map((s, index) => {
          const d = linePath(s.values);
          const gradientId = `${gradientPrefix}-${index}`;
          return (
            <g key={index}>
              {s.area && (
                <>
                  <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <motion.path
                    d={`${d} L${x(s.values.length - 1).toFixed(2)},${height - PAD} L${x(0).toFixed(2)},${height - PAD} Z`}
                    fill={`url(#${gradientId})`}
                    initial={reduceMotion ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.6, delay: 0.2 }}
                  />
                </>
              )}
              <motion.path
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={reduceMotion ? false : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              />
            </g>
          );
        })}
    </svg>
  );
};
