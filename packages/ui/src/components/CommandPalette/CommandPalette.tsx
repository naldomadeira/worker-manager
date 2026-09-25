import { CalendarClock, CornerDownLeft, Layers, LayoutDashboard, LineChart } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHistory } from 'react-router-dom';
import { create } from 'zustand';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { useQueues } from '../../hooks/useQueues';
import { useSearchHotkey } from '../../hooks/useSearchHotkey';
import { useSettingsStore } from '../../hooks/useSettings';
import { useUIConfig } from '../../hooks/useUIConfig';
import { links } from '../../utils/links';
import { themeOptions } from '../ThemeToggle/ThemeToggle';

type CommandPaletteState = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
};

/** Shared open state, so the header's search button and the Cmd/Ctrl+K hotkey drive one dialog. */
export const useCommandPalette = create<CommandPaletteState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
}));

const totalJobs = (counts: Record<string, number>) =>
  Object.entries(counts).reduce(
    (sum, [status, n]) => (status === 'latest' ? sum : sum + (n || 0)),
    0
  );

export const CommandPalette = () => {
  const { t } = useTranslation();
  const history = useHistory();
  const { open, setOpen, toggle } = useCommandPalette();
  const { queues } = useQueues();
  const { hasHistoryProvider = false } = useUIConfig();
  const theme = useSettingsStore((state) => state.theme);
  const setSettings = useSettingsStore((state) => state.setSettings);

  useSearchHotkey(toggle);

  const showJobSchedulers = queues?.some((queue) => queue.jobSchedulerCount > 0);
  const pages = [
    { path: '/', label: t('MENU.OVERVIEW'), icon: LayoutDashboard, show: true },
    {
      path: links.jobSchedulers().pathname,
      label: t('MENU.SCHEDULERS'),
      icon: CalendarClock,
      show: !!showJobSchedulers,
    },
    {
      path: links.metricsHistory().pathname,
      label: t('MENU.METRICS_HISTORY'),
      icon: LineChart,
      show: hasHistoryProvider,
    },
  ].filter((page) => page.show);

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="top-[18%] translate-y-0 gap-0 overflow-hidden rounded-xl! p-0 shadow-2xl ring-1 ring-foreground/10 sm:max-w-lg"
      >
        <DialogTitle className="sr-only">{t('COMMAND.TITLE')}</DialogTitle>
        <DialogDescription className="sr-only">{t('COMMAND.DESCRIPTION')}</DialogDescription>
        <Command
          loop
          className="rounded-none! bg-popover **:data-[slot=command-input-wrapper]:p-2 **:data-[slot=command-input-wrapper]:pb-1"
        >
          <CommandInput placeholder={t('COMMAND.PLACEHOLDER')} autoFocus />
          <CommandList className="max-h-[min(24rem,60vh)] p-1">
            <CommandEmpty className="py-10 text-muted-foreground">
              {t('COMMAND.EMPTY')}
            </CommandEmpty>

            <CommandGroup heading={t('COMMAND.PAGES')}>
              {pages.map(({ path, label, icon: Icon }) => (
                <CommandItem
                  key={path}
                  value={`page:${label}`}
                  keywords={[label, path]}
                  onSelect={() => run(() => history.push(path))}
                >
                  <Icon aria-hidden="true" className="text-muted-foreground" />
                  {label}
                </CommandItem>
              ))}
            </CommandGroup>

            {!!queues?.length && (
              <>
                <CommandSeparator />
                <CommandGroup heading={t('COMMAND.QUEUES')}>
                  {queues.map((queue) => (
                    <CommandItem
                      key={queue.name}
                      value={`queue:${queue.name}`}
                      keywords={[queue.name, queue.displayName || '']}
                      onSelect={() =>
                        run(() => {
                          const { pathname, search } = links.queuePage(queue.name);
                          history.push({ pathname, search });
                        })
                      }
                    >
                      <Layers aria-hidden="true" className="text-muted-foreground" />
                      <span className="min-w-0 truncate">{queue.displayName || queue.name}</span>
                      {queue.isPaused && (
                        <span className="rounded-sm bg-status-paused/15 px-1 text-[0.65rem] font-medium text-status-paused uppercase">
                          {t('MENU.PAUSED')}
                        </span>
                      )}
                      <CommandShortcut className="tracking-normal tabular-nums">
                        {totalJobs(queue.counts as unknown as Record<string, number>)}
                      </CommandShortcut>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            <CommandSeparator />
            <CommandGroup heading={t('COMMAND.THEME')}>
              {themeOptions.map(({ value, icon: Icon, labelKey }) => (
                <CommandItem
                  key={value}
                  value={`theme:${value}`}
                  keywords={[t(labelKey), value]}
                  data-checked={theme === value}
                  onSelect={() => run(() => setSettings({ theme: value }))}
                >
                  <Icon aria-hidden="true" className="text-muted-foreground" />
                  {t(labelKey)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          <div className="flex items-center justify-end gap-3 border-t bg-muted/40 px-3 py-2 text-[0.7rem] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
            </span>
            <span className="flex items-center gap-1">
              <Kbd>
                <CornerDownLeft />
              </Kbd>
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Esc</Kbd>
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
};
