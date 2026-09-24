import { useEffect } from 'react';
import { useSettingsStore } from './useSettings';

function applyDarkClass(enabled: boolean): void {
  const root = document.documentElement;
  root.classList.toggle('dark', enabled);
  root.style.colorScheme = enabled ? 'dark' : 'light';
}

export function useDarkMode() {
  const theme = useSettingsStore((state) => state.theme);

  useEffect(() => {
    if (theme !== 'system') {
      applyDarkClass(theme === 'dark');
      return;
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    applyDarkClass(media.matches);

    const onChange = () => applyDarkClass(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);
}
