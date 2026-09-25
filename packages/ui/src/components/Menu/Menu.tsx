import {
  CalendarClock,
  ChevronsDownUp,
  ChevronsUpDown,
  ExternalLink,
  LayoutDashboard,
  Layers,
  LineChart,
  SearchIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { Kbd } from '@/components/ui/kbd';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useBoardNavigation } from '../../hooks/useBoardNavigation';
import { useMenuState } from '../../hooks/useMenuState';
import { useQueueSearch } from '../../hooks/useQueueSearch';
import { focusQueueSearch } from '../../hooks/useSearchHotkey';
import { useSettingsStore } from '../../hooks/useSettings';
import { useUIConfig } from '../../hooks/useUIConfig';
import { links } from '../../utils/links';
import { collectGroupPaths, toTree } from '../../utils/toTree';
import { BrandMark, useBoardBrand } from '../BrandMark/BrandMark';
import { GitHub } from '../Icons/GitHub';
import { MenuTree } from './MenuTree/MenuTree';

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/.test(navigator.platform || '');
export const searchShortcut = isMac ? '⌘K' : 'Ctrl K';

const SIDEBAR_ID = 'worker-manager-sidebar';

type NavEntry = { to: string; label: string; icon: typeof LayoutDashboard; exact?: boolean };

const iconButton =
  'inline-flex size-6 items-center justify-center rounded-md text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-30 [&>svg]:size-3.5';

export const Menu = () => {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { queues, showSchedules: showJobSchedulers } = useBoardNavigation();
  const sortQueues = useSettingsStore((state) => state.sortQueues);
  const { searchTerm, setSearchTerm } = useQueueSearch();
  const { hasHistoryProvider = false } = useUIConfig();
  const brand = useBoardBrand();
  const { isMobile, setOpenMobile } = useSidebar();

  const expandAll = useMenuState((state) => state.expandAll);
  const collapseAll = useMenuState((state) => state.collapseAll);

  const tree = toTree(
    queues?.filter((queue) =>
      queue.name?.toLowerCase().includes(searchTerm?.toLowerCase() as string)
    ) || [],
    sortQueues
  );

  const groupPaths = useMemo(() => collectGroupPaths(tree), [tree]);
  const hasGroups = groupPaths.length > 0;
  const { allExpanded, allCollapsed } = useMenuState(
    useShallow((state) => ({
      allExpanded: hasGroups && groupPaths.every((p) => state.isMenuOpen(p)),
      allCollapsed: hasGroups && groupPaths.every((p) => !state.isMenuOpen(p)),
    }))
  );
  const nav: NavEntry[] = [
    { to: '/', label: t('MENU.OVERVIEW'), icon: LayoutDashboard, exact: true },
    ...(showJobSchedulers
      ? [{ to: links.jobSchedulers().pathname, label: t('MENU.SCHEDULERS'), icon: CalendarClock }]
      : []),
    ...(hasHistoryProvider
      ? [{ to: links.metricsHistory().pathname, label: t('MENU.METRICS_HISTORY'), icon: LineChart }]
      : []),
  ];

  /* The mobile drawer should get out of the way once a destination is picked. */
  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <Sidebar collapsible="icon" id={SIDEBAR_ID}>
        <SidebarHeader className="h-(--header-offset) max-md:h-auto justify-center border-b border-sidebar-border px-2 py-0 max-md:py-3">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                size="lg"
                tooltip={brand.title}
                className="gap-2.5 hover:bg-sidebar-accent/60"
              >
                <Link to="/" onClick={closeOnMobile}>
                  <BrandMark className="transition-transform duration-300 group-hover/menu-button:scale-105" />
                  <span className="grid min-w-0 flex-1 text-left leading-tight">
                    <span className="truncate text-sm font-semibold tracking-tight">
                      {brand.title}
                    </span>
                    {!!process.env.APP_VERSION && (
                      <span className="truncate text-[0.7rem] text-sidebar-foreground/60">
                        v{process.env.APP_VERSION}
                      </span>
                    )}
                  </span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>{t('MENU.NAVIGATION')}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {nav.map(({ to, label, icon: Icon, exact }) => {
                  const isActive = exact ? pathname === to : pathname.startsWith(to);
                  return (
                    <SidebarMenuItem key={to}>
                      <SidebarMenuButton asChild isActive={isActive} tooltip={label}>
                        <NavLink
                          to={to}
                          exact={exact}
                          aria-current={isActive ? 'page' : undefined}
                          onClick={closeOnMobile}
                        >
                          <Icon aria-hidden="true" />
                          {label}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
                {/* In icon mode the queue tree is hidden; this reopens the sidebar on its filter. */}
                <SidebarMenuItem className="hidden group-data-[collapsible=icon]:block">
                  <SidebarMenuButton
                    tooltip={t('MENU.QUEUES')}
                    aria-label={t('MENU.QUEUES')}
                    onClick={focusQueueSearch}
                  >
                    <Layers aria-hidden="true" />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarSeparator className="group-data-[collapsible=icon]:hidden" />

          <SidebarGroup className="min-h-0 flex-1 group-data-[collapsible=icon]:hidden">
            <div className="flex h-8 items-center justify-between px-2">
              <span className="text-xs font-medium tracking-wider text-sidebar-foreground/70 uppercase">
                {t('MENU.QUEUES')}
              </span>
              {hasGroups && (
                <span className="flex items-center gap-0.5">
                  <button
                    type="button"
                    className={iconButton}
                    onClick={() => expandAll(groupPaths)}
                    title={t('MENU.EXPAND_ALL')}
                    aria-label={t('MENU.EXPAND_ALL')}
                    disabled={allExpanded}
                  >
                    <ChevronsUpDown aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={iconButton}
                    onClick={() => collapseAll(groupPaths)}
                    title={t('MENU.COLLAPSE_ALL')}
                    aria-label={t('MENU.COLLAPSE_ALL')}
                    disabled={allCollapsed}
                  >
                    <ChevronsDownUp aria-hidden="true" />
                  </button>
                </span>
              )}
            </div>

            <div className="relative mb-2 px-0.5">
              <SearchIcon
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <SidebarInput
                type="search"
                id="search-queues"
                aria-label={t('MENU.SEARCH_INPUT_PLACEHOLDER')}
                placeholder={t('MENU.SEARCH_INPUT_PLACEHOLDER')}
                value={searchTerm}
                onChange={({ currentTarget }) => setSearchTerm(currentTarget.value)}
                className="pr-14 pl-8 text-[0.8125rem] transition-shadow [&::-webkit-search-cancel-button]:hidden"
              />
              <Kbd
                aria-hidden="true"
                className="absolute top-1/2 right-2 -translate-y-1/2 border border-sidebar-border bg-sidebar-accent font-mono text-[0.65rem]"
              >
                {searchShortcut}
              </Kbd>
            </div>

            <nav
              aria-label={t('MENU.QUEUES')}
              className={cn(
                'no-scrollbar -mx-2 min-h-0 flex-1 overflow-y-auto px-2 pb-2',
                '[mask-image:linear-gradient(to_bottom,transparent,black_0.5rem,black_calc(100%-1rem),transparent)]'
              )}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest('a')) closeOnMobile();
              }}
            >
              {tree.children.length > 0 ? (
                <MenuTree tree={tree} />
              ) : (
                !!searchTerm && (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                    {t('MENU.FILTER_EMPTY')}
                  </p>
                )
              )}
            </nav>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="border-t border-sidebar-border">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                size="sm"
                tooltip={t('MENU.RELEASES')}
                className="text-sidebar-foreground/60 hover:text-sidebar-foreground"
              >
                <a target="_blank" rel="noreferrer" href={process.env.WORKER_MANAGER_REPO}>
                  <GitHub aria-hidden="true" />
                  <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                    <span className="truncate">{t('MENU.RELEASES')}</span>
                    <span className="flex items-center gap-1 font-mono text-[0.7rem] tabular-nums">
                      {process.env.APP_VERSION}
                      <ExternalLink aria-hidden="true" className="size-3!" />
                    </span>
                  </span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
    </TooltipProvider>
  );
};
