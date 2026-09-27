import { INestApplication, Module } from '@nestjs/common';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { uiFixtureBasePath } from '@worker-manager/test-utils';
import { Queue } from 'bullmq';
import { WorkerManagerModule } from '../../src';
import { boot, http, platforms, queueNames } from '../support/app';
import { connection, uniqueName } from '../support/queues';

const TOKEN = 'board-token-0123456789abcdefghijklmnop';
const HOST = 'board.test';

const setCookies = (res: { headers: Record<string, any> }): string[] =>
  ([] as string[]).concat(res.headers['set-cookie'] ?? []);

describe.each(platforms)('Token scenario on %s', (platform) => {
  let app: INestApplication;
  let queue: Queue;

  beforeAll(async () => {
    queue = new Queue(uniqueName('token'), { connection });
    queue.on('error', () => undefined);
    await queue.waitUntilReady();

    @Module({
      imports: [
        WorkerManagerModule.forRootAsync({
          useFactory: () => ({
            route: '/admin/queues',
            boardOptions: { uiBasePath: uiFixtureBasePath },
            queues: [{ queue, adapter: BullMQAdapter }],
            auth: {
              strategy: 'token',
              tokens: [TOKEN],
              header: 'X-Board-Token',
              cookie: { secret: 'a-session-secret-of-at-least-32-characters' },
            },
          }),
        }),
        WorkerManagerModule.forRoot({
          name: 'ops',
          route: '/ops',
          boardOptions: { uiBasePath: uiFixtureBasePath },
          auth: {
            strategy: 'token',
            tokens: [TOKEN],
            cookie: { secret: 'a-session-secret-of-at-least-32-characters' },
          },
        }),
      ],
    })
    class AppModule {}

    app = await boot(AppModule, platform);
  });

  afterAll(async () => {
    await app.close();
    await queue.close();
  });

  it('lists the queue for the token header and answers 401 JSON without it', async () => {
    const ok = await http(app).get('/admin/queues/api/queues').set('X-Board-Token', TOKEN);
    expect(ok.status).toBe(200);
    expect(queueNames(ok)).toEqual([queue.name]);

    const denied = await http(app)
      .get('/admin/queues/api/queues')
      .set('Accept', 'application/json');
    expect(denied.status).toBe(401);
    expect(JSON.parse(denied.text).error).toEqual({ key: 'ERRORS.UNAUTHORIZED' });
  });

  it('sends a page load to the login form', async () => {
    const res = await http(app)
      .get('/admin/queues')
      .set('Accept', 'text/html')
      .set('Sec-Fetch-Dest', 'document');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/queues/auth/login?returnTo=%2Fadmin%2Fqueues');

    const form = await http(app).get('/admin/queues/auth/login');
    expect(form.status).toBe(200);
    expect(form.text).toContain('action="/admin/queues/auth/login"');
  });

  it('logs a browser in through the form and serves the board on the session cookie', async () => {
    const login = await http(app)
      .post('/admin/queues/auth/login')
      .set('Host', HOST)
      .set('Origin', `http://${HOST}`)
      .type('form')
      .send({ token: TOKEN, returnTo: '/admin/queues/queue/x' });

    expect(login.status).toBe(303);
    expect(login.headers.location).toBe('/admin/queues/queue/x');
    const [cookie] = setCookies(login);
    expect(cookie).toMatch(/^wm_session=[^;]+; Path=\/admin\/queues; SameSite=Strict; HttpOnly/);

    const session = cookie.split(';')[0];
    const board = await http(app).get('/admin/queues/api/queues').set('Cookie', session);
    expect(board.status).toBe(200);

    const me = await http(app).get('/admin/queues/auth/me').set('Cookie', session);
    expect(JSON.parse(me.text)).toEqual({
      strategy: 'token',
      user: { username: 'token', roles: [] },
      logoutUrl: '/admin/queues/auth/logout',
    });
  });

  it('refuses a login posted from another origin', async () => {
    const res = await http(app)
      .post('/admin/queues/auth/login')
      .set('Host', HOST)
      .set('Origin', 'http://evil.test')
      .type('form')
      .send({ token: TOKEN });

    expect(res.status).toBe(403);
    expect(setCookies(res)).toEqual([]);
  });

  it('names the session cookie of a named board after it', async () => {
    const login = await http(app)
      .post('/ops/auth/login')
      .set('Host', HOST)
      .set('Origin', `http://${HOST}`)
      .type('form')
      .send({ token: TOKEN });

    expect(login.status).toBe(303);
    expect(setCookies(login)[0]).toMatch(/^wm_session_ops=[^;]+; Path=\/ops;/);
  });
});
