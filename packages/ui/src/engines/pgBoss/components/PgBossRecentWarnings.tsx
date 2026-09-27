import type { PgBossInfo } from '@worker-manager/api/typings/app';
import { ArrowRightIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { HintTooltip } from '../../../components/HintTooltip/HintTooltip';
import { useUIConfig } from '../../../hooks/useUIConfig';
import { formatDate, formatRelativeToNow } from '../../../utils/formatDate';
import { usePgBossWarnings } from '../hooks/usePgBossWarnings';
import { WarningsEmpty, WarningTypeBadge } from '../pages/PgBossWarningsPage';
import { pgBossLinks } from '../utils/links';

const RECENT = 5;

/** The newest few of pg-boss's warnings, on the overview, with the way to the full list. */
export const PgBossRecentWarnings = ({ info }: { info: PgBossInfo | null }) => {
  const { t, i18n } = useTranslation();
  const dateFormats = useUIConfig()?.dateFormats;
  const available = !!info?.readable && !!info.features.warnings;
  const { page, loading, error } = usePgBossWarnings({ limit: RECENT }, available);

  if (!available) {
    return null;
  }

  const warnings = page?.warnings ?? [];

  return (
    <Card data-testid="pgboss-recent-warnings" className="gap-0 py-0 shadow-xs animate-fade-in-up">
      <CardHeader className="flex items-center justify-between gap-3 border-b py-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <TriangleAlertIcon aria-hidden="true" className="size-4 text-status-delayed" />
          <h2 className="m-0 text-sm font-semibold">{t('PGBOSS.WARNINGS.RECENT')}</h2>
        </CardTitle>
        <CardAction>
          <Button variant="ghost" size="sm" asChild>
            <Link to={pgBossLinks.warnings()}>
              {t('PGBOSS.WARNINGS.VIEW_ALL')}
              <ArrowRightIcon data-icon="inline-end" />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="p-0">
        {loading && !page ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-5 w-full" />
            ))}
          </div>
        ) : error && !page ? (
          <p role="alert" className="m-0 px-4 py-6 text-center text-xs text-muted-foreground">
            {t('PGBOSS.WARNINGS.LOAD_ERROR')}
          </p>
        ) : warnings.length === 0 ? (
          <WarningsEmpty kind="none" className="m-3 border-0 py-6" />
        ) : (
          <ul className="m-0 list-none divide-y p-0">
            {warnings.map((warning) => {
              const ts = Date.parse(warning.createdOn);
              return (
                <li
                  key={warning.id}
                  data-warning-type={warning.type}
                  className="flex min-w-0 items-center gap-3 px-4 py-2.5"
                >
                  <WarningTypeBadge type={warning.type} />
                  <span className="min-w-0 flex-1 truncate text-xs" title={warning.message}>
                    {warning.message}
                  </span>
                  <HintTooltip title={formatDate(ts, i18n.language, dateFormats)}>
                    <time
                      tabIndex={0}
                      dateTime={warning.createdOn}
                      className="shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums outline-none"
                    >
                      {formatRelativeToNow(ts, i18n.language)}
                    </time>
                  </HintTooltip>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};
