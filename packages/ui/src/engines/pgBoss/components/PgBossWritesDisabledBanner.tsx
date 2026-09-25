import type { PgBossInfo } from '@worker-manager/api/typings/app';
import { LockIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { translateMessage } from '../../../utils/translateMessage';

/**
 * Says why nothing can be changed when the schema guard turned writes off. A board created
 * read-only says so with its badges instead: that is a choice, not a problem to explain.
 */
export const PgBossWritesDisabledBanner = ({
  info,
  className,
}: {
  info: PgBossInfo | null;
  className?: string;
}) => {
  const { t } = useTranslation();

  if (!info || !info.readable || info.writable || info.readOnly) {
    return null;
  }

  return (
    <Alert
      className={cn(
        'border-status-delayed/30 bg-status-delayed/8 animate-fade-in-up [&>svg]:text-status-delayed',
        className
      )}
    >
      <LockIcon aria-hidden="true" />
      <AlertTitle>{t('PGBOSS.BANNER.WRITES_DISABLED')}</AlertTitle>
      {!!info.writesDisabledReason && (
        <AlertDescription className="text-muted-foreground">
          {translateMessage(info.writesDisabledReason)}
        </AlertDescription>
      )}
    </Alert>
  );
};
