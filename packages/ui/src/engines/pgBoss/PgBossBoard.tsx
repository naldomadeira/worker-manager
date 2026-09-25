import { BoardFrame } from '../../components/AppShell/BoardFrame';
import { BoardNavigationContext } from '../../hooks/useBoardNavigation';
import { usePgBossNavigation } from './navigation';
import { PgBossRoutes } from './PgBossRoutes';

/**
 * A pg-boss board: the shared shell, fed with pg-boss's queues, around pg-boss's own pages.
 * Loaded lazily by `App`, so none of this reaches a BullMQ board.
 */
export const PgBossBoard = () => {
  const navigation = usePgBossNavigation();

  return (
    <BoardNavigationContext.Provider value={navigation}>
      <BoardFrame renderRoutes={(location) => <PgBossRoutes location={location} />} />
    </BoardNavigationContext.Provider>
  );
};
