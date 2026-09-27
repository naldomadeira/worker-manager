import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { PgBossDepthRange } from '../services/PgBossApi';
import { unwrap, usePollingInterval } from './query';
import { pgBossKeys } from './queryKeys';
import { usePgBossApi } from './usePgBossApi';

/**
 * One queue's depth over a window, from pg-boss's `queue_stats`. Only the last hour follows the
 * polling interval: the longer windows fold minutes into buckets of a quarter hour or more, so
 * reading them again every few seconds would only cost the database.
 */
export function usePgBossQueueDepth(name: string, range: PgBossDepthRange, enabled: boolean) {
  const api = usePgBossApi();
  const polling = usePollingInterval();
  const query = useQuery({
    queryKey: pgBossKeys.depth(name, range),
    queryFn: async () => unwrap(await api.getQueueDepth(name, range)),
    refetchInterval: range === '1h' ? polling : false,
    staleTime: range === '1h' ? 0 : 60_000,
    placeholderData: keepPreviousData,
    enabled: enabled && !!name,
    retry: false,
  });

  return {
    depth: query.data ?? null,
    loading: query.isPending && enabled,
    isTransitioning: query.isPlaceholderData,
    error: query.error ?? null,
    refetch: () => query.refetch(),
  };
}
