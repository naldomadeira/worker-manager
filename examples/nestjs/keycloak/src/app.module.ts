import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WorkerManagerModule } from '@worker-manager/nestjs';
import { QueuesModule } from './queues.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: Number(config.get('REDIS_PORT', 6411)),
        },
      }),
    }),
    WorkerManagerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        route: '/queues',
        title: 'NestJS + Keycloak',
        auth: {
          strategy: 'keycloak',
          url: config.getOrThrow('KEYCLOAK_URL'),
          realm: config.getOrThrow('KEYCLOAK_REALM'),
          clientId: config.getOrThrow('KEYCLOAK_CLIENT_ID'),
          clientSecret: config.get('KEYCLOAK_CLIENT_SECRET'),
          publicUrl: config.get('BOARD_PUBLIC_URL'),
          requiredRoles: [config.get('KEYCLOAK_REQUIRED_ROLE', 'wm-admin')],
          cookie: { secret: config.getOrThrow('BOARD_SESSION_SECRET') },
        },
      }),
    }),
    QueuesModule,
  ],
})
export class AppModule {}
