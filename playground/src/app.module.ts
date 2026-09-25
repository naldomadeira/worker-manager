import { Module } from '@nestjs/common';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { WorkerManagerModule } from '@worker-manager/nestjs';
import { config } from './config';
import { HomeController } from './home.controller';
import { PGBOSS_SCHEMA, pgBoss } from './pgboss/pgboss';
import { PgBossService } from './pgboss/pgboss.service';
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

/** Links each board to the other, so the two can be told apart and reached from the sidebar. */
const BULLMQ_LINK = { text: 'BullMQ board', url: '/queues' };
const PGBOSS_LINK = { text: 'pg-boss board', url: '/pg-boss' };

/** The second board, over the `pgboss` schema, mounted when WM_PGBOSS is on (the default). */
const pgBossBoard = pgBoss
  ? [
      WorkerManagerModule.forRoot({
        name: 'pgboss',
        route: '/pg-boss',
        engine: 'pg-boss',
        auth: boardAuth(),
        readOnly: config.readOnly,
        title: 'Worker Manager Playground (pg-boss)',
        uiConfig: {
          environment: { label: 'playground', color: '#0ea5e9' },
          miscLinks: [BULLMQ_LINK, { text: 'Keycloak admin', url: config.keycloak.url }],
        },
        // `connection` next to `instance`: reads then get a server-side statement_timeout.
        pgBoss: {
          instance: pgBoss,
          connection: config.postgresUrl,
          schema: PGBOSS_SCHEMA,
          delimiter: '.',
        },
      }),
    ]
  : [];

@Module({
  imports: [
    WorkerManagerModule.forRoot({
      route: '/queues',
      // No `adapter`: the module detects Express from the running Nest app.
      auth: boardAuth(),
      readOnly: config.readOnly,
      title: 'Worker Manager Playground',
      uiConfig: {
        environment: { label: 'playground', color: '#6366f1' },
        overview: { groupByDelimiter: true },
        miscLinks: [
          ...(pgBoss ? [PGBOSS_LINK] : []),
          { text: 'Keycloak admin', url: config.keycloak.url },
        ],
      },
      queues: allQueues.map((queue) => ({ queue, name: queue.name, adapter: BullMQAdapter })),
    }),
    ...pgBossBoard,
  ],
  controllers: [HomeController],
  providers: [TrafficService, ...(pgBoss ? [PgBossService] : [])],
})
export class AppModule {}
