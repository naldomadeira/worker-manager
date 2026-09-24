import type { UIConfig } from '@worker-manager/api/typings/app';
import { ExternalLink, LayoutGrid } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

type CustomLinksDropdownProps = {
  options: UIConfig['miscLinks'];
  className?: string;
};

export const CustomLinksDropdown = ({ options = [], className }: CustomLinksDropdownProps) => {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn('text-muted-foreground hover:text-foreground', className)}
          aria-label={t('HEADER.LINKS')}
          title={t('HEADER.LINKS')}
        >
          <LayoutGrid aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {options.map((option) => (
          <DropdownMenuItem key={option.url} asChild>
            <a href={option.url} className="group/link">
              {!!option.icon && <img src={option.icon} alt="" className="size-4 object-contain" />}
              <span className="flex-1 truncate">{option.text}</span>
              {/^https?:\/\//.test(option.url) && (
                <ExternalLink
                  aria-hidden="true"
                  className="size-3.5 opacity-0 transition-opacity group-focus/link:opacity-60 group-hover/link:opacity-60"
                />
              )}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
