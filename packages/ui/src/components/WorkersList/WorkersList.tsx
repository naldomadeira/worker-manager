import type { QueueWorker } from '@worker-manager/api/typings/app';
import { CircleAlertIcon, PauseIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

export interface WorkersListProps {
  workers: QueueWorker[];
  /** A paused queue is supposed to have nothing consuming it, so an empty list is not a problem. */
  isPaused: boolean;
}

/** "3 minutes ago" for a connection age in seconds, in the board language. */
const formatAgo = (seconds: number, locale: string) => {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  if (seconds < 60) return rtf.format(-seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  return rtf.format(-Math.round(hours / 24), 'day');
};

/** The workers connected to one queue, shared by the workers modal and the queue info panel. */
export const WorkersList = ({ workers, isPaused }: WorkersListProps) => {
  const { t, i18n } = useTranslation();

  if (workers.length === 0) {
    const Icon = isPaused ? PauseIcon : CircleAlertIcon;
    return (
      <div
        className={cn(
          'flex items-start gap-3 rounded-lg border p-3 text-sm',
          isPaused
            ? 'bg-muted/40 text-muted-foreground'
            : 'border-status-waiting/30 bg-status-waiting/10 text-status-waiting'
        )}
      >
        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <div className="flex flex-col gap-1">
          <p className="m-0 font-medium">
            {isPaused ? t('QUEUE.WORKERS.EMPTY_PAUSED') : t('QUEUE.WORKERS.EMPTY')}
          </p>
          {!isPaused && (
            <p className="m-0 text-xs leading-relaxed text-muted-foreground">
              {t('QUEUE.WORKERS.EMPTY_HINT')}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-8 px-3 text-xs text-muted-foreground">
              {t('QUEUE.WORKERS.COLUMN_WORKER')}
            </TableHead>
            <TableHead className="h-8 px-3 text-xs text-muted-foreground">
              {t('QUEUE.WORKERS.COLUMN_ADDRESS')}
            </TableHead>
            <TableHead className="h-8 px-3 text-right text-xs text-muted-foreground">
              {t('QUEUE.WORKERS.COLUMN_CONNECTED')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {workers.map((worker) => (
            <TableRow key={worker.id}>
              <TableCell className="max-w-56 px-3 whitespace-normal">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 animate-pulse-ring rounded-full bg-status-completed text-status-completed"
                  />
                  {/* An unnamed worker has nothing to go by but its address, so that becomes its identity. */}
                  <span
                    className={cn(
                      'identity font-medium [overflow-wrap:anywhere] text-foreground',
                      !worker.name && 'font-mono text-[0.8rem] font-normal'
                    )}
                  >
                    {worker.name || worker.addr}
                  </span>
                </span>
              </TableCell>
              <TableCell className="px-3 font-mono text-xs text-muted-foreground">
                {worker.name ? worker.addr : <span aria-hidden="true">—</span>}
              </TableCell>
              <TableCell
                className="px-3 text-right text-xs text-muted-foreground"
                title={t('QUEUE.WORKERS.CONNECTED', {
                  since: formatAgo(worker.age, i18n.language),
                })}
              >
                {formatAgo(worker.age, i18n.language)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
