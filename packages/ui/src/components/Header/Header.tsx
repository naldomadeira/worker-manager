import React, { PropsWithChildren, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useMobileQuery } from '../../hooks/useMobileQuery';
import { useSettingsStore } from '../../hooks/useSettings';
import { useUIConfig } from '../../hooks/useUIConfig';
import { MobileQueueDropdown } from './MobileQueueDropdown/MobileQueueDropdown';

/**
 * The bar above the page content. It is sticky inside the sidebar inset, so it spans the content
 * column only and the sidebar (with the brand) runs full height beside it.
 *
 * Its height is `--header-offset`: `--header-height` plus the environment badge when one shows.
 * Sticky page headers and the overview's sticky group headers pin themselves below that offset.
 */
export const Header = ({ children }: PropsWithChildren<any>) => {
  const uiConfig = useUIConfig();
  const showEnvBadge = useSettingsStore((state) => state.showEnvBadge);
  const isMobile = useMobileQuery();
  const environment = showEnvBadge ? uiConfig.environment : undefined;

  useEffect(() => {
    if (!environment) {
      return;
    }

    // On body, not the root element: `--header-offset` is declared on `:root, .dark`, so a value
    // on the root element could lose to it inside body.
    const { style } = document.body;
    const badgeHeight = `calc(${environment.fontSize ?? '0.75rem'} * 1.5)`;
    style.setProperty('--header-offset', `calc(var(--header-height) + ${badgeHeight})`);

    return () => {
      style.removeProperty('--header-offset');
    };
  }, [environment]);

  return (
    <header
      data-env-badge={!!environment || undefined}
      className={cn(
        'sticky top-0 z-30 flex h-(--header-offset) shrink-0 flex-col border-b border-border',
        'bg-background/85 backdrop-blur-md supports-backdrop-filter:bg-background/70',
        !!environment && 'withEnvBadge'
      )}
      style={
        {
          '--badge-bg': environment?.color,
          '--badge-color': environment?.textColor,
          '--badge-font-size': environment?.fontSize,
        } as React.CSSProperties
      }
    >
      {!!environment && (
        <div
          className={cn(
            'flex h-[calc(var(--badge-font-size,0.75rem)*1.5)] shrink-0 items-center justify-center gap-1.5 px-4 select-none',
            'bg-[var(--badge-bg,var(--muted))] text-[length:var(--badge-font-size,0.75rem)] leading-none font-semibold tracking-wide text-[var(--badge-color,var(--foreground))] uppercase',
            'animate-in duration-500 fade-in-0 slide-in-from-top-1'
          )}
        >
          <span
            aria-hidden="true"
            className="size-1.5 animate-pulse rounded-full bg-current opacity-70"
          />
          {environment.label}
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 items-center gap-2 px-3 md:px-6">{children}</div>

      {isMobile && (
        <div className="shrink-0 px-3 pb-2">
          <MobileQueueDropdown />
        </div>
      )}
    </header>
  );
};
