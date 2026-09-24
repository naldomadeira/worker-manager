import React, { PropsWithChildren } from 'react';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { useMobileQuery } from '../../hooks/useMobileQuery';
import { useSettingsStore } from '../../hooks/useSettings';
import { BrandMark } from '../BrandMark/BrandMark';
import { CommandPalette } from '../CommandPalette/CommandPalette';
import { Header } from '../Header/Header';
import { HeaderActions } from '../HeaderActions/HeaderActions';
import { Menu } from '../Menu/Menu';
import { SidebarToggle } from '../SidebarToggle/SidebarToggle';
import { Title } from '../Title/Title';

/**
 * Sidebar (brand, navigation, queue tree) beside a content column whose sticky header carries the
 * breadcrumb and board-wide actions. The window is the scroll container, so sticky page headers
 * and scroll-to-top on navigation keep working as they did before the shell existed.
 *
 * The sidebar's expanded/collapsed state is the persisted `sidebarCollapsed` setting, and its
 * width follows `--menu-width`, which `uiConfig.menu.width` overrides.
 */
export const AppShell = ({ children }: PropsWithChildren) => {
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const setSettings = useSettingsStore((state) => state.setSettings);
  const isMobile = useMobileQuery();

  return (
    <SidebarProvider
      open={!sidebarCollapsed}
      onOpenChange={(open) => setSettings({ sidebarCollapsed: !open })}
      style={{ '--sidebar-width': 'var(--menu-width, 16rem)' } as React.CSSProperties}
    >
      <Menu />
      <SidebarInset className="min-w-0">
        <Header>
          <SidebarToggle className="-ml-1" />
          {isMobile ? (
            <BrandMark className="size-7" />
          ) : (
            <Separator orientation="vertical" className="mr-1 h-5!" />
          )}
          <Title />
          <HeaderActions />
        </Header>
        <div className="w-full min-w-0 flex-1 p-(--body-padding)">{children}</div>
      </SidebarInset>
      <CommandPalette />
    </SidebarProvider>
  );
};
