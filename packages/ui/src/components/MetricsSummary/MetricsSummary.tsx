import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { AnimatedNumber } from '../AnimatedNumber/AnimatedNumber';
import { formatNumber } from './formatNumber';

interface MetricsSummaryProps {
  children: ReactNode;
  className?: string;
}

const tileVariants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] as const } },
};

/** Responsive row of KPI cards; the tiles inside fade up one after another. */
export const MetricsSummary = ({ children, className }: MetricsSummaryProps) => {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className={cn(
        'grid grid-cols-2 gap-3 md:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]',
        className
      )}
      initial={reduceMotion ? false : 'hidden'}
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.06 } } }}
    >
      {children}
    </motion.div>
  );
};

interface StatTileProps {
  /** A number animates between values and is formatted in the board's language; any other
   *  node (a duration, "n/a") is shown as given. */
  value: ReactNode;
  label: string;
  dotColor?: string;
  /** Optional caller-supplied class appended after the base value style, for page-specific overrides (e.g. font-size). */
  valueClassName?: string;
  /** Relative change to show as a trend badge, e.g. 0.12 for +12%. Omit or null for none. */
  trend?: number | null;
  /** Which way is good news: completions going up is, failures going up is not. */
  trendPolarity?: 'up-is-good' | 'up-is-bad';
}

/** Changes smaller than this read as flat rather than as a trend. */
const FLAT_THRESHOLD = 0.005;

const TrendBadge = ({
  trend,
  polarity,
}: {
  trend: number;
  polarity: 'up-is-good' | 'up-is-bad';
}) => {
  const { t, i18n } = useTranslation();
  const direction = Math.abs(trend) < FLAT_THRESHOLD ? 'flat' : trend > 0 ? 'up' : 'down';
  const isGood = direction === 'flat' ? null : (direction === 'up') === (polarity === 'up-is-good');
  const Icon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : Minus;
  const text = formatNumber(trend, i18n.language, {
    style: 'percent',
    maximumFractionDigits: Math.abs(trend) < 0.1 ? 1 : 0,
    signDisplay: 'exceptZero',
  });
  const label = t('METRICS.TREND_LABEL', { value: text });

  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 text-[0.68rem] font-medium tabular-nums',
        isGood === true && 'bg-status-completed/12 text-status-completed',
        isGood === false && 'bg-status-failed/12 text-status-failed',
        isGood === null && 'bg-muted text-muted-foreground'
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {text}
    </span>
  );
};

export const StatTile = ({
  value,
  label,
  dotColor,
  valueClassName,
  trend,
  trendPolarity = 'up-is-good',
}: StatTileProps) => {
  const { i18n } = useTranslation();

  return (
    <motion.div
      variants={tileVariants}
      className="group/stat relative isolate flex min-w-0 flex-col gap-2 overflow-hidden rounded-xl border bg-card p-3.5 shadow-xs transition-shadow hover:shadow-sm"
    >
      {dotColor ? (
        <>
          {/* A faint wash of the series colour, so the tile is tied to its line on the chart
              without shouting. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -top-10 -right-10 -z-10 size-28 rounded-full opacity-[0.09] blur-2xl transition-opacity group-hover/stat:opacity-15"
            style={{ backgroundColor: dotColor }}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-70"
            style={{ backgroundImage: `linear-gradient(90deg, ${dotColor}, transparent 70%)` }}
          />
        </>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {dotColor ? (
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: dotColor }}
            />
          ) : null}
          <span className="truncate">{label}</span>
        </span>
        {trend !== undefined && trend !== null && Number.isFinite(trend) ? (
          <TrendBadge trend={trend} polarity={trendPolarity} />
        ) : null}
      </div>
      <span
        className={cn(
          'font-mono text-2xl leading-none font-semibold tracking-tight text-foreground tabular-nums',
          valueClassName
        )}
      >
        {typeof value === 'number' ? (
          <AnimatedNumber
            value={value}
            animateOnMount={false}
            format={(n) => formatNumber(Number.isInteger(value) ? Math.round(n) : n, i18n.language)}
          />
        ) : (
          value
        )}
      </span>
    </motion.div>
  );
};
