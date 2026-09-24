import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { WorkerManagerModule } from '@worker-manager/nestjs';

// example feature module, feature can be anything. eg. user module
@Module({
  imports: [
    BullModule.registerQueue({
      name: 'feature_queue',
    }),

    //Register each queue using the `forFeature` method.
    WorkerManagerModule.forFeature({
      name: 'feature_queue',
      adapter: BullMQAdapter,
    }),
  ],
})
export class FeatureModule {}
