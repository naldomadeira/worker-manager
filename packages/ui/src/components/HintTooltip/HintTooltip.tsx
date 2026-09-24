import type { ReactElement, ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface HintTooltipProps {
  title: ReactNode;
  /** A single element that accepts a ref, such as a Button; it becomes the trigger. */
  children: ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
  delay?: number;
}

/**
 * A short hover/focus hint on top of the shadcn Tooltip. It carries its own provider so it
 * works wherever it is rendered, including tests and portals outside the app shell.
 */
export const HintTooltip = ({ title, children, side = 'top', delay = 300 }: HintTooltipProps) => {
  if (title === '' || title == null) {
    return children;
  }

  return (
    <TooltipProvider delayDuration={delay}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} sideOffset={6} className="whitespace-pre-line">
          {title}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
