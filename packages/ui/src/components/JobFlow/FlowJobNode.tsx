import type { FlowNode } from '@worker-manager/api/typings/app';
import { Handle, Position } from '@xyflow/react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { HintTooltip } from '../HintTooltip/HintTooltip';
import type { FlowJobNodeData } from './flowLayout';
import { stateStyle } from './flowStates';

/** Status chip tinted by the node's `--node-state`; shared with the details panel. */
export const stateBadgeClassName =
  'inline-flex shrink-0 items-center gap-1 rounded-full border border-(--node-state)/40 bg-(--node-state)/12 px-1.5 py-px text-[0.625rem] font-semibold tracking-wide text-foreground uppercase';

const HANDLE = 'opacity-0!';

const NO_PROGRESS_STATES = new Set(['waiting', 'waiting-children', 'delayed', 'unknown']);

function reportedProgress(node: FlowNode): number | null {
  if (NO_PROGRESS_STATES.has(node.state)) {
    return null;
  }

  const { progress } = node;

  if (typeof progress === 'number' && Number.isFinite(progress)) {
    return progress > 0 ? progress : null;
  }

  if (typeof progress === 'object' && progress !== null && 'progress' in progress) {
    const value = (progress as Record<string, unknown>).progress;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value > 0 ? value : null;
    }
  }

  return null;
}

export function shortJobId(id: string): string {
  return id.length > 8 ? `…${id.slice(-8)}` : id;
}

export const FlowJobNode = ({
  data,
}: {
  data: FlowJobNodeData & {
    isExpanding: boolean;
    isExpanded: boolean;
    onExpand: (node: FlowNode) => void;
  };
}) => {
  const { t } = useTranslation();
  const { node, isSelected, parentQueueName, isExpanding, isExpanded, onExpand } = data;
  const progress = reportedProgress(node);
  const deps = node.dependencies;
  const reasons = Object.values(node.ignoredChildFailureReasons || {});
  const showQueue = node.queueName !== parentQueueName;
  const missing = deps
    ? deps.processed + deps.unprocessed + deps.ignored + deps.failed - node.children.length
    : 0;

  const isActive = node.state === 'active';

  return (
    <div
      style={stateStyle(node.state)}
      className={cn(
        'group/node relative box-border flex h-[124px] w-[260px] cursor-pointer flex-col gap-1.5 overflow-hidden rounded-xl border bg-card py-2 pr-3 pl-4 text-card-foreground shadow-xs transition-[border-color,box-shadow,background-color] duration-150',
        'hover:border-(--node-state)/50 hover:shadow-md',
        isSelected &&
          'border-(--node-state) bg-[color-mix(in_oklab,var(--node-state)_8%,var(--card))] shadow-md ring-3 ring-(--node-state)/20'
      )}
    >
      <Handle type="target" position={Position.Left} className={HANDLE} />
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 left-0 bg-(--node-state) transition-[width]',
          isSelected ? 'w-[5px]' : 'w-1'
        )}
      />

      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <h4 className="m-0 truncate text-sm font-semibold" title={node.name ?? undefined}>
          {node.name ?? node.id}
        </h4>
        <span
          className="shrink-0 font-mono text-[0.6875rem] text-muted-foreground"
          title={String(node.id)}
        >
          {shortJobId(String(node.id))}
        </span>
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <span className={stateBadgeClassName}>
          <span
            aria-hidden
            className={cn(
              'size-1.5 rounded-full bg-(--node-state)',
              isActive && 'animate-pulse-ring text-(--node-state)'
            )}
          />
          {node.state}
        </span>
        {showQueue && (
          <span
            className="truncate text-[0.6875rem] whitespace-nowrap text-muted-foreground"
            title={node.queueName}
          >
            {node.queueName}
          </span>
        )}
      </div>

      <div className="flex min-w-0 items-center justify-between gap-2 text-[0.6875rem]">
        {!!deps && (
          <span className="flex min-w-0 gap-2 overflow-hidden whitespace-nowrap text-muted-foreground">
            {deps.processed > 0 && <span>{t('JOB.FLOW.PROCESSED', { n: deps.processed })}</span>}
            {deps.unprocessed > 0 && (
              <span>{t('JOB.FLOW.UNPROCESSED', { n: deps.unprocessed })}</span>
            )}
            {deps.failed > 0 && (
              <span className="font-semibold text-status-failed">
                {t('JOB.FLOW.FAILED', { n: deps.failed })}
              </span>
            )}
            {deps.ignored > 0 && (
              <HintTooltip title={reasons.join('\n')}>
                <span className="inline-flex cursor-help font-semibold text-status-waiting underline decoration-dotted underline-offset-2">
                  {t('JOB.FLOW.IGNORED', { n: deps.ignored })}
                </span>
              </HintTooltip>
            )}
          </span>
        )}
        {progress !== null && (
          <span className="shrink-0 text-muted-foreground tabular-nums">
            {t('JOB.FLOW.PROGRESS', { n: progress })}
          </span>
        )}
      </div>

      {node.truncated && !isExpanded && (
        <button
          type="button"
          className="nodrag nopan mt-auto flex min-h-6 w-full items-center gap-1 rounded-md border bg-muted px-1.5 py-1 text-left text-[0.6875rem] font-medium text-foreground transition-colors hover:bg-secondary disabled:cursor-default disabled:text-muted-foreground"
          disabled={isExpanding}
          onClick={() => onExpand(node)}
        >
          <ChevronDown size={13} className={cn(isExpanding && 'animate-bounce')} />
          {isExpanding
            ? t('JOB.FLOW.EXPANDING')
            : t('JOB.FLOW.EXPAND', { n: missing > 0 ? missing : 0 })}
        </button>
      )}

      {node.truncated && isExpanded && !isExpanding && (
        <span className="mt-auto text-[0.6875rem] text-muted-foreground">
          {t('JOB.FLOW.CAPPED', {
            shown: node.children.length,
            total: node.children.length + (missing > 0 ? missing : 0),
          })}
        </span>
      )}

      {progress !== null && (
        <span className="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden bg-border">
          <span
            className="block h-[3px] w-full origin-left bg-(--node-state) transition-transform duration-300"
            style={{ transform: `scaleX(${progress / 100})` }}
          />
        </span>
      )}

      <Handle type="source" position={Position.Right} className={HANDLE} />
    </div>
  );
};
