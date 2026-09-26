import { Module } from '@nestjs/common';
import { WorkerManagerModule } from '@worker-manager/nestjs';
import { boss } from './boss';
import { JobsService } from './jobs.service';

@Module({
  imports: [
    WorkerManagerModule.forRoot({
      route: '/pg-boss',
      title: 'NestJS + pg-boss',
      engine: 'pg-boss',
      auth: {
        strategy: 'basic',
        users: [
          {
            username: process.env.BOARD_USERNAME ?? 'admin',
            password: process.env.BOARD_PASSWORD ?? 'admin',
          },
        ],
      },
      pgBoss: { instance: boss },
    }),
  ],
  providers: [JobsService],
})
export class AppModule {}
