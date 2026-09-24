import { animate, useReducedMotion } from 'motion/react';
import { useLayoutEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

export interface AnimatedNumberProps {
  value: number;
  className?: string;
  /** Seconds the count takes to settle on a new value. */
  duration?: number;
  format?: (value: number) => string;
  /**
   * Count up from zero on first render. Off for figures that should paint as the truth straight
   * away and only animate when a later poll changes them.
   */
  animateOnMount?: boolean;
}

const defaultFormat = (value: number) => Math.round(value).toLocaleString();

/**
 * A number that counts from its previous value to the new one. The count writes straight to the
 * DOM node rather than through React state, so it costs no re-renders; it is not a live region,
 * so assistive tech reads whatever the settled figure is when it gets there.
 */
export const AnimatedNumber = ({
  value,
  className,
  duration = 0.9,
  format = defaultFormat,
  animateOnMount = true,
}: AnimatedNumberProps) => {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(animateOnMount ? 0 : value);
  const reduceMotion = useReducedMotion();
  const formatRef = useRef(format);
  formatRef.current = format;

  // A layout effect, so the first figure is in place before paint. The node has no React
  // children: this effect is the only writer of its text.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    const from = shown.current;
    if (reduceMotion || from === value) {
      shown.current = value;
      node.textContent = formatRef.current(value);
      return;
    }

    node.textContent = formatRef.current(from);
    const controls = animate(from, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => {
        shown.current = latest;
        node.textContent = formatRef.current(latest);
      },
    });

    return () => controls.stop();
  }, [value, duration, reduceMotion]);

  return <span ref={ref} className={cn('tabular-nums', className)} />;
};
