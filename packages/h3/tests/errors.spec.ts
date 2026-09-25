import { createWorkerManagerBoard } from '@worker-manager/api';
import { seedQueue, SeededQueue, uiFixtureBasePath } from '@worker-manager/test-utils';
import { createApp, toNodeListener } from 'h3';
import request from 'supertest';
import { H3Adapter } from '../src';

type WebApp = { fetch: (request: Request) => Promise<Response> };

const hasFetch = (app: unknown): app is WebApp => typeof (app as WebApp).fetch === 'function';

describe('H3Adapter error responses', () => {
  let queue: SeededQueue;
  let send: (method: 'put', path: string) => Promise<{ status: number; text: string }>;

  beforeAll(async () => {
    queue = await seedQueue('h3-errors');

    const serverAdapter = new H3Adapter();
    createWorkerManagerBoard({
      queues: [queue.adapter],
      serverAdapter,
      options: { uiBasePath: uiFixtureBasePath },
    });

    const app = createApp();
    app.use(serverAdapter.registerHandlers());

    // Same split as the contract spec: h3@2 is driven through `fetch`, h3@1 through node.
    send = hasFetch(app)
      ? async (method, path) => {
          const res = await app.fetch(new Request(`http://localhost${path}`, { method }));
          return { status: res.status, text: await res.text() };
        }
      : async (method, path) => {
          const res = await request(toNodeListener(app))[method](path);
          return { status: res.status, text: res.text };
        };
  });

  afterAll(async () => {
    await queue.close();
  });

  // Replaced by hand rather than with `jest.spyOn`: the h3@2 project runs as ESM, where the
  // `jest` global is not defined.
  const failingPause = async (error: Error) => {
    const original = queue.adapter.pause;
    queue.adapter.pause = async () => {
      throw error;
    };
    try {
      return await send('put', `/api/queues/${queue.name}/pause`);
    } finally {
      queue.adapter.pause = original;
    }
  };

  it('answers a thrown handler error with the top-level ErrorResponseBody', async () => {
    const res = await failingPause(new Error('boom'));

    expect(res.status).toBe(500);
    expect(JSON.parse(res.text)).toEqual({
      error: { key: 'ERRORS.INTERNAL_SERVER_ERROR' },
      message: 'boom',
    });
  });

  it('keeps the status code of an error that carries one', async () => {
    const res = await failingPause(Object.assign(new Error('slow down'), { statusCode: 429 }));

    expect(res.status).toBe(429);
    expect(JSON.parse(res.text).error).toEqual({ key: 'ERRORS.INTERNAL_SERVER_ERROR' });
  });
});
