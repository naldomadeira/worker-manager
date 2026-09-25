import type { AppQueue, QueueCapabilities } from '@worker-manager/api/typings/app';

export type Capability = Exclude<keyof QueueCapabilities, 'jobSchedulers' | 'jobOptionsSchema'>;

type WithCapabilities = Pick<AppQueue, 'capabilities'> | null | undefined;

/** Whether the library behind `queue` supports `capability`. An unknown queue supports nothing. */
export function can(queue: WithCapabilities, capability: Capability): boolean {
  return queue?.capabilities?.[capability] === true;
}

export function canScheduler(queue: WithCapabilities, action: 'update' | 'run'): boolean {
  return queue?.capabilities?.jobSchedulers?.[action] === true;
}

export const LIBRARY_LABELS: Record<AppQueue['library'], string> = {
  bull: 'Bull',
  bullmq: 'BullMQ',
  'bullmq-pro': 'BullMQ Pro',
};
