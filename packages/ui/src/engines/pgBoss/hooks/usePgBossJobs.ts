import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { PgBossJobsParams } from '../services/PgBossApi';
import { unwrap, usePollingInterval } from './query';
import { pgBossKeys } from './queryKeys';
import { usePgBossApi } from './usePgBossApi';

/** One keyset page of a queue's jobs. The previous page stays on screen while the next loads. */
export function usePgBossJobs(name: string, params: PgBossJobsParams) {
  const api = usePgBossApi();
  const refetchInterval = usePollingInterval();
  const query = useQuery({
    queryKey: pgBossKeys.jobs(name, params),
    queryFn: async () => unwrap(await api.getJobs(name, params)),
    refetchInterval,
    placeholderData: keepPreviousData,
    enabled: !!name,
  });

  return {
    page: query.data ?? null,
    loading: query.isPending,
    isTransitioning: query.isPlaceholderData,
    error: query.error ?? null,
    refetch: () => query.refetch(),
  };
}
