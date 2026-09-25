import { Injectable, INestApplication, Module } from '@nestjs/common';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { createPgBossStubEngine } from '@worker-manager/api/engine';
import { uiFixtureBasePath } from '@worker-manager/test-utils';
import { Queue } from 'bullmq';
import {
  getWorkerManagerToken,
  InjectWorkerManager,
  WORKER_MANAGER_INSTANCE,
  WorkerManagerModule,
  type WorkerManagerBoard,
  type WorkerManagerPgBossBoard,
} from '../../src';
import { basic, boot, bootError, http, platforms, queueNames } from '../support/app';
import { FakeOidcProvider } from '../support/fake-oidc';
import { connection, uniqueName } from '../support/queues';

const users = (username: string) => ({
  strategy: 'basic' as const,
  users: [{ username, password: 's3cret' }],
});

const openQueue = async (label: string) => {
  const queue = new Queue(uniqueName(label), { connection });
  queue.on('error', () => undefined);
  await queue.waitUntilReady();
  return queue;
};

const setCookies = (res: { headers: Record<string, any> }): string[] =>
  [res.headers['set-cookie'] ?? []].flat();

describe.each(platforms)('Named boards on %s', (platform) => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('serves two BullMQ boards and the unnamed one side by side', async () => {
    const [ops, billing, main] = await Promise.all([
      openQueue('ops'),
      openQueue('billing'),
      openQueue('main'),
    ]);

    @Injectable()
    class BoardConsumer {
      constructor(
        @InjectWorkerManager('ops') readonly ops: WorkerManagerBoard,
        @InjectWorkerManager('billing') readonly billing: WorkerManagerBoard,
        @InjectWorkerManager() readonly main: WorkerManagerBoard
      ) {}
    }

    @Module({
      imports: [
        WorkerManagerModule.forRoot({
          boardOptions: { uiBasePath: uiFixtureBasePath },
          queues: [{ queue: main, adapter: BullMQAdapter }],
        }),
        WorkerManagerModule.forRoot({
          name: 'ops',
          route: '/ops',
          auth: users('ops'),
          boardOptions: { uiBasePath: uiFixtureBasePath },
          queues: [{ queue: ops, adapter: BullMQAdapter }],
        }),
        WorkerManagerModule.forRootAsync({
          name: 'billing',
          useFactory: () => ({
            route: '/billing',
            auth: users('billing'),
            boardOptions: { uiBasePath: uiFixtureBasePath },
          }),
        }),
        WorkerManagerModule.forFeature('billing', { queue: billing, adapter: BullMQAdapter }),
      ],
      providers: [BoardConsumer],
    })
    class AppModule {}

    try {
      app = await boot(AppModule, platform);

      const asOps = basic('ops', 's3cret');
      const asBilling = basic('billing', 's3cret');
      expect(queueNames(await http(app).get('/queues/api/queues').expect(200))).toEqual([
        main.name,
      ]);
      expect(
        queueNames(await http(app).get('/ops/api/queues').set('Authorization', asOps))
      ).toEqual([ops.name]);
      expect(
        queueNames(await http(app).get('/billing/api/queues').set('Authorization', asBilling))
      ).toEqual([billing.name]);
      expect((await http(app).get('/ops/api/queues')).status).toBe(401);
      expect((await http(app).get('/ops/api/queues').set('Authorization', asBilling)).status).toBe(
        401
      );
      expect((await http(app).get('/billing/api/queues').set('Authorization', asOps)).status).toBe(
        401
      );

      const consumer = app.get(BoardConsumer);
      expect(consumer.ops).toBe(app.get(getWorkerManagerToken('ops')));
      expect(consumer.billing).toBe(app.get('worker_manager_instance:billing'));
      expect(consumer.main).toBe(app.get(WORKER_MANAGER_INSTANCE));
      expect(new Set([consumer.ops, consumer.billing, consumer.main]).size).toBe(3);
    } finally {
      await Promise.all([ops.close(), billing.close(), main.close()]);
    }
  });

  it('serves a pg-boss board next to a BullMQ one', async () => {
    const queue = await openQueue('beside-pgboss');
    const alpha = uniqueName('alpha');
    const engine = createPgBossStubEngine({ queues: [alpha] });

    @Module({
      imports: [
        WorkerManagerModule.forRoot({
          boardOptions: { uiBasePath: uiFixtureBasePath },
          queues: [{ queue, adapter: BullMQAdapter }],
        }),
        WorkerManagerModule.forRoot({
          name: 'jobs',
          route: '/pg-boss',
          engine: 'pg-boss',
          auth: users('pg'),
          boardOptions: { uiBasePath: uiFixtureBasePath },
          pgBoss: { engine },
        }),
      ],
    })
    class AppModule {}

    try {
      app = await boot(AppModule, platform);
      const asPg = basic('pg', 's3cret');

      const entry = await http(app).get('/pg-boss').set('Authorization', asPg);
      expect(entry.status).toBe(200);
      expect(entry.text).toContain('"engine":"pg-boss"');
      expect((await http(app).get('/queues')).text).toContain('"engine":"bullmq"');

      const listed = await http(app).get('/pg-boss/api/pg-boss/queues').set('Authorization', asPg);
      expect(JSON.parse(listed.text).queues.map((q: { name: string }) => q.name)).toEqual([alpha]);
      expect((await http(app).get('/pg-boss/api/pg-boss/queues')).status).toBe(401);
      expect((await http(app).get('/pg-boss/api/queues').set('Authorization', asPg)).status).toBe(
        404
      );
      expect((await http(app).get('/queues/api/pg-boss/queues')).status).toBe(404);
      expect(queueNames(await http(app).get('/queues/api/queues'))).toEqual([queue.name]);

      expect(app.get<WorkerManagerPgBossBoard>(getWorkerManagerToken('jobs')).engine).toBe(engine);
    } finally {
      await queue.close();
    }
  });

  it('scopes the Keycloak session cookie of a named board to its name', async () => {
    const idp = new FakeOidcProvider();
    await idp.start();
    const keycloak = {
      strategy: 'keycloak' as const,
      url: idp.url,
      realm: idp.realm,
      clientId: idp.clientId,
      clientSecret: idp.clientSecret,
      cookie: { secret: 'a-test-secret-that-is-long-enough-123456' },
    };

    @Module({
      imports: [
        WorkerManagerModule.forRoot({
          boardOptions: { uiBasePath: uiFixtureBasePath },
          auth: keycloak,
        }),
        WorkerManagerModule.forRoot({
          name: 'ops',
          route: '/ops',
          boardOptions: { uiBasePath: uiFixtureBasePath },
          auth: keycloak,
        }),
        WorkerManagerModule.forRoot({
          name: 'custom',
          route: '/custom',
          boardOptions: { uiBasePath: uiFixtureBasePath },
          auth: { ...keycloak, cookie: { ...keycloak.cookie, name: 'mine' } },
        }),
      ],
    })
    class AppModule {}

    try {
      app = await boot(AppModule, platform);

      const main = await http(app).get('/queues/auth/login');
      const ops = await http(app).get('/ops/auth/login');
      const custom = await http(app).get('/custom/auth/login');

      expect(main.status).toBe(302);
      expect(setCookies(main).join('\n')).toMatch(/^wm_session_flow=.*Path=\/queues(;|$)/m);
      expect(setCookies(ops).join('\n')).toMatch(/^wm_session_ops_flow=.*Path=\/ops(;|$)/m);
      expect(setCookies(custom).join('\n')).toMatch(/^mine_flow=.*Path=\/custom(;|$)/m);
      expect(new URL(ops.headers.location).searchParams.get('redirect_uri')).toMatch(
        /\/ops\/auth\/callback$/
      );
    } finally {
      await app?.close();
      app = undefined;
      await idp.stop();
    }
  });

  it('leaves a disabled named board unregistered', async () => {
    @Module({
      imports: [
        WorkerManagerModule.forRoot({ boardOptions: { uiBasePath: uiFixtureBasePath } }),
        WorkerManagerModule.forRoot({ name: 'off', route: '/off', enabled: false }),
      ],
    })
    class AppModule {}

    app = await boot(AppModule, platform);

    expect(app.get(getWorkerManagerToken('off'))).toBeNull();
    expect((await http(app).get('/off/api/queues')).status).toBe(404);
    expect((await http(app).get('/queues/api/queues')).status).toBe(200);
  });
});

describe('Named board configuration errors', () => {
  const pgBoss = { engine: createPgBossStubEngine() };

  it('rejects queues on a pg-boss board', () => {
    expect(() =>
      WorkerManagerModule.forRoot({
        name: 'jobs',
        engine: 'pg-boss',
        pgBoss,
        queues: [{ name: 'emails', adapter: BullMQAdapter }],
      })
    ).toThrow(/`queues` registers BullMQ queues and cannot be used with `engine: 'pg-boss'`/);
  });

  it('rejects a pg-boss board without a connection, an instance or an engine', () => {
    expect(() => WorkerManagerModule.forRoot({ engine: 'pg-boss', pgBoss: {} })).toThrow(
      /needs `pgBoss.instance`, `pgBoss.useExisting` or `pgBoss.connection`/
    );
  });

  it('rejects pgBoss options on a BullMQ board and an unknown engine', () => {
    expect(() => WorkerManagerModule.forRoot({ pgBoss })).toThrow(
      /only read by a board with `engine: 'pg-boss'`/
    );
    expect(() => WorkerManagerModule.forRoot({ engine: 'kafka' as any })).toThrow(
      /unknown engine "kafka"/
    );
  });

  it('rejects an invalid board name', () => {
    expect(() => WorkerManagerModule.forRoot({ name: 'has space' })).toThrow(/board name/);
  });

  it('rejects forFeature into a pg-boss board at bootstrap', async () => {
    @Module({
      imports: [
        WorkerManagerModule.forRoot({
          name: 'jobs',
          route: '/pg-boss',
          engine: 'pg-boss',
          boardOptions: { uiBasePath: uiFixtureBasePath },
          pgBoss,
        }),
        WorkerManagerModule.forFeature('jobs', { name: uniqueName('x'), adapter: BullMQAdapter }),
      ],
    })
    class AppModule {}

    expect((await bootError(AppModule)).message).toMatch(/forFeature\(\) for board "jobs"/);
  });

  it('rejects queues returned by a forRootAsync factory for a pg-boss board', async () => {
    @Module({
      imports: [
        WorkerManagerModule.forRootAsync({
          name: 'jobs',
          useFactory: () => ({
            route: '/pg-boss',
            engine: 'pg-boss' as const,
            pgBoss,
            queues: [{ name: uniqueName('x'), adapter: BullMQAdapter }],
          }),
        }),
      ],
    })
    class AppModule {}

    expect((await bootError(AppModule)).message).toMatch(/cannot be used with `engine: 'pg-boss'`/);
  });

  it('rejects a forRootAsync factory that names a different board', async () => {
    @Module({
      imports: [
        WorkerManagerModule.forRootAsync({
          name: 'jobs',
          useFactory: () => ({ name: 'other', boardOptions: { uiBasePath: uiFixtureBasePath } }),
        }),
      ],
    })
    class AppModule {}

    expect((await bootError(AppModule)).message).toMatch(/Pass `name` to forRootAsync\(\) itself/);
  });
});
