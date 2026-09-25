import type { AppQueue } from '@worker-manager/api/typings/app';
import {
  FileTextIcon,
  InfoIcon,
  LayersIcon,
  type LucideIcon,
  PencilIcon,
  SlidersHorizontalIcon,
  UsersIcon,
} from 'lucide-react';
import React, { PropsWithChildren, ReactNode, Suspense, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useQueueDefaultJobOptions } from '../../hooks/useQueueDefaultJobOptions';
import { useQueueRateLimit } from '../../hooks/useQueueRateLimit';
import { useQueueWorkers } from '../../hooks/useQueueWorkers';
import { can, LIBRARY_LABELS } from '../../utils/capabilities';
import { Modal } from '../Modal/Modal';
import { WorkersList } from '../WorkersList/WorkersList';

const ConcurrencyModalLazy = React.lazy(() =>
  import('../ConcurrencyModal/ConcurrencyModal').then(({ ConcurrencyModal }) => ({
    default: ConcurrencyModal,
  }))
);

const RateLimitModalLazy = React.lazy(() =>
  import('../RateLimitModal/RateLimitModal').then(({ RateLimitModal }) => ({
    default: RateLimitModal,
  }))
);

export interface QueueInfoModalProps {
  open: boolean;
  queue: AppQueue;
  onClose(): void;
  /** Which section starts expanded, so a caller can open the panel on the part it is about. */
  initialSection?: InfoSection;
}

const Row = ({
  label,
  action,
  children,
}: PropsWithChildren<{ label: string; action?: ReactNode }>) => (
  <div className="grid grid-cols-1 items-center gap-0.5 px-3 py-2 sm:grid-cols-[minmax(8rem,0.8fr)_1.4fr] sm:gap-4">
    <dt className="m-0 text-xs text-muted-foreground sm:text-[0.8rem]">{label}</dt>
    <dd
      className={cn(
        'm-0 min-w-0 text-sm [overflow-wrap:anywhere] text-foreground',
        !!action && 'flex min-h-6 items-center justify-between gap-2'
      )}
    >
      {children}
      {action}
    </dd>
  </div>
);

const EditButton = ({
  label,
  onClick,
  ref,
}: {
  label: string;
  onClick(): void;
  ref?: React.Ref<HTMLButtonElement>;
}) => (
  <Button
    ref={ref}
    variant="ghost"
    size="icon-xs"
    className="text-muted-foreground hover:text-foreground"
    onClick={onClick}
    title={label}
    aria-label={label}
  >
    <PencilIcon />
  </Button>
);

const SectionTitle = ({ icon: Icon, children }: PropsWithChildren<{ icon: LucideIcon }>) => (
  <span className="flex items-center gap-2">
    <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
    {children}
  </span>
);

const rowsClass = 'm-0 flex flex-col divide-y rounded-lg border bg-muted/20';
const monoClass = 'font-mono text-[0.8rem]';

function toStartCase(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatOptionValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('type' in obj || 'delay' in obj) {
      const parts: string[] = [];
      if (obj.type) parts.push(String(obj.type));
      if (obj.delay != null) parts.push(`${obj.delay}ms`);
      if (parts.length) return parts.join(' · ');
    }
    return JSON.stringify(obj);
  }
  return String(value);
}

export type InfoSection = 'overview' | 'workers' | 'defaults' | 'description';

export const QueueInfoModal = ({
  open,
  queue,
  onClose,
  initialSection = 'overview',
}: QueueInfoModalProps) => {
  const { t } = useTranslation();
  const [openSection, setOpenSection] = useState<InfoSection | ''>(initialSection);
  const [editing, setEditing] = useState<'concurrency' | 'rateLimit' | ''>('');
  const concurrencyRef = useRef<HTMLButtonElement>(null);
  const rateLimitRef = useRef<HTMLButtonElement>(null);
  const canEdit = !queue.readOnlyMode;

  const totalJobs = queue.statuses.reduce((sum, status) => sum + (queue.counts[status] || 0), 0);
  const { defaultJobOptions } = useQueueDefaultJobOptions(queue.name, open);
  const optionEntries = Object.entries(defaultJobOptions || {});
  // Asked for once, when the panel opens. `null` means the queue cannot report workers at all,
  // so the panel says nothing about them.
  const { workers } = useQueueWorkers(queue.name, open);
  const { rateLimit } = useQueueRateLimit(queue.name, open && can(queue, 'globalRateLimit'));
  const workersIdle = workers?.length === 0 && !queue.isPaused;

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
            {queue.displayName || queue.name}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{LIBRARY_LABELS[queue.library]}</Badge>
            <Badge
              variant="secondary"
              className={cn(
                queue.isPaused
                  ? 'bg-status-paused/25 text-foreground'
                  : 'bg-status-completed/15 text-status-completed'
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'size-1.5 rounded-full',
                  queue.isPaused
                    ? 'bg-status-paused'
                    : 'animate-pulse-ring bg-status-completed text-status-completed'
                )}
              />
              {queue.isPaused ? t('QUEUE.INFO.PAUSED') : t('QUEUE.INFO.RUNNING')}
            </Badge>
          </div>
        </div>
      </div>

      <Accordion
        type="single"
        collapsible
        value={openSection}
        onValueChange={(value) => setOpenSection(value as InfoSection | '')}
      >
        <AccordionItem value="overview">
          <AccordionTrigger className="hover:no-underline">
            <SectionTitle icon={InfoIcon}>{t('QUEUE.INFO.OVERVIEW')}</SectionTitle>
          </AccordionTrigger>
          <AccordionContent>
            <dl className={rowsClass}>
              <Row label={t('QUEUE.INFO.NAME')}>
                <span className={monoClass}>{queue.name}</span>
              </Row>
              {queue.displayName && queue.displayName !== queue.name && (
                <Row label={t('QUEUE.INFO.DISPLAY_NAME')}>{queue.displayName}</Row>
              )}
              <Row
                label={t('QUEUE.INFO.GLOBAL_CONCURRENCY')}
                action={
                  canEdit &&
                  can(queue, 'globalConcurrency') && (
                    <EditButton
                      ref={concurrencyRef}
                      label={t('QUEUE.ACTIONS.SET_CONCURRENCY')}
                      onClick={() => setEditing('concurrency')}
                    />
                  )
                }
              >
                {queue.globalConcurrency != null ? (
                  <span className={monoClass}>{queue.globalConcurrency}</span>
                ) : (
                  <span className="text-muted-foreground">{t('QUEUE.INFO.NOT_SET')}</span>
                )}
              </Row>
              {can(queue, 'globalRateLimit') && (
                <Row
                  label={t('QUEUE.INFO.RATE_LIMIT')}
                  action={
                    canEdit && (
                      <EditButton
                        ref={rateLimitRef}
                        label={t('QUEUE.ACTIONS.SET_RATE_LIMIT')}
                        onClick={() => setEditing('rateLimit')}
                      />
                    )
                  }
                >
                  {rateLimit ? (
                    <span className={monoClass}>
                      {t('RATE_LIMIT.VALUE', { max: rateLimit.max, duration: rateLimit.duration })}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{t('QUEUE.INFO.NOT_SET')}</span>
                  )}
                </Row>
              )}
              {!!workers && (
                <Row label={t('QUEUE.INFO.WORKERS')}>
                  <span className={cn(monoClass, workersIdle && 'text-status-waiting')}>
                    {workers.length === 0 ? t('QUEUE.WORKERS.NONE') : workers.length}
                  </span>
                </Row>
              )}
              <Row label={t('QUEUE.INFO.READ_ONLY')}>
                {queue.readOnlyMode ? t('QUEUE.INFO.YES') : t('QUEUE.INFO.NO')}
              </Row>
              <Row label={t('QUEUE.INFO.RETRIES')}>
                {queue.allowRetries ? t('QUEUE.INFO.YES') : t('QUEUE.INFO.NO')}
              </Row>
              <Row label={t('QUEUE.INFO.DELIMITER')}>
                {queue.delimiter ? (
                  <span className={monoClass}>{queue.delimiter}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </Row>
              <Row label={t('QUEUE.INFO.TOTAL_JOBS')}>
                <span className={cn(monoClass, 'tabular-nums')}>{totalJobs}</span>
              </Row>
            </dl>
          </AccordionContent>
        </AccordionItem>

        {!!workers && (
          <AccordionItem value="workers">
            <AccordionTrigger className="hover:no-underline">
              <SectionTitle icon={UsersIcon}>{t('QUEUE.WORKERS.TITLE')}</SectionTitle>
            </AccordionTrigger>
            <AccordionContent>
              <WorkersList workers={workers} isPaused={queue.isPaused} />
            </AccordionContent>
          </AccordionItem>
        )}

        {optionEntries.length > 0 && (
          <AccordionItem value="defaults">
            <AccordionTrigger className="hover:no-underline">
              <SectionTitle icon={SlidersHorizontalIcon}>{t('QUEUE.INFO.DEFAULTS')}</SectionTitle>
            </AccordionTrigger>
            <AccordionContent>
              <dl className={rowsClass}>
                {optionEntries.map(([key, value]) => (
                  <Row key={key} label={toStartCase(key)}>
                    <span className={monoClass}>{formatOptionValue(value)}</span>
                  </Row>
                ))}
              </dl>
            </AccordionContent>
          </AccordionItem>
        )}

        {!!queue.description && (
          <AccordionItem value="description">
            <AccordionTrigger className="hover:no-underline">
              <SectionTitle icon={FileTextIcon}>{t('QUEUE.INFO.DESCRIPTION')}</SectionTitle>
            </AccordionTrigger>
            <AccordionContent>
              <p className="m-0 text-sm leading-relaxed whitespace-pre-line text-foreground">
                {queue.description}
              </p>
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>

      <Suspense fallback={null}>
        {editing === 'concurrency' && (
          <ConcurrencyModalLazy
            open
            queue={queue}
            finalFocus={concurrencyRef}
            onClose={() => setEditing('')}
          />
        )}
        {editing === 'rateLimit' && (
          <RateLimitModalLazy
            open
            queue={queue}
            finalFocus={rateLimitRef}
            onClose={() => setEditing('')}
          />
        )}
      </Suspense>
    </Modal>
  );
};
