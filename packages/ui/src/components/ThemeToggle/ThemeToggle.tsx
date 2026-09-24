import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { ThemePreference, useSettingsStore } from '../../hooks/useSettings';

export const themeOptions = [
  { value: 'light', icon: Sun, labelKey: 'SETTINGS.THEME_OPTIONS.LIGHT' },
  { value: 'dark', icon: Moon, labelKey: 'SETTINGS.THEME_OPTIONS.DARK' },
  { value: 'system', icon: Monitor, labelKey: 'SETTINGS.THEME_OPTIONS.SYSTEM' },
] as const satisfies readonly { value: ThemePreference; icon: typeof Sun; labelKey: string }[];

/**
 * Light / dark / system picker. It only writes the `theme` setting; `useDarkMode` (mounted once
 * in App) turns that into the `.dark` class on <html>, so the icon swap below is pure CSS keyed
 * on that class and stays correct for "system" too.
 */
export const ThemeToggle = ({ className }: { className?: string }) => {
  const { t } = useTranslation();
  const theme = useSettingsStore((state) => state.theme);
  const setSettings = useSettingsStore((state) => state.setSettings);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn('relative text-muted-foreground hover:text-foreground', className)}
          aria-label={t('SETTINGS.THEME')}
          title={t('SETTINGS.THEME')}
        >
          <Sun
            aria-hidden="true"
            className="scale-100 rotate-0 transition-all duration-500 ease-out dark:scale-0 dark:-rotate-90"
          />
          <Moon
            aria-hidden="true"
            className="absolute scale-0 rotate-90 transition-all duration-500 ease-out dark:scale-100 dark:rotate-0"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {t('SETTINGS.THEME')}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => setSettings({ theme: value as ThemePreference })}
        >
          {themeOptions.map(({ value, icon: Icon, labelKey }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon aria-hidden="true" className="text-muted-foreground" />
              {t(labelKey)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
