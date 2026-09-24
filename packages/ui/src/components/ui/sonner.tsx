import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from 'lucide-react';
import * as React from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

// The board toggles its theme with a `.dark` class on <html> (no next-themes), so the
// toaster follows that class instead of a theme context.
function useIsDark() {
  const [isDark, setIsDark] = React.useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );

  React.useEffect(() => {
    const el = document.documentElement;
    const observer = new MutationObserver(() => setIsDark(el.classList.contains('dark')));
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useIsDark() ? 'dark' : 'light';

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'cn-toast',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
