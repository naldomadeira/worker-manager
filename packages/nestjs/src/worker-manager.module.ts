import { DynamicModule, Module } from '@nestjs/common';
import { getWorkerManagerTokens } from './worker-manager.constants';
import { getWorkerManagerFeatureModule } from './worker-manager.feature-module';
import { getWorkerManagerRootModule } from './worker-manager.root-module';
import {
  WorkerManagerModuleAsyncOptions,
  WorkerManagerModuleOptions,
  WorkerManagerQueueOptions,
} from './worker-manager.types';

@Module({})
export class WorkerManagerModule {
  /**
   * Registers queues into the unnamed board, or into a named one when the first argument is its
   * name: `forFeature('ops', { name: 'emails', adapter: BullMQAdapter })`.
   */
  static forFeature(...queues: WorkerManagerQueueOptions[]): DynamicModule;
  static forFeature(board: string, ...queues: WorkerManagerQueueOptions[]): DynamicModule;
  static forFeature(...args: Array<string | WorkerManagerQueueOptions>): DynamicModule {
    const [first, ...rest] = args;
    const name = typeof first === 'string' ? first : undefined;
    const queues = (typeof first === 'string' ? rest : args) as WorkerManagerQueueOptions[];

    return {
      module: getWorkerManagerFeatureModule(name),
      providers: [
        {
          provide: getWorkerManagerTokens(name).queues,
          useValue: queues,
        },
      ],
    };
  }

  static forRoot(options: WorkerManagerModuleOptions = {}): DynamicModule {
    const rootModule = getWorkerManagerRootModule(options.name);
    return {
      module: WorkerManagerModule,
      imports: [rootModule.forRoot(options)],
      exports: [rootModule],
    };
  }

  static forRootAsync(options: WorkerManagerModuleAsyncOptions): DynamicModule {
    const rootModule = getWorkerManagerRootModule(options.name);
    return {
      module: WorkerManagerModule,
      imports: [rootModule.forRootAsync(options)],
      exports: [rootModule],
    };
  }
}
