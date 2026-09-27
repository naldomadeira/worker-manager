import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { PgBossWarningsParams } from '../services/PgBossApi';
import { unwrap, usePollingInterval } from './query';
import { pgBossKeys } from './queryKeys';
import { usePgBossApi } from './usePgBossApi';

/** One page of pg-boss's persisted warnings, newest first. */
export function usePgBossWarnings(params: PgBossWarningsParams, enabled = true) {
  const api = usePgBossApi();
  const refetchInterval = usePollingInterval();
  const query = useQuery({
    queryKey: pgBossKeys.warnings(params),
    queryFn: async () => unwrap(await api.getWarnings(params)),
    // Only the newest page moves; an older one is history and stays put.
    refetchInterval: params.cursor ? false : refetchInterval,
    placeholderData: keepPreviousData,
    enabled,
  });

  return {
    page: query.data ?? null,
    loading: query.isPending && enabled,
    isTransitioning: query.isPlaceholderData,
    error: query.error ?? null,
    refetch: () => query.refetch(),
  };
}
