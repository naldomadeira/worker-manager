/**
 * Literal Tailwind class sets per job status. Tailwind only generates classes it can find
 * spelled out in the source, so `bg-status-${status}` would silently produce nothing; every
 * status colour used by the queue page, job cards and the flow graph comes from this table.
 */
export interface StatusTone {
  /** Solid fill, for dots and progress indicators. */
  dot: string;
  /** Foreground colour. */
  text: string;
  /** Low-strength tinted background, for chips. */
  soft: string;
  /** Tinted border, for chips and focus. */
  border: string;
  /** The same colour as a CSS value, for inline styles and SVG fills. */
  color: string;
}

const tones: Record<string, StatusTone> = {
  failed: {
    dot: 'bg-status-failed',
    text: 'text-status-failed',
    soft: 'bg-status-failed/12',
    border: 'border-status-failed/40',
    color: 'var(--status-failed)',
  },
  completed: {
    dot: 'bg-status-completed',
    text: 'text-status-completed',
    soft: 'bg-status-completed/12',
    border: 'border-status-completed/40',
    color: 'var(--status-completed)',
  },
  waiting: {
    dot: 'bg-status-waiting',
    text: 'text-status-waiting',
    soft: 'bg-status-waiting/12',
    border: 'border-status-waiting/40',
    color: 'var(--status-waiting)',
  },
  'waiting-children': {
    dot: 'bg-status-waiting-children',
    text: 'text-status-waiting-children',
    soft: 'bg-status-waiting-children/12',
    border: 'border-status-waiting-children/40',
    color: 'var(--status-waiting-children)',
  },
  prioritized: {
    dot: 'bg-status-prioritized',
    text: 'text-status-prioritized',
    soft: 'bg-status-prioritized/12',
    border: 'border-status-prioritized/40',
    color: 'var(--status-prioritized)',
  },
  active: {
    dot: 'bg-status-active',
    text: 'text-status-active',
    soft: 'bg-status-active/12',
    border: 'border-status-active/40',
    color: 'var(--status-active)',
  },
  delayed: {
    dot: 'bg-status-delayed',
    text: 'text-status-delayed',
    soft: 'bg-status-delayed/12',
    border: 'border-status-delayed/40',
    color: 'var(--status-delayed)',
  },
  paused: {
    dot: 'bg-status-paused',
    text: 'text-status-paused',
    soft: 'bg-status-paused/12',
    border: 'border-status-paused/40',
    color: 'var(--status-paused)',
  },
  retry: {
    dot: 'bg-status-retry',
    text: 'text-status-retry',
    soft: 'bg-status-retry/12',
    border: 'border-status-retry/40',
    color: 'var(--status-retry)',
  },
  cancelled: {
    dot: 'bg-status-cancelled',
    text: 'text-status-cancelled',
    soft: 'bg-status-cancelled/12',
    border: 'border-status-cancelled/40',
    color: 'var(--status-cancelled)',
  },
};

const neutral: StatusTone = {
  dot: 'bg-muted-foreground',
  text: 'text-muted-foreground',
  soft: 'bg-muted',
  border: 'border-border',
  color: 'var(--muted-foreground)',
};

export function statusTone(status: string | null | undefined): StatusTone {
  return (status && tones[status]) || neutral;
}
