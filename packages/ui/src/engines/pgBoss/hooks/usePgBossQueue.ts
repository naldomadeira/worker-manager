import { useQuery } from '@tanstack/react-query';
import { unwrap, usePollingInterval } from './query';
import { pgBossKeys } from './queryKeys';
import { usePgBossApi } from './usePgBossApi';

/** One queue, from the queue list the shell already polls when it is there. */
export function usePgBossQueue(name: string) {
  const api = usePgBossApi();
  const refetchInterval = usePollingInterval();
  const query = useQuery({
    queryKey: pgBossKeys.queue(name),
    queryFn: async () => unwrap(await api.getQueue(name)).queue,
    refetchInterval,
    enabled: !!name,
  });

  return {
    queue: query.data ?? null,
    loading: query.isPending,
    error: query.error ?? null,
    refetch: () => query.refetch(),
  };
}

/**
 * Live, capped counts per state. Only the open queue page asks: on a large queue the six counts
 * cost real time, which is why the overview reads the cached counters instead.
 */
export function usePgBossStateCounts(name: string) {
  const api = usePgBossApi();
  const refetchInterval = usePollingInterval();
  const query = useQuery({
    queryKey: pgBossKeys.counts(name),
    queryFn: async () => unwrap(await api.getCounts(name)),
    refetchInterval,
    enabled: !!name,
    // A timed-out count is not worth retrying at once: the next poll asks again.
    retry: false,
  });

  return { counts: query.data?.counts ?? null, cap: query.data?.cap ?? null };
}
