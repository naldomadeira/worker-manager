// Distinct from @bull-board/nestjs's `bull_board_*` tokens: both root modules are global, so
// shared names would let one board's providers shadow the other's in an app that mounts the
// legacy bull-board and Worker Manager side by side while it migrates.
export const WORKER_MANAGER_OPTIONS = 'worker_manager_options';
export const WORKER_MANAGER_QUEUES = 'worker_manager_queues';
export const WORKER_MANAGER_ADAPTER = 'worker_manager_adapter';
export const WORKER_MANAGER_INSTANCE = 'worker_manager_instance';
export const DEFAULT_WORKER_MANAGER_ROUTE = '/queues';
