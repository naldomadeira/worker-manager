import type { PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import { RedisStatsModal } from '../../../components/RedisStatsModal/RedisStatsModal';
import { usePgBossInfo } from '../hooks/usePgBossInfo';

const Item = ({ label, children }: PropsWithChildren<{ label: string }>) => (
  <div className="flex min-w-0 flex-col gap-1 rounded-lg border bg-card p-3">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="m-0 truncate font-mono text-sm font-medium text-foreground tabular-nums">
      {children}
    </dd>
  </div>
);

/**
 * The header's datastore panel on a pg-boss board: the PostgreSQL stats the BullMQ panel shows
 * for a Postgres-backed queue, plus the pg-boss installation the board reads.
 */
export const PgBossDatastoreModal = ({ open, onClose }: { open: boolean; onClose(): void }) => {
  const { t } = useTranslation();
  const { info } = usePgBossInfo();

  if (!info) {
    return null;
  }

  const onOff = (value: boolean) =>
    value ? t('PGBOSS.DATASTORE.ENABLED') : t('PGBOSS.DATASTORE.DISABLED');

  return (
    <RedisStatsModal
      open={open}
      onClose={onClose}
      stats={info.datastore}
      title={t('PGBOSS.DATASTORE.TITLE')}
    >
      <dl className="m-0 grid grid-cols-2 gap-2">
        <Item label={t('PGBOSS.DATASTORE.SCHEMA')}>{info.schema}</Item>
        <Item label={t('PGBOSS.DATASTORE.SCHEMA_VERSION')}>{info.schemaVersion ?? '-'}</Item>
        <Item label={t('PGBOSS.DATASTORE.SUPPORTED_RANGE')}>
          {t('PGBOSS.DATASTORE.RANGE', info.supportedRange)}
        </Item>
        <Item label={t('PGBOSS.DATASTORE.INSTALLED')}>{onOff(info.installed)}</Item>
        <Item label={t('PGBOSS.DATASTORE.WRITABLE')}>{onOff(info.writable)}</Item>
        <Item label={t('PGBOSS.DATASTORE.PERSIST_QUEUE_STATS')}>
          {onOff(info.persistQueueStats)}
        </Item>
      </dl>
    </RedisStatsModal>
  );
};
