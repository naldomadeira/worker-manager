import type { PgBossQueueSummary } from '@worker-manager/api/typings/app';
import { InfoIcon, LayersIcon, type LucideIcon, RotateCcwIcon, TimerResetIcon } from 'lucide-react';
import { type PropsWithChildren, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { formatNumber } from '../../../components/MetricsSummary/formatNumber';
import { Modal } from '../../../components/Modal/Modal';
import { Sparkline } from '../../../components/Sparkline/Sparkline';
import { useUIConfig } from '../../../hooks/useUIConfig';
import { usePgBossPermissions } from '../hooks/usePgBossInfo';
import { usePgBossQueues } from '../hooks/usePgBossQueues';
import { formatIso, formatSeconds } from '../utils/format';
import { pgBossLinks } from '../utils/links';
import { PgBossQueueBadges } from './PgBossQueueBadges';

type Section = 'general' | 'retries' | 'lifecycle';

const rowsClass = 'm-0 flex flex-col divide-y rounded-lg border bg-muted/20';
const monoClass = 'font-mono text-[0.8rem]';

const Row = ({ label, children }: PropsWithChildren<{ label: string }>) => (
  <div className="grid grid-cols-1 items-center gap-0.5 px-3 py-2 sm:grid-cols-[minmax(8rem,0.8fr)_1.4fr] sm:gap-4">
    <dt className="m-0 text-xs text-muted-foreground sm:text-[0.8rem]">{label}</dt>
    <dd className="m-0 min-w-0 text-sm [overflow-wrap:anywhere] text-foreground">{children}</dd>
  </div>
);

const SectionTitle = ({ icon: Icon, children }: PropsWithChildren<{ icon: LucideIcon }>) => (
  <span className="flex items-center gap-2">
    <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
    {children}
  </span>
);

export interface PgBossQueueInfoModalProps {
  open: boolean;
  queueName: string;
  onClose(): void;
}

/** Everything pg-boss stores about a queue: its policy, its retry defaults and its lifecycle. */
export const PgBossQueueInfoModal = ({ open, queueName, onClose }: PgBossQueueInfoModalProps) => {
  const { t, i18n } = useTranslation();
  const { dateFormats } = useUIConfig() ?? {};
  const { queues } = usePgBossQueues();
  const permissions = usePgBossPermissions();
  const [openSection, setOpenSection] = useState<Section | ''>('general');
  const queue: PgBossQueueSummary | undefined = queues?.find((q) => q.name === queueName);

  if (!queue) {
    return null;
  }

  const locale = i18n.language;
  const yesNo = (value: boolean) => (value ? t('PGBOSS.QUEUE.YES') : t('PGBOSS.QUEUE.NO'));
  const number = (value: number) => formatNumber(value, locale);
  const optional = (value: ReactNode | null | undefined) =>
    value === null || value === undefined ? t('PGBOSS.QUEUE.NONE') : value;

  return (
    <Modal width="medium" open={open} onClose={onClose} title={t('QUEUE.INFO.TITLE')}>
      <div className="mb-3 flex min-w-0 items-center gap-3 rounded-xl border bg-muted/30 p-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <LayersIcon aria-hidden="true" className="size-5" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div
            className="truncate text-base font-semibold tracking-tight text-foreground"
            title={queue.name}
          >
            {queue.name}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">pg-boss</Badge>
            <PgBossQueueBadges queue={queue} readOnly={permissions.readOnly} />
          </div>
        </div>
        {queue.readyHistory.length > 1 && (
          <div className="hidden flex-col items-end gap-1 sm:flex">
            <Sparkline
              width={96}
              height={28}
              series={[{ values: queue.readyHistory, color: 'var(--status-waiting)', area: true }]}
            />
            <small className="text-[0.65rem] text-muted-foreground">
              {t('PGBOSS.QUEUE.READY_HISTORY')}
            </small>
          </div>
        )}
      </div>

      <Accordion
        type="single"
        collapsible
        value={openSection}
        onValueChange={(value) => setOpenSection(value as Section | '')}
      >
        <AccordionItem value="general">
          <AccordionTrigger className="hover:no-underline">
            <SectionTitle icon={InfoIcon}>{t('PGBOSS.QUEUE.SECTIONS.GENERAL')}</SectionTitle>
          </AccordionTrigger>
          <AccordionContent>
            <dl className={rowsClass}>
              <Row label={t('PGBOSS.QUEUE.NAME')}>
                <span className={monoClass}>{queue.name}</span>
              </Row>
              <Row label={t('PGBOSS.QUEUE.PARTITION')}>
                {queue.partition ? t('PGBOSS.QUEUE.PARTITIONED') : t('PGBOSS.QUEUE.SHARED')}
              </Row>
              <Row label={t('PGBOSS.QUEUE.DEAD_LETTER')}>
                {queue.deadLetter ? (
                  <Link
                    to={pgBossLinks.queuePage(queue.deadLetter)}
                    onClick={onClose}
                    className={`${monoClass} underline-offset-4 hover:text-primary hover:underline`}
                  >
                    {queue.deadLetter}
                  </Link>
                ) : (
                  t('PGBOSS.QUEUE.NONE')
                )}
              </Row>
              <Row label={t('PGBOSS.QUEUE.WARNING_QUEUE_SIZE')}>
                {queue.warningQueueSize > 0
                  ? number(queue.warningQueueSize)
                  : t('PGBOSS.QUEUE.NONE')}
              </Row>
              <Row label={t('PGBOSS.QUEUE.NOTIFY')}>{yesNo(queue.notify)}</Row>
              <Row label={t('PGBOSS.QUEUE.SINGLETONS_ACTIVE')}>
                {queue.singletonsActive?.length ? (
                  <span className={monoClass}>{queue.singletonsActive.join(', ')}</span>
                ) : (
                  t('PGBOSS.QUEUE.NONE')
                )}
              </Row>
              <Row label={t('PGBOSS.QUEUE.SCHEDULES')}>
                {queue.scheduleCount > 0 ? (
                  <Link
                    to={pgBossLinks.schedules(queue.name)}
                    onClick={onClose}
                    className="tabular-nums underline-offset-4 hover:text-primary hover:underline"
                  >
                    {number(queue.scheduleCount)}
                  </Link>
                ) : (
                  number(0)
                )}
              </Row>
              <Row label={t('PGBOSS.QUEUE.CREATED_ON')}>
                {formatIso(queue.createdOn, locale, dateFormats)}
              </Row>
              <Row label={t('PGBOSS.QUEUE.UPDATED_ON')}>
                {formatIso(queue.updatedOn, locale, dateFormats)}
              </Row>
            </dl>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="retries">
          <AccordionTrigger className="hover:no-underline">
            <SectionTitle icon={RotateCcwIcon}>{t('PGBOSS.QUEUE.SECTIONS.RETRIES')}</SectionTitle>
          </AccordionTrigger>
          <AccordionContent>
            <dl className={rowsClass}>
              <Row label={t('PGBOSS.QUEUE.RETRY_LIMIT')}>{number(queue.retryLimit)}</Row>
              <Row label={t('PGBOSS.QUEUE.RETRY_DELAY')}>
                {formatSeconds(queue.retryDelay, locale)}
              </Row>
              <Row label={t('PGBOSS.QUEUE.RETRY_BACKOFF')}>{yesNo(queue.retryBackoff)}</Row>
              <Row label={t('PGBOSS.QUEUE.RETRY_DELAY_MAX')}>
                {optional(
                  queue.retryDelayMax === null ? null : formatSeconds(queue.retryDelayMax, locale)
                )}
              </Row>
            </dl>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="lifecycle">
          <AccordionTrigger className="hover:no-underline">
            <SectionTitle icon={TimerResetIcon}>
              {t('PGBOSS.QUEUE.SECTIONS.LIFECYCLE')}
            </SectionTitle>
          </AccordionTrigger>
          <AccordionContent>
            <dl className={rowsClass}>
              <Row label={t('PGBOSS.QUEUE.EXPIRE_IN')}>
                {formatSeconds(queue.expireInSeconds, locale)}
              </Row>
              <Row label={t('PGBOSS.QUEUE.RETENTION')}>
                {formatSeconds(queue.retentionSeconds, locale)}
              </Row>
              <Row label={t('PGBOSS.QUEUE.DELETE_AFTER')}>
                {formatSeconds(queue.deleteAfterSeconds, locale)}
              </Row>
              <Row label={t('PGBOSS.QUEUE.HEARTBEAT')}>
                {optional(
                  queue.heartbeatSeconds === null
                    ? null
                    : formatSeconds(queue.heartbeatSeconds, locale)
                )}
              </Row>
            </dl>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Modal>
  );
};
