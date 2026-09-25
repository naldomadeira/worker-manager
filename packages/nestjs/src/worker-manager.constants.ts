// Distinct from @bull-board/nestjs's `bull_board_*` tokens: both root modules are global, so
// shared names would let one board's providers shadow the other's in an app that mounts the
// legacy bull-board and Worker Manager side by side while it migrates.
export const WORKER_MANAGER_OPTIONS = 'worker_manager_options';
export const WORKER_MANAGER_QUEUES = 'worker_manager_queues';
export const WORKER_MANAGER_ADAPTER = 'worker_manager_adapter';
export const WORKER_MANAGER_INSTANCE = 'worker_manager_instance';
export const DEFAULT_WORKER_MANAGER_ROUTE = '/queues';

export interface WorkerManagerTokens {
  options: string;
  queues: string;
  adapter: string;
  instance: string;
}

/**
 * The DI tokens of one board. The unnamed board keeps the plain `worker_manager_*` tokens; a
 * board registered with `name` gets `worker_manager_*:<name>`, so several boards can live in
 * one application without shadowing each other's providers.
 */
export function getWorkerManagerTokens(name?: string): WorkerManagerTokens {
  const suffix = name === undefined ? '' : `:${assertBoardName(name)}`;
  return {
    options: `${WORKER_MANAGER_OPTIONS}${suffix}`,
    queues: `${WORKER_MANAGER_QUEUES}${suffix}`,
    adapter: `${WORKER_MANAGER_ADAPTER}${suffix}`,
    instance: `${WORKER_MANAGER_INSTANCE}${suffix}`,
  };
}

/** The token of a board's instance, what `@InjectWorkerManager(name)` resolves. */
export const getWorkerManagerToken = (name?: string): string =>
  getWorkerManagerTokens(name).instance;

export function assertBoardName(name: unknown): string {
  if (typeof name !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(name)) {
    throw new Error(
      `WorkerManagerModule: board name ${JSON.stringify(name)} is invalid. Use letters, digits, ` +
        '".", "_" or "-".'
    );
  }
  return name;
}
