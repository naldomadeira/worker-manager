import { useReducedMotion } from 'motion/react';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A small shadcn `chart`-style kit for the board's Recharts charts. It carries no chart logic of
 * its own: it only gives every chart the same frame, axis/grid/cursor recipe, tooltip card and
 * legend marks, so throughput and latency read as one family in both themes. Colours are always
 * passed in as CSS custom properties (`var(--status-completed)`, `var(--chart-2)`), never hex, so
 * the `uiConfig.theme` overrides and the dark theme retint them for free.
 */
export function ChartContainer({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="chart"
      className={cn(
        'flex w-full min-w-0 flex-col gap-3 text-xs',
        '[&_.recharts-surface]:outline-hidden [&_.recharts-wrapper]:outline-hidden [&_.recharts-layer]:outline-hidden',
        '[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground',
        className
      )}
      {...props}
    />
  );
}

export const CHART_AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 11 } as const;

/** Hairline, dashed and horizontal only: enough to read a value off, never a grid to look at. */
export const CHART_GRID = {
  vertical: false,
  stroke: 'var(--border)',
  strokeDasharray: '3 4',
  strokeOpacity: 0.9,
} as const;

export const CHART_CURSOR = {
  stroke: 'var(--muted-foreground)',
  strokeWidth: 1,
  strokeOpacity: 0.35,
  strokeDasharray: '3 3',
} as const;

/** Active point: a filled dot lifted off the plot by a ring in the card colour. */
export const chartActiveDot = (color: string) => ({
  r: 4,
  strokeWidth: 2,
  stroke: 'var(--card)',
  fill: color,
});

/** Series draw in on mount and morph between refreshes, unless the viewer asked for less motion. */
export function useChartAnimation() {
  const reduceMotion = useReducedMotion();
  return {
    isAnimationActive: !reduceMotion,
    animationDuration: 700,
    animationEasing: 'ease-out' as const,
  };
}

type IndicatorVariant = 'dot' | 'line' | 'dashed';

interface ChartIndicatorProps {
  color: string;
  variant?: IndicatorVariant;
  /** Line indicators only: mirrors the series' stroke width. */
  thickness?: number;
  className?: string;
}

export function ChartIndicator({
  color,
  variant = 'dot',
  thickness = 2,
  className,
}: ChartIndicatorProps) {
  const style: CSSProperties =
    variant === 'dashed'
      ? { borderColor: color }
      : variant === 'line'
        ? { backgroundColor: color, height: `${thickness}px` }
        : { backgroundColor: color };

  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block shrink-0',
        variant === 'dot' && 'size-2.5 rounded-[3px]',
        variant === 'line' && 'w-3.5 rounded-full',
        variant === 'dashed' &&
          'size-2.5 rounded-[3px] border-[1.5px] border-dashed bg-transparent',
        className
      )}
      style={style}
    />
  );
}

export function ChartTooltipCard({
  label,
  children,
  className,
}: {
  label?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'pointer-events-none grid min-w-40 gap-1.5 rounded-lg border border-border/70 bg-popover/95 px-3 py-2 text-xs whitespace-nowrap text-popover-foreground shadow-popover backdrop-blur-sm',
        className
      )}
    >
      {label ? <div className="font-medium text-foreground">{label}</div> : null}
      <div className="grid gap-1">{children}</div>
    </div>
  );
}

export function ChartTooltipItem({
  color,
  name,
  value,
  unit,
  variant = 'dot',
}: {
  color: string;
  name: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  variant?: IndicatorVariant;
}) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <ChartIndicator color={color} variant={variant} />
      <span className="flex-1">{name}</span>
      <span className="ml-4 font-mono font-medium text-foreground tabular-nums">
        {value}
        {unit ? (
          <span className="ml-0.5 font-sans font-normal text-muted-foreground">{unit}</span>
        ) : null}
      </span>
    </div>
  );
}

export function ChartTooltipNote({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-56 text-[0.7rem] whitespace-normal text-muted-foreground italic">
      {children}
    </div>
  );
}

export function ChartTooltipSeparator() {
  return <div className="my-0.5 h-px bg-border" />;
}

export function ChartLegend({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="chart-legend"
      className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5', className)}
      {...props}
    />
  );
}

/** A static legend entry. Toggleable entries (the latency legend) render their own buttons. */
export function ChartLegendItem({
  color,
  variant,
  thickness,
  children,
}: ChartIndicatorProps & { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <ChartIndicator color={color} variant={variant} thickness={thickness} />
      {children}
    </span>
  );
}
