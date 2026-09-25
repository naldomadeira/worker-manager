import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toastManager } from '../../services/toastManager';
import { CheckIcon } from '../Icons/Check';
import { CopyIcon } from '../Icons/Copy';

interface CopyButtonProps {
  textToCopy: string;
  className?: string;
  tabIndex?: number;
}

/** Icon button that copies text, swapping to an animated check for a moment once it did. */
export const CopyButton = ({ textToCopy, className, tabIndex }: CopyButtonProps) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch (_err) {
      toastManager.add({ type: 'error', title: t('CLIPBOARD.COPY_FAILED') });
    }
  }, [textToCopy, t]);

  const label = copied ? t('CLIPBOARD.COPIED') : t('CLIPBOARD.COPY');

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={handleCopy}
      tabIndex={tabIndex}
      aria-label={label}
      title={label}
      data-copied={copied || undefined}
      className={cn(
        'relative overflow-hidden text-foreground/80 hover:bg-state-hover hover:text-foreground [&_svg]:text-muted-foreground hover:[&_svg]:text-foreground',
        className
      )}
    >
      <span className="sr-only" aria-live="polite">
        {copied ? t('CLIPBOARD.COPIED') : ''}
      </span>
      <CopyIcon
        className={cn(
          'absolute size-4 transition-all duration-200',
          copied ? 'scale-50 rotate-[-45deg] opacity-0' : 'scale-100 rotate-0 opacity-100'
        )}
      />
      <CheckIcon
        className={cn(
          'absolute size-4 text-status-completed! transition-all duration-200',
          copied ? 'scale-100 rotate-0 opacity-100' : 'scale-50 rotate-45 opacity-0'
        )}
      />
    </Button>
  );
};
