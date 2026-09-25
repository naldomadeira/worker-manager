import { Module } from '@nestjs/common';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { uiFixtureBasePath } from '@worker-manager/test-utils';
import { Queue } from 'bullmq';
import { WorkerManagerModule } from '../../src';
import { boot, http, queueNames } from '../support/app';
import { connection, uniqueName } from '../support/queues';

describe('forFeature with queue instances', () => {
  it('registers two queues sharing a name under different prefixes as distinct entries', async () => {
    const name = uniqueName('emails');
    const tenantA = new Queue(name, { connection, prefix: 'tenant-a' });
    const tenantB = new Queue(name, { connection, prefix: 'tenant-b' });

    @Module({
      imports: [
        WorkerManagerModule.forRoot({ boardOptions: { uiBasePath: uiFixtureBasePath } }),
        WorkerManagerModule.forFeature(
          { queue: tenantA, adapter: BullMQAdapter, options: { prefix: 'tenant-a:' } },
          { queue: tenantB, adapter: BullMQAdapter, options: { prefix: 'tenant-b:' } }
        ),
      ],
    })
    class AppModule {}

    const app = await boot(AppModule);
    try {
      const res = await http(app).get('/queues/api/queues').expect(200);
      expect(queueNames(res).sort()).toEqual([`tenant-a:${name}`, `tenant-b:${name}`]);
    } finally {
      await app.close();
      await Promise.all([tenantA.close(), tenantB.close()]);
    }
  });
});
