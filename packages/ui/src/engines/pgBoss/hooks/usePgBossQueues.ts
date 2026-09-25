import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { unwrap, usePollingInterval } from './query';
import { pgBossKeys } from './queryKeys';
import { usePgBossApi } from './usePgBossApi';

/** Every visible queue with pg-boss's cached counters, polled with the settings' interval. */
export function usePgBossQueues() {
  const api = usePgBossApi();
  const refetchInterval = usePollingInterval();
  const query = useQuery({
    queryKey: pgBossKeys.queues,
    queryFn: async () => unwrap(await api.getQueues()).queues,
    refetchInterval,
    placeholderData: keepPreviousData,
  });

  return {
    queues: query.data ?? null,
    loading: query.isPending,
    error: query.error ?? null,
    refetch: () => query.refetch(),
  };
}
