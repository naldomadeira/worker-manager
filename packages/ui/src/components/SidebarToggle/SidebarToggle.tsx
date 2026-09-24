import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useSidebar } from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** Collapses the sidebar to icons on desktop and opens it as a drawer on mobile. */
export const SidebarToggle = ({ className }: { className?: string }) => {
  const { t } = useTranslation();
  const { state, isMobile, openMobile, toggleSidebar } = useSidebar();

  const expanded = isMobile ? openMobile : state === 'expanded';
  const label = isMobile
    ? t('HEADER.OPEN_MENU')
    : expanded
      ? t('MENU.COLLAPSE_SIDEBAR')
      : t('MENU.EXPAND_SIDEBAR');
  const Icon = expanded && !isMobile ? PanelLeftClose : PanelLeftOpen;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn('text-muted-foreground hover:text-foreground', className)}
          onClick={toggleSidebar}
          aria-expanded={expanded}
          aria-controls="bull-board-sidebar"
          aria-label={label}
        >
          <Icon aria-hidden="true" className="transition-transform duration-200" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
};
