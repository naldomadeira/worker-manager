import type { PgBossInfo } from '@worker-manager/api/typings/app';
import { FlaskConicalIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { featureLabel, joinList } from '../utils/features';

/**
 * Says when the board is reading a schema it was not tested with, or one that lacks parts it
 * would read, and which features that turned off. Everything else on the page still works.
 */
export const PgBossSchemaBanner = ({
  info,
  className,
}: {
  info: PgBossInfo | null;
  className?: string;
}) => {
  const { t, i18n } = useTranslation();

  if (!info || !info.readable || (!info.untested && info.disabledFeatures.length === 0)) {
    return null;
  }

  const features = joinList(
    info.disabledFeatures.map((feature) => featureLabel(feature, t)),
    i18n.language
  );

  return (
    <Alert
      role="status"
      data-testid="pgboss-schema-banner"
      className={cn(
        'border-status-delayed/30 bg-status-delayed/8 animate-fade-in-up [&>svg]:text-status-delayed',
        className
      )}
    >
      <FlaskConicalIcon aria-hidden="true" />
      <AlertTitle>
        {info.untested
          ? t('PGBOSS.BANNER.UNTESTED_SCHEMA', {
              found: info.schemaVersion,
              max: info.supportedRange.max,
            })
          : t('PGBOSS.BANNER.MISSING_FEATURES')}
      </AlertTitle>
      <AlertDescription className="text-muted-foreground [&_p:not(:last-child)]:mb-1">
        {info.untested && <p>{t('PGBOSS.BANNER.UNTESTED_HINT')}</p>}
        {info.disabledFeatures.length > 0 && (
          <p>{t('PGBOSS.BANNER.FEATURES_DISABLED', { features })}</p>
        )}
      </AlertDescription>
    </Alert>
  );
};
