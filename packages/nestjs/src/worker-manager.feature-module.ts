import { Inject, Module, OnModuleInit, Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getWorkerManagerTokens } from './worker-manager.constants';
import {
  WorkerManagerBoard,
  WorkerManagerModuleOptions,
  WorkerManagerPgBossBoard,
  WorkerManagerQueueOptions,
} from './worker-manager.types';
import { isPgBossBoard, registerQueues } from './worker-manager.util';

const featureModules = new Map<string | undefined, Type<unknown>>();

/** The feature module class that registers queues into one board, memoised per board name. */
export function getWorkerManagerFeatureModule(name?: string): Type<unknown> {
  let featureModule = featureModules.get(name);
  if (!featureModule) {
    featureModule = createFeatureModule(name);
    featureModules.set(name, featureModule);
  }
  return featureModule;
}

function createFeatureModule(name: string | undefined): Type<unknown> {
  const tokens = getWorkerManagerTokens(name);

  @Module({})
  class WorkerManagerFeatureModule implements OnModuleInit {
    constructor(
      private readonly moduleRef: ModuleRef,
      @Inject(tokens.queues) private readonly queues: WorkerManagerQueueOptions[],
      @Inject(tokens.instance)
      private readonly board: WorkerManagerBoard | WorkerManagerPgBossBoard | null,
      @Inject(tokens.options) private readonly options: WorkerManagerModuleOptions
    ) {}

    onModuleInit(): any {
      if (this.options?.engine === 'pg-boss' && this.queues.length) {
        throw new Error(
          `WorkerManagerModule.forFeature()${name === undefined ? '' : ` for board "${name}"`} registers ` +
            "BullMQ queues, but that board has `engine: 'pg-boss'`. A pg-boss board lists the " +
            'queues of its schema; narrow them with `pgBoss.queues`.'
        );
      }
      // `enabled: false` leaves no board to register into.
      if (!this.board || isPgBossBoard(this.board)) return;

      registerQueues(this.board, this.moduleRef, this.queues, this.options?.readOnly);
    }
  }

  if (name !== undefined) {
    Object.defineProperty(WorkerManagerFeatureModule, 'name', {
      value: `WorkerManagerFeatureModule_${name}`,
    });
  }

  return WorkerManagerFeatureModule;
}

export const WorkerManagerFeatureModule = getWorkerManagerFeatureModule();
