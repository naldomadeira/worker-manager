import { useQuery } from '@tanstack/react-query';
import { unwrap, usePollingInterval } from './query';
import { pgBossKeys } from './queryKeys';
import { usePgBossApi } from './usePgBossApi';

export function usePgBossSchedules(queueName?: string) {
  const api = usePgBossApi();
  const refetchInterval = usePollingInterval();
  const query = useQuery({
    queryKey: pgBossKeys.schedules(queueName),
    queryFn: async () => unwrap(await api.getSchedules(queueName)).schedules,
    refetchInterval,
  });

  return {
    schedules: query.data ?? null,
    loading: query.isPending,
    error: query.error ?? null,
    refetch: () => query.refetch(),
  };
}
