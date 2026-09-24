import { Module } from '@nestjs/common';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { WorkerManagerModule } from '@worker-manager/nestjs';
import { config } from './config';
import { HomeController } from './home.controller';
import { allQueues } from './queues/queues';
import { TrafficService } from './queues/traffic.service';

/** The board's auth, picked by WM_AUTH so one app validates all three modes. */
function boardAuth() {
  switch (config.auth) {
    case 'basic':
      return {
        strategy: 'basic' as const,
        realm: 'Worker Manager playground',
        users: [{ ...config.basic, name: 'Playground Admin', roles: ['admin'] }],
      };
    case 'keycloak':
      return {
        strategy: 'keycloak' as const,
        url: config.keycloak.url,
        realm: config.keycloak.realm,
        clientId: config.keycloak.clientId,
        clientSecret: config.keycloak.clientSecret,
        requiredRoles: config.keycloak.requiredRoles,
        publicUrl: `http://localhost:${config.port}`,
        cookie: { secret: config.keycloak.cookieSecret, secure: false },
      };
    default:
      return undefined;
  }
}

@Module({
  imports: [
    WorkerManagerModule.forRoot({
      route: '/queues',
      // No `adapter`: the module detects Express from the running Nest app.
      auth: boardAuth(),
      title: 'Worker Manager Playground',
      uiConfig: {
        environment: { label: 'playground', color: '#6366f1' },
        overview: { groupByDelimiter: true },
        miscLinks: [{ text: 'Keycloak admin', url: config.keycloak.url }],
      },
      queues: allQueues.map((queue) => ({ queue, name: queue.name, adapter: BullMQAdapter })),
    }),
  ],
  controllers: [HomeController],
  providers: [TrafficService],
})
export class AppModule {}
