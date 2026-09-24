import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  WORKER_MANAGER_INSTANCE,
  WORKER_MANAGER_OPTIONS,
  WORKER_MANAGER_QUEUES,
} from './worker-manager.constants';
import {
  WorkerManagerBoard,
  WorkerManagerModuleOptions,
  WorkerManagerQueueOptions,
} from './worker-manager.types';
import { registerQueues } from './worker-manager.util';

@Module({})
export class WorkerManagerFeatureModule implements OnModuleInit {
  constructor(
    private readonly moduleRef: ModuleRef,
    @Inject(WORKER_MANAGER_QUEUES) private readonly queues: WorkerManagerQueueOptions[],
    @Inject(WORKER_MANAGER_INSTANCE) private readonly board: WorkerManagerBoard | null,
    @Inject(WORKER_MANAGER_OPTIONS) private readonly options: WorkerManagerModuleOptions
  ) {}

  onModuleInit(): any {
    // `enabled: false` leaves no board to register into.
    if (!this.board) return;

    registerQueues(this.board, this.moduleRef, this.queues, this.options?.readOnly);
  }
}
