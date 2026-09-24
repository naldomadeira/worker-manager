import React from 'react';
import { cn } from '@/lib/utils';

export type CardProps = React.ComponentProps<'div'>;

/**
 * The board's surface: a bordered, lightly raised panel. A flex row with the theme's
 * `--card-padding`, like the legacy card, so existing layouts keep their spacing. Forwards its
 * ref and every div prop, which lets it act as the rendered element of another primitive.
 */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="legacy-card"
    className={cn(
      'flex min-w-0 rounded-xl border bg-card p-(--card-padding) text-card-foreground shadow-xs transition-shadow duration-200',
      className
    )}
    {...props}
  />
));

Card.displayName = 'Card';
