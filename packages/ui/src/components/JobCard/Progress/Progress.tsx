import { STATUSES } from '@worker-manager/api/constants/statuses';
import type { Status } from '@worker-manager/api/typings/app';
import { Progress as ProgressPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

type IProgress = number | { progress?: number } | string | boolean | null;

interface ProgressProps {
  progress: IProgress;
  status: Status;
  className?: string;
}

function extractPercentage(progress: IProgress) {
  if (typeof progress === 'number') {
    return progress;
  } else if (typeof progress === 'string') {
    return Number.isNaN(+progress) ? null : +progress;
  } else if (
    !!progress &&
    typeof progress !== 'boolean' &&
    'progress' in progress &&
    typeof progress.progress === 'number'
  ) {
    return progress.progress;
  }

  return null;
}

const indicatorTone: Partial<Record<Status, string>> = {
  [STATUSES.failed]: '*:data-[slot=progress-indicator]:bg-status-failed',
  [STATUSES.active]: '*:data-[slot=progress-indicator]:bg-status-active',
};

export const Progress = ({ progress, status, className }: ProgressProps) => {
  const percentage = extractPercentage(progress);
  if (!percentage) {
    return null;
  }

  const value = Math.max(0, Math.min(100, percentage));
  const isActive = status === STATUSES.active && value < 100;

  return (
    <div className={cn('flex min-w-0 items-center gap-3', className)}>
      {/* The Radix primitive directly rather than `ui/progress`, which does not forward `value`
          to the root and so reports an indeterminate bar to assistive technology. */}
      <ProgressPrimitive.Root
        data-slot="progress"
        value={value}
        max={100}
        className={cn(
          'relative flex h-1.5 flex-1 items-center overflow-hidden rounded-full bg-foreground/8',
          indicatorTone[status] ?? '*:data-[slot=progress-indicator]:bg-status-completed',
          isActive &&
            '*:data-[slot=progress-indicator]:animate-shimmer *:data-[slot=progress-indicator]:bg-[linear-gradient(90deg,var(--status-active)_0%,color-mix(in_oklab,var(--status-active)_55%,var(--background))_50%,var(--status-active)_100%)] *:data-[slot=progress-indicator]:bg-size-[200%_100%]'
        )}
      >
        <ProgressPrimitive.Indicator
          data-slot="progress-indicator"
          className="size-full flex-1 rounded-full transition-transform duration-500 ease-out"
          style={{ transform: `translateX(-${100 - value}%)` }}
        />
      </ProgressPrimitive.Root>
      <span className="w-10 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums">
        {`${Math.round(percentage)}%`}
      </span>
    </div>
  );
};
