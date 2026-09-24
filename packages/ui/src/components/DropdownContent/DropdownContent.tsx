import React from 'react';
import { DropdownMenuContent } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export type DropdownContentProps = React.ComponentProps<typeof DropdownMenuContent>;

/**
 * The board's menu surface: a `DropdownMenuContent` (portalled, positioned, animated) that sizes
 * to its items instead of to the trigger, since most triggers here are icon buttons. Use it
 * inside a shadcn `DropdownMenu`, with `DropdownMenuItem`s as children.
 */
export const DropdownContent = React.forwardRef<HTMLDivElement, DropdownContentProps>(
  ({ className, align = 'end', sideOffset = 6, ...props }, ref) => (
    <DropdownMenuContent
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'w-auto min-w-44 max-h-[min(50svh,var(--radix-dropdown-menu-content-available-height))] rounded-xl p-1.5 shadow-popover [&_[role=menuitem]>img]:size-4 [&_[role=menuitem]>img]:object-contain',
        className
      )}
      {...props}
    />
  )
);

DropdownContent.displayName = 'DropdownContent';
