import { ArrowRight, Database, Eraser, Inbox, Scissors } from 'lucide-react';
import formatBytes from 'pretty-bytes';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { Loader } from '../../components/Loader/Loader';
import { formatNumber } from '../../components/MetricsSummary/formatNumber';
import { useConfirm } from '../../hooks/useConfirm';
import { useHistoryUsage, usePurgeHistory } from '../../hooks/useHistoryStorage';
import { useUIConfig } from '../../hooks/useUIConfig';

interface HistoryStorageModalProps {
  open: boolean;
  /** Start of the range currently charted, used as the "keep only this" cutoff. */
  from: number;
  rangeLabel: string;
  onClose(): void;
}

function toDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const percentOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

/** One colour per tier, shared by the composition bar and the per-tier rows below it. */
const TIERS = [
  { key: 'minute', labelKey: 'METRICS_HISTORY.STORAGE.MINUTE_TIER', color: 'var(--chart-1)' },
  { key: 'hour', labelKey: 'METRICS_HISTORY.STORAGE.HOUR_TIER', color: 'var(--chart-2)' },
  { key: 'day', labelKey: 'METRICS_HISTORY.STORAGE.DAY_TIER', color: 'var(--chart-3)' },
] as const;

const TIER_INDICATOR_CLASS = {
  minute: '*:data-[slot=progress-indicator]:bg-chart-1',
  hour: '*:data-[slot=progress-indicator]:bg-chart-2',
  day: '*:data-[slot=progress-indicator]:bg-chart-3',
} as const;

export const HistoryStorageModal = ({
  open,
  from,
  rangeLabel,
  onClose,
}: HistoryStorageModalProps) => {
  const { t, i18n } = useTranslation();
  const { canPurgeHistory } = useUIConfig();
  const { usage, loading, refreshing } = useHistoryUsage(open);
  const purge = usePurgeHistory();
  const { openConfirm } = useConfirm();
  // While the confirmation is up, a click on it lands "outside" this dialog; that must not
  // dismiss the panel the confirmation belongs to.
  const [confirming, setConfirming] = useState(false);

  const cutoff = toDay(from);
  const hasTrimmable = usage?.oldestDay != null && usage.oldestDay < cutoff;
  // Purging is followed by a refetch, so the modal stays in a loading state across both
  // rather than briefly showing numbers that the purge has already invalidated.
  const busy = loading || purge.isPending || refreshing;

  async function runPurge(options: { before?: string }, description: string) {
    // Deleting recorded history can't be undone from the board, so every path through
    // here states the scope and the size before it happens.
    setConfirming(true);
    try {
      await openConfirm({ title: t('METRICS_HISTORY.STORAGE.CONFIRM_TITLE'), description });
    } catch {
      return;
    } finally {
      setConfirming(false);
    }
    await purge.mutateAsync(options);
  }

  const guardDismiss = (event: Event) => {
    if (confirming) {
      event.preventDefault();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        onInteractOutside={guardDismiss}
        onEscapeKeyDown={guardDismiss}
        className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto p-5 sm:max-w-2xl"
      >
        <DialogHeader className="flex-row items-center gap-3">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15">
            <Database className="size-4.5" aria-hidden="true" />
          </span>
          <DialogTitle className="text-lg font-semibold tracking-tight">
            {t('METRICS_HISTORY.STORAGE.TITLE')}
          </DialogTitle>
        </DialogHeader>

        {busy ? (
          <Loader />
        ) : !usage || usage.keys === 0 ? (
          <Empty className="border py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Inbox />
              </EmptyMedia>
              <EmptyDescription>{t('METRICS_HISTORY.STORAGE.EMPTY')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-5 animate-in duration-300 fade-in-0">
            <div className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4">
              <dl className="m-0 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">
                    {t('METRICS_HISTORY.STORAGE.TOTAL')}
                  </dt>
                  <dd className="m-0 font-mono text-3xl font-semibold tracking-tight tabular-nums">
                    {formatBytes(usage.bytes)}
                  </dd>
                </div>
                {usage.oldestDay && usage.newestDay && (
                  <div className="text-right">
                    <dt className="text-xs font-medium text-muted-foreground">
                      {t('METRICS_HISTORY.STORAGE.RANGE')}
                    </dt>
                    <dd className="m-0 mt-1">
                      <Badge variant="outline" className="h-6 gap-1.5 font-mono">
                        {usage.oldestDay}
                        <ArrowRight aria-hidden="true" />
                        {usage.newestDay}
                      </Badge>
                    </dd>
                  </div>
                )}
              </dl>

              {/* Composition at a glance: how much of the total each tier takes. */}
              <div
                aria-hidden="true"
                className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted"
              >
                {TIERS.map(({ key, color }) => {
                  const share = percentOf(usage.tiers[key].bytes, usage.bytes);
                  return share > 0 ? (
                    <span
                      key={key}
                      className="h-full origin-left animate-in duration-500 fade-in-0 first:rounded-l-full last:rounded-r-full"
                      style={{ width: `${share}%`, backgroundColor: color }}
                    />
                  ) : null;
                })}
              </div>

              <dl className="m-0 grid gap-3 sm:grid-cols-3">
                {TIERS.map(({ key, labelKey, color }) => {
                  const bytes = usage.tiers[key].bytes;
                  const share = percentOf(bytes, usage.bytes);
                  const labelId = `history-tier-${key}`;
                  return (
                    <div key={key} className="flex flex-col gap-1.5">
                      <dt
                        id={labelId}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground"
                      >
                        <span
                          aria-hidden="true"
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: color }}
                        />
                        {t(labelKey)}
                      </dt>
                      <dd className="m-0 flex items-baseline justify-between gap-2">
                        <span className="font-mono text-sm font-medium tabular-nums">
                          {formatBytes(bytes)}
                        </span>
                        <span className="text-[0.68rem] text-muted-foreground tabular-nums">
                          {formatNumber(share / 100, i18n.language, {
                            style: 'percent',
                            maximumFractionDigits: 1,
                          })}
                        </span>
                      </dd>
                      <Progress
                        value={share}
                        aria-labelledby={labelId}
                        className={cn('h-1.5', TIER_INDICATOR_CLASS[key])}
                      />
                    </div>
                  );
                })}
              </dl>
            </div>

            <p className="m-0 text-xs leading-relaxed text-muted-foreground">
              {t('METRICS_HISTORY.STORAGE.TIER_NOTE')}
            </p>

            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-9 pl-4 text-[0.68rem] font-semibold tracking-wide text-muted-foreground uppercase">
                      {t('METRICS_HISTORY.QUEUE')}
                    </TableHead>
                    <TableHead className="h-9 text-right text-[0.68rem] font-semibold tracking-wide text-muted-foreground uppercase">
                      {t('METRICS_HISTORY.STORAGE.SIZE')}
                    </TableHead>
                    <TableHead className="h-9 pr-4 text-right text-[0.68rem] font-semibold tracking-wide text-muted-foreground uppercase">
                      {t('METRICS_HISTORY.STORAGE.MINUTES')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usage.queues.map((queue, index) => (
                    <TableRow
                      key={queue.queue}
                      className="animate-fade-in-up"
                      style={{ animationDelay: `${Math.min(index * 30, 300)}ms` }}
                    >
                      <TableCell className="pl-4">
                        <div className="flex min-w-40 flex-col gap-1.5">
                          <span className="font-medium">{queue.queue}</span>
                          <Progress
                            value={percentOf(queue.bytes, usage.bytes)}
                            aria-label={queue.queue}
                            className="h-1 max-w-48 *:data-[slot=progress-indicator]:bg-primary/70"
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatBytes(queue.bytes)}
                      </TableCell>
                      <TableCell className="pr-4 text-right font-mono text-muted-foreground tabular-nums">
                        {formatNumber(queue.minutes, i18n.language)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {!busy && usage && usage.keys > 0 && canPurgeHistory && (
          <DialogFooter className="-mx-5 -mb-5 px-5">
            <Button
              variant="outline"
              disabled={!hasTrimmable}
              onClick={() =>
                runPurge(
                  { before: cutoff },
                  t('METRICS_HISTORY.STORAGE.CONFIRM_TRIM', { range: rangeLabel, date: cutoff })
                )
              }
            >
              <Scissors data-icon="inline-start" aria-hidden="true" />
              {t('METRICS_HISTORY.STORAGE.TRIM_BTN', { range: rangeLabel })}
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                runPurge(
                  {},
                  t('METRICS_HISTORY.STORAGE.CONFIRM_CLEAR', { size: formatBytes(usage.bytes) })
                )
              }
            >
              <Eraser data-icon="inline-start" aria-hidden="true" />
              {t('METRICS_HISTORY.STORAGE.CLEAR_BTN')}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};
