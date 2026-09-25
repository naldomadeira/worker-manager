import type { PgBossInfo } from '@worker-manager/api/typings/app';
import { DatabaseZapIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { translateMessage } from '../../../utils/translateMessage';

/** What every page shows while the database cannot be read: no schema, or one out of range. */
export const PgBossUnavailable = ({ info }: { info: PgBossInfo }) => {
  const { t } = useTranslation();
  const key = info.unavailableReason?.key;
  const hint =
    key === 'ERRORS.PGBOSS_NOT_INSTALLED'
      ? t('PGBOSS.BANNER.NOT_INSTALLED')
      : key === 'ERRORS.PGBOSS_SCHEMA_UNSUPPORTED'
        ? t('PGBOSS.BANNER.SCHEMA_UNSUPPORTED', info.supportedRange)
        : undefined;

  return (
    <Empty role="alert" className="mt-4 border bg-card/50 py-14 animate-fade-in-up">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="size-10 rounded-xl text-status-failed">
          <DatabaseZapIcon className="size-5" />
        </EmptyMedia>
        <EmptyTitle className="text-base">{t('PGBOSS.BANNER.UNREADABLE')}</EmptyTitle>
        {!!info.unavailableReason && (
          <EmptyDescription>{translateMessage(info.unavailableReason)}</EmptyDescription>
        )}
        {!!hint && <EmptyDescription className="text-xs">{hint}</EmptyDescription>}
      </EmptyHeader>
    </Empty>
  );
};
