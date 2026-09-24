import { PointerEvent, ReactNode, useState } from 'react';
import { Link, LinkProps } from 'react-router-dom';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { cn } from '@/lib/utils';

export interface HoverPanelRow {
  id: string;
  /** Any CSS colour, usually a status token. */
  color: string;
  label: string;
  value: ReactNode;
  /** Turns the row into a link to a filtered view. */
  to?: LinkProps['to'];
}

interface HoverPanelProps {
  rows: HoverPanelRow[];
  /** Accessible name for the trigger, since the trigger itself is a graphic. */
  triggerLabel: string;
  children: ReactNode;
  className?: string;
}

const rowClass =
  'flex items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground no-underline transition-colors';

/**
 * Hover panel matching the look of the chart tooltips, for detail that does not fit
 * on a surface. Built on HoverCard rather than Tooltip so the rows stay reachable
 * with the pointer and can be links.
 */
export const HoverPanel = ({ rows, triggerLabel, children, className }: HoverPanelProps) => {
  const [open, setOpen] = useState(false);

  /**
   * HoverCard opens on hover only, which leaves the panel unreachable on a touch screen. A tap
   * opens it there instead. Mouse presses are left alone so a click on an already-hovered
   * trigger does not close the panel out from under the pointer.
   */
  const openOnTap = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse') {
      return;
    }

    setOpen((isOpen) => !isOpen);
  };

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={140} closeDelay={80}>
      <HoverCardTrigger asChild>
        {/* Padding widens the pointer target around a thin graphic, the negative margin keeps
            it from changing the surrounding layout. */}
        <button
          type="button"
          aria-label={triggerLabel}
          aria-expanded={open}
          className={cn(
            'relative z-[2] -my-1.5 block w-full cursor-default rounded-sm py-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
            className
          )}
          onPointerUp={openOnTap}
        >
          {children}
        </button>
      </HoverCardTrigger>
      {/* Opens downward so it never covers the title of the surface it belongs to. */}
      <HoverCardContent
        side="bottom"
        align="start"
        sideOffset={8}
        className="w-auto min-w-44 rounded-xl p-1.5 text-xs shadow-popover"
      >
        {rows.map((row) => {
          const content = (
            <>
              <span
                className="size-2.5 shrink-0 rounded-[3px]"
                style={{ backgroundColor: row.color }}
              />
              <span className="flex-1 whitespace-nowrap">{row.label}</span>
              <span className="ml-4 font-mono font-semibold text-foreground tabular-nums">
                {row.value}
              </span>
            </>
          );

          return row.to ? (
            <Link
              key={row.id}
              to={row.to}
              className={cn(
                rowClass,
                'hover:bg-state-hover hover:text-foreground focus-visible:bg-state-hover focus-visible:text-foreground focus-visible:outline-none'
              )}
            >
              {content}
            </Link>
          ) : (
            <div key={row.id} className={rowClass}>
              {content}
            </div>
          );
        })}
      </HoverCardContent>
    </HoverCard>
  );
};
