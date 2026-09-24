import { useEffect, useRef } from 'react';
import { useSettingsStore } from './useSettings';

/** Focuses the sidebar's queue filter, expanding the sidebar first if it is collapsed. */
export function focusQueueSearch() {
  if (useSettingsStore.getState().sidebarCollapsed) {
    useSettingsStore.getState().setSettings({ sidebarCollapsed: false });
  }
  requestAnimationFrame(() => {
    document.getElementById('search-queues')?.focus();
  });
}

/**
 * Binds Cmd/Ctrl+K. With a handler (the command palette) the shortcut runs it; without one it
 * falls back to the original behaviour of expanding the sidebar and focusing its queue filter.
 */
export function useSearchHotkey(onTrigger?: () => void) {
  const handlerRef = useRef(onTrigger);
  handlerRef.current = onTrigger;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (handlerRef.current) {
          handlerRef.current();
        } else {
          focusQueueSearch();
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
