import { DynamicModule, Module } from '@nestjs/common';
import { WORKER_MANAGER_QUEUES } from './worker-manager.constants';
import { WorkerManagerFeatureModule } from './worker-manager.feature-module';
import { WorkerManagerRootModule } from './worker-manager.root-module';
import {
  WorkerManagerModuleAsyncOptions,
  WorkerManagerModuleOptions,
  WorkerManagerQueueOptions,
} from './worker-manager.types';

@Module({})
export class WorkerManagerModule {
  static forFeature(...queues: WorkerManagerQueueOptions[]): DynamicModule {
    return {
      module: WorkerManagerFeatureModule,
      providers: [
        {
          provide: WORKER_MANAGER_QUEUES,
          useValue: queues,
        },
      ],
    };
  }

  static forRoot(options: WorkerManagerModuleOptions = {}): DynamicModule {
    return {
      module: WorkerManagerModule,
      imports: [WorkerManagerRootModule.forRoot(options)],
      exports: [WorkerManagerRootModule],
    };
  }

  static forRootAsync(options: WorkerManagerModuleAsyncOptions): DynamicModule {
    return {
      module: WorkerManagerModule,
      imports: [WorkerManagerRootModule.forRootAsync(options)],
      exports: [WorkerManagerRootModule],
    };
  }
}
