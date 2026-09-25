import type { SendPgBossJobBody } from '@worker-manager/api/typings/requests';

type SendOptions = NonNullable<SendPgBossJobBody['options']>;

const SEND_OPTION_KEYS = [
  'priority',
  'startAfter',
  'singletonKey',
  'retryLimit',
  'retryDelay',
  'retryBackoff',
  'expireInSeconds',
] as const satisfies readonly (keyof SendOptions)[];

/**
 * The part of a job's or a schedule's options the send route accepts. The rest (a schedule's
 * `tz`, a policy's internals) is pg-boss's to decide, so it is left out rather than refused.
 */
export function sendOptionsOf(options: Record<string, unknown> | null | undefined): SendOptions {
  const picked: Record<string, unknown> = {};
  for (const key of SEND_OPTION_KEYS) {
    const value = options?.[key];
    if (value !== undefined && value !== null) picked[key] = value;
  }
  return picked as SendOptions;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** pg-boss ids are UUIDs, and the server refuses anything else before it reaches the database. */
export function isJobId(value: string): boolean {
  return UUID.test(value.trim());
}

/** A pg-boss id is long; its first block is enough to tell jobs apart at a glance. */
export function shortId(id: string): string {
  return id.split('-')[0] ?? id;
}
