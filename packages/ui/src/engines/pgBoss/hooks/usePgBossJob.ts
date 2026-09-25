import { useQuery } from '@tanstack/react-query';
import { unwrap, usePollingInterval } from './query';
import { pgBossKeys } from './queryKeys';
import { usePgBossApi } from './usePgBossApi';

export function usePgBossJob(name: string, id: string) {
  const api = usePgBossApi();
  const refetchInterval = usePollingInterval();
  const query = useQuery({
    queryKey: pgBossKeys.job(name, id),
    queryFn: async () => unwrap(await api.getJob(name, id)).job,
    refetchInterval,
    enabled: !!name && !!id,
  });

  return {
    job: query.data ?? null,
    loading: query.isPending,
    error: query.error ?? null,
    refetch: () => query.refetch(),
  };
}

/** The jobs this one waits on and the jobs waiting on it; asked for when the tab opens. */
export function usePgBossDependencies(name: string, id: string, enabled: boolean) {
  const api = usePgBossApi();
  const query = useQuery({
    queryKey: pgBossKeys.dependencies(name, id),
    queryFn: async () => unwrap(await api.getDependencies(name, id)),
    enabled: enabled && !!name && !!id,
  });

  return { dependencies: query.data ?? null, loading: query.isPending && enabled };
}
