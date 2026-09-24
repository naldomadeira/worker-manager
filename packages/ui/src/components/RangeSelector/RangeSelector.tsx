import { motion, useReducedMotion } from 'motion/react';
import { useId } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

interface RangeSelectorProps<T extends string> {
  ranges: readonly T[];
  value: T;
  onChange: (range: T) => void;
  getLabel: (range: T) => string;
  className?: string;
  /** Names the group for assistive tech when no visible label sits next to it. */
  'aria-label'?: string;
}

/** Spring for the thumb gliding between segments; shared with the chart tab control. */
export const SEGMENT_THUMB_SPRING = { type: 'spring', bounce: 0.18, duration: 0.45 } as const;

/**
 * Segmented control with a sliding thumb. Each segment is a pressed/unpressed toggle button
 * (`aria-pressed`) inside a `group`, not a radio, because that is what the board used before
 * and what assistive tech already announces for these controls. The group is "multiple" only
 * so radix renders toggle buttons; exactly one segment is ever pressed, and pressing the
 * active one again is a no-op rather than clearing the selection.
 */
export const RangeSelector = <T extends string>({
  ranges,
  value,
  onChange,
  getLabel,
  className,
  'aria-label': ariaLabel,
}: RangeSelectorProps<T>) => {
  const thumbId = useId();
  const reduceMotion = useReducedMotion();

  return (
    <ToggleGroup
      type="multiple"
      // A set of mutually exclusive options, not a toolbar of commands.
      role="group"
      aria-label={ariaLabel}
      spacing={0.5}
      size="sm"
      value={[value]}
      onValueChange={(pressed) => {
        const next = pressed.find((range) => range !== value);
        if (next) {
          onChange(next as T);
        }
      }}
      className={cn('rounded-lg bg-muted p-0.5 ring-1 ring-border/40 ring-inset', className)}
    >
      {ranges.map((range) => {
        const active = range === value;
        return (
          <ToggleGroupItem
            key={range}
            value={range}
            className={cn(
              'relative h-6 min-w-0 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors',
              'hover:bg-transparent hover:text-foreground aria-pressed:bg-transparent data-[state=on]:bg-transparent data-[state=on]:text-foreground'
            )}
          >
            {active && (
              <motion.span
                layoutId={`range-thumb-${thumbId}`}
                aria-hidden="true"
                className="absolute inset-0 rounded-md bg-background shadow-xs ring-1 ring-border/70 dark:bg-input/50"
                transition={reduceMotion ? { duration: 0 } : SEGMENT_THUMB_SPRING}
              />
            )}
            <span className="relative z-10">{getLabel(range)}</span>
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
};
