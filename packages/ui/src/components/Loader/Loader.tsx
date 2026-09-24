import { useTranslation } from 'react-i18next';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

interface LoaderProps {
  className?: string;
}

/** Centred loading state: a spinner with a soft pulsing halo and the localised label. */
export const Loader = ({ className }: LoaderProps) => {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex animate-in items-center justify-center gap-3 py-10 text-sm text-muted-foreground duration-500 fade-in-0',
        className
      )}
    >
      <span className="relative flex size-8 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/10 [animation-duration:1.6s]" />
        <Spinner aria-hidden="true" role="presentation" className="relative size-5 text-primary" />
      </span>
      <span className="font-medium">{t('LOADING')}</span>
    </div>
  );
};
