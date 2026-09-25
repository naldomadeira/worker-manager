import type { TFunction } from 'i18next';

const POLICIES = {
  standard: ['PGBOSS.POLICY.STANDARD', 'PGBOSS.POLICY.STANDARD_DESC'],
  short: ['PGBOSS.POLICY.SHORT', 'PGBOSS.POLICY.SHORT_DESC'],
  singleton: ['PGBOSS.POLICY.SINGLETON', 'PGBOSS.POLICY.SINGLETON_DESC'],
  stately: ['PGBOSS.POLICY.STATELY', 'PGBOSS.POLICY.STATELY_DESC'],
  exclusive: ['PGBOSS.POLICY.EXCLUSIVE', 'PGBOSS.POLICY.EXCLUSIVE_DESC'],
  key_strict_fifo: ['PGBOSS.POLICY.KEY_STRICT_FIFO', 'PGBOSS.POLICY.KEY_STRICT_FIFO_DESC'],
} as const;

/** A queue policy's name and one-line meaning. A policy newer than this board shows as sent. */
export function describePolicy(
  policy: string | null | undefined,
  t: TFunction
): { label: string; description?: string } {
  const known = policy ? POLICIES[policy as keyof typeof POLICIES] : undefined;
  if (!known) return { label: policy || '-' };
  return { label: t(known[0]), description: t(known[1]) };
}
