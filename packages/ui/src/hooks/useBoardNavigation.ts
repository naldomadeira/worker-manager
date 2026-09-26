import React, { type ComponentType, type ReactNode, useContext } from 'react';
import { useQueues } from './useQueues';

/**
 * What the shell (sidebar, command palette, mobile switcher, breadcrumb) needs to know about a
 * queue, whatever engine the board runs. It is a structural subset of the BullMQ `AppQueue`, so
 * the BullMQ board hands its queues over as they are and renders exactly what it always did.
 */
export interface NavQueue {
  name: string;
  displayName?: string;
  description?: string;
  /** What the name is split on to group it in the sidebar tree. */
  delimiter?: string;
  isPaused: boolean;
  /** Only `active` and `failed` are read by name, for the sidebar's dot and badges. */
  counts: { active?: number; failed?: number };
  /** The job total shown in the palette and the mobile switcher; summed from `counts` if absent. */
  total?: number;
}

export interface BoardNavigation {
  queues: NavQueue[] | null;
  /** Whether the schedules page earns a navigation entry. */
  showSchedules: boolean;
  /**
   * What the sidebar, command palette, mobile switcher and breadcrumb call the schedules page, in
   * the engine's own term. BullMQ's "Job schedulers" (`MENU.SCHEDULERS`) when absent.
   */
  schedulesLabel?: string;
  /**
   * Where the breadcrumb's queue crumb leads from one of the queue's jobs, given the job page's
   * query string, so the way back lands on the list the job was opened from. BullMQ's
   * `links.queuePage` with the selected statuses when absent.
   */
  queuePageLink?(queueName: string, search: string): { pathname: string; search: string };
  /** The engine's own queue details panel, opened from the breadcrumb. BullMQ's by default. */
  QueueInfoModal?: ComponentType<{ queueName: string; open: boolean; onClose(): void }>;
  /** The engine's own datastore panel, opened from the header. BullMQ's Redis panel by default. */
  DatastoreModal?: ComponentType<{ open: boolean; onClose(): void }>;
  /** Label of the header's datastore button, when it is not the Redis one. */
  datastoreTitle?: string;
  /** Shown beside the breadcrumb, such as an "experimental" badge. */
  headerBadge?: ReactNode;
}

/** Set by an engine other than BullMQ, around the shell. Null means the BullMQ board. */
export const BoardNavigationContext = React.createContext<BoardNavigation | null>(null);

/**
 * The navigation of the board being shown. `useQueues` is always called, since hooks cannot be
 * conditional, but it only fetches on a BullMQ board, so a pg-boss board never asks for
 * `/api/queues`.
 */
export function useBoardNavigation(): BoardNavigation {
  const provided = useContext(BoardNavigationContext);
  const { queues } = useQueues();

  if (provided) {
    return provided;
  }

  return {
    queues,
    showSchedules: !!queues?.some((queue) => queue.jobSchedulerCount > 0),
  };
}

/** A queue's job total: its own, or the sum of its counts. */
export function navQueueTotal(queue: NavQueue, exclude: string[] = []): number {
  if (queue.total !== undefined) {
    return queue.total;
  }

  return Object.entries(queue.counts as Record<string, number | undefined>).reduce(
    (sum, [status, n]) => (exclude.includes(status) ? sum : sum + (n || 0)),
    0
  );
}
