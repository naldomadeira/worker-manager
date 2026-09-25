import { useQuery } from '@tanstack/react-query';
import type { PgBossCapabilities, PgBossInfo } from '@worker-manager/api/typings/app';
import { unwrap } from './query';
import { pgBossKeys } from './queryKeys';
import { usePgBossApi } from './usePgBossApi';

/** The installation, the schema guard and what the board may do. Refreshed every half minute. */
export function usePgBossInfo() {
  const api = usePgBossApi();
  const query = useQuery({
    queryKey: pgBossKeys.info,
    queryFn: async () => unwrap(await api.getInfo()),
    refetchInterval: 30_000,
  });

  return { info: query.data ?? null, loading: query.isPending, error: query.error ?? null };
}

export type PgBossWriteAction = Exclude<keyof PgBossCapabilities, 'schedulePreview'>;

export interface PgBossPermissions {
  /** Anything at all may be changed: the board is writable and not read-only. */
  canWrite: boolean;
  can(action: PgBossWriteAction): boolean;
  canPreview: boolean;
  readOnly: boolean;
}

/**
 * What the controls may offer. Derived from the server's own report, and only presentation: the
 * server refuses a write it does not allow whatever the page shows.
 */
export function permissionsOf(info: PgBossInfo | null): PgBossPermissions {
  const canWrite = !!info && info.readable && info.writable && !info.readOnly;
  return {
    canWrite,
    can: (action) => canWrite && info!.capabilities[action] === true,
    canPreview: !!info?.capabilities.schedulePreview,
    readOnly: !!info?.readOnly,
  };
}

export function usePgBossPermissions(): PgBossPermissions {
  return permissionsOf(usePgBossInfo().info);
}
