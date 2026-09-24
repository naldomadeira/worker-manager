import { PropsWithChildren } from 'react';
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export { TooltipProvider };

interface TooltipProps {
  title: string;
  className?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

/**
 * Wraps its children in an inline trigger, so any content (a badge, an icon, a button) gains a
 * tooltip without having to forward refs. Opens on hover and keyboard focus, closes on Escape.
 */
export const Tooltip = ({
  title,
  className,
  side = 'top',
  children,
}: PropsWithChildren<TooltipProps>) => (
  <UITooltip delayDuration={300}>
    <TooltipTrigger asChild>
      <span className={cn('relative inline-flex', className)}>{children}</span>
    </TooltipTrigger>
    <TooltipContent side={side} sideOffset={6}>
      {title}
    </TooltipContent>
  </UITooltip>
);
