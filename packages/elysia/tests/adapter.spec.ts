import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkerManagerBoard } from '@worker-manager/api';
import { seedQueue, SeededQueue, uiFixtureBasePath } from '@worker-manager/test-utils';
import { Elysia } from 'elysia';
import { ElysiaAdapter } from '../src';

type Sent = { status: number; headers: Record<string, string>; text: string };

async function mountBoard(queue: SeededQueue, uiBasePath: string, prefix = '') {
  const serverAdapter = new ElysiaAdapter({ prefix, basePath: prefix || '/' });
  createWorkerManagerBoard({
    queues: [queue.adapter],
    serverAdapter,
    options: { uiBasePath },
  });

  const app = new Elysia()
    .get('/host-route', () => 'host')
    .use(await serverAdapter.registerPlugin());

  return async (method: string, path: string, init: RequestInit = {}): Promise<Sent> => {
    const res = await app.handle(new Request(`http://localhost${path}`, { method, ...init }));
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => (headers[key] = value));

    return { status: res.status, headers, text: await res.text() };
  };
}

describe('ElysiaAdapter', () => {
  let queue: SeededQueue;

  beforeAll(async () => {
    queue = await seedQueue('elysia');
  });

  afterAll(async () => {
    await queue.close();
  });

  describe('error handling', () => {
    let send: Awaited<ReturnType<typeof mountBoard>>;

    beforeAll(async () => {
      send = await mountBoard(queue, uiFixtureBasePath);
    });

    it('leaves unknown routes of the host application to the host', async () => {
      expect((await send('GET', '/host-route')).text).toBe('host');

      const res = await send('GET', '/definitely-not-a-route');
      expect(res.status).toBe(404);
      expect(res.text).not.toContain('ERRORS.INTERNAL_SERVER_ERROR');
    });

    it('answers a malformed JSON body with a 400 and a translation key', async () => {
      const res = await send(
        'PATCH',
        `/api/queues/${queue.name}/job-schedulers/${queue.schedulerId}`,
        { body: '{"pattern": ', headers: { 'content-type': 'application/json' } }
      );

      expect(res.status).toBe(400);
      expect(JSON.parse(res.text).error).toEqual({ key: 'ERRORS.INVALID_REQUEST_BODY' });
    });

    it('answers a handler failure with the status and body of the error handler', async () => {
      const spy = jest.spyOn(queue.adapter, 'pause').mockRejectedValueOnce(new Error('boom'));
      try {
        const res = await send('PUT', `/api/queues/${queue.name}/pause`);

        expect(res.status).toBe(500);
        expect(JSON.parse(res.text)).toEqual({
          error: { key: 'ERRORS.INTERNAL_SERVER_ERROR' },
          message: 'boom',
        });
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('static assets', () => {
    // An ancestor directory that contains "dist" without being the UI's dist folder. The
    // assets used to be registered relative to the first "dist" in the absolute path.
    let uiBasePath: string;

    beforeAll(() => {
      uiBasePath = mkdtempSync(join(tmpdir(), 'worker-manager-distributed-'));
      cpSync(join(uiFixtureBasePath, 'dist'), join(uiBasePath, 'dist'), { recursive: true });
      mkdirSync(join(uiBasePath, 'dist/static/js/async'), { recursive: true });
      writeFileSync(join(uiBasePath, 'dist/static/js/main.0123abcd.js'), 'console.log(1);\n');
      writeFileSync(join(uiBasePath, 'dist/static/js/async/12.4567ef.js'), 'export {};\n');
    });

    afterAll(() => {
      rmSync(uiBasePath, { recursive: true, force: true });
    });

    it.each([
      ['', ''],
      ['/ui', '/ui'],
    ])(
      'serves assets relative to the statics folder when mounted at "%s"',
      async (_label, prefix) => {
        const send = await mountBoard(queue, uiBasePath, prefix);

        const asset = await send('GET', `${prefix}/static/test-asset.txt`);
        expect(asset.status).toBe(200);
        expect(asset.text).toContain('worker-manager-static-fixture');

        const nested = await send('GET', `${prefix}/static/js/async/12.4567ef.js`);
        expect(nested.status).toBe(200);
        expect(nested.headers['content-type']).toMatch(/javascript/);
      }
    );

    it('marks the content-hashed js and css assets as immutable, and nothing else', async () => {
      const send = await mountBoard(queue, uiBasePath);

      const script = await send('GET', '/static/js/main.0123abcd.js');
      expect(script.headers['cache-control']).toBe('public, max-age=31536000, immutable');

      const other = await send('GET', '/static/test-asset.txt');
      expect(other.headers['cache-control']).toBeUndefined();
    });
  });
});
