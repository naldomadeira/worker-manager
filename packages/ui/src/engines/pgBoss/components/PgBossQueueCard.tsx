import type { PgBossQueueSummary } from '@worker-manager/api/typings/app';
import { NavLink } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Sparkline } from '../../../components/Sparkline/Sparkline';
import type { PgBossPermissions } from '../hooks/usePgBossInfo';
import { pgBossLinks } from '../utils/links';
import { PgBossQueueActions } from './PgBossQueueActions';
import { PgBossQueueBadges } from './PgBossQueueBadges';
import { PgBossQueueStats } from './PgBossQueueStats';

interface PgBossQueueCardProps {
  queue: PgBossQueueSummary;
  permissions: PgBossPermissions;
  onSendJob(queueName: string): void;
}

/** A pg-boss queue on the overview, in the same frame as a BullMQ queue card. */
export const PgBossQueueCard = ({ queue, permissions, onSendJob }: PgBossQueueCardProps) => {
  const hasFailures = queue.counts.failed > 0;

  return (
    <Card
      data-backlogged={queue.backlogged || undefined}
      className={cn(
        'group/queue-card relative isolate h-full min-w-0 gap-4 p-4 shadow-xs',
        'transition-[transform,box-shadow,background-color] duration-200 ease-out',
        'hover:-translate-y-0.5 hover:shadow-lg hover:ring-foreground/20 motion-reduce:hover:translate-y-0',
        'has-[a[data-card-link]:focus-visible]:ring-2 has-[a[data-card-link]:focus-visible]:ring-ring',
        hasFailures && 'ring-status-failed/30 hover:ring-status-failed/45'
      )}
    >
      {hasFailures && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-linear-to-r from-status-failed/0 via-status-failed/70 to-status-failed/0"
        />
      )}

      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <NavLink
            to={pgBossLinks.queuePage(queue.name)}
            data-card-link=""
            title={queue.name}
            className="min-w-0 truncate text-[0.95rem] font-semibold tracking-tight text-foreground no-underline outline-none after:absolute after:inset-0 after:z-0 after:content-['']"
          >
            {queue.name}
          </NavLink>
          <div className="flex min-h-5 flex-wrap items-center gap-1.5 empty:hidden">
            <PgBossQueueBadges queue={queue} readOnly={permissions.readOnly} />
          </div>
        </div>

        <div className="flex shrink-0 items-start gap-1">
          {queue.readyHistory.length > 1 && (
            <Sparkline
              className="mt-1"
              width={72}
              height={22}
              series={[{ values: queue.readyHistory, color: 'var(--status-waiting)', area: true }]}
            />
          )}
          <div className="relative z-10 -mt-1 -mr-1.5">
            <PgBossQueueActions
              queue={queue}
              permissions={permissions}
              onSendJob={() => onSendJob(queue.name)}
            />
          </div>
        </div>
      </div>

      <PgBossQueueStats queue={queue} />
    </Card>
  );
};
