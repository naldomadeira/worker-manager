import React, { PropsWithChildren, ReactElement } from 'react';

/*
 * Content scrolls under this bar. Ending it on a hard opaque edge slices whatever is beneath it
 * mid-card, so the last `--scrim` of the bar's own background fades out instead. The scrim is the
 * bar's bottom padding rather than a pseudo-element below it, so the region it covers is always
 * empty. The gap above the actions row belongs to the row, not to the status tabs: on the job
 * page the row is the whole bar, and there the bar's own bottom padding is the only gap wanted.
 */
export const StickyHeader = React.forwardRef<
  HTMLDivElement,
  PropsWithChildren<{ actions: ReactElement }>
>(({ actions, children }, ref) => (
  <div
    ref={ref}
    className="sticky top-(--header-offset) z-20 -mx-(--body-padding) [--scrim:0.75rem] bg-[linear-gradient(to_bottom,var(--background)_calc(100%-var(--scrim)),transparent)] px-(--body-padding) pb-(--scrim)"
  >
    {children}
    {!!actions && (
      <div className="flex items-center justify-between not-first:pt-3 empty:hidden max-md:flex-col max-md:items-stretch max-md:gap-2">
        {actions}
      </div>
    )}
  </div>
));
