import { createAuthMiddleware, safeEqual } from '../src';
import { basicHeader, startBoard, type Harness } from './harness';

describe('basic strategy', () => {
  let board: Harness;
  const validate = jest.fn(async (username: string, password: string) =>
    username === 'dynamic' && password === 'from-db'
      ? { username, roles: ['ops'], email: 'dynamic@example.com' }
      : false
  );

  beforeAll(async () => {
    board = await startBoard({
      strategy: 'basic',
      realm: 'ops board',
      users: [
        { username: 'admin', password: 'correct-password', roles: ['admin'], name: 'Admin' },
        { username: 'viewer', password: 'viewer-password' },
      ],
      validate,
    });
  });

  afterAll(() => board.close());

  it('lets a request with valid credentials through and attaches the user', async () => {
    const response = await fetch(`${board.url}/queues/api/queues`, {
      headers: { authorization: basicHeader('admin', 'correct-password') },
    });

    expect(response.status).toBe(200);
    expect(((await response.json()) as any).user).toEqual({
      username: 'admin',
      name: 'Admin',
      roles: ['admin'],
    });
  });

  it.each([
    ['no header', undefined],
    ['a wrong password of the same length', basicHeader('admin', 'wrong-password!!')],
    ['a shorter password', basicHeader('admin', 'short')],
    ['an unknown user', basicHeader('nobody', 'correct-password')],
    ['a bearer scheme', 'Bearer abc'],
    ['a token without a colon', `Basic ${Buffer.from('admin').toString('base64')}`],
  ])('rejects %s with a 401 challenge and a translation key', async (_label, authorization) => {
    const response = await fetch(`${board.url}/queues/api/queues`, {
      headers: authorization ? { authorization } : {},
    });

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe(
      'Basic realm="ops board", charset="UTF-8"'
    );
    expect(((await response.json()) as any).error).toEqual({ key: 'ERRORS.UNAUTHORIZED' });
  });

  it('falls back to validate() when no static user matches', async () => {
    const response = await fetch(`${board.url}/queues/auth/me`, {
      headers: { authorization: basicHeader('dynamic', 'from-db') },
    });

    expect(response.status).toBe(200);
    expect((await response.json()) as any).toEqual({
      strategy: 'basic',
      user: { username: 'dynamic', roles: ['ops'], email: 'dynamic@example.com' },
      logoutUrl: null,
    });
  });

  it('serves /auth/me for static users', async () => {
    const response = await fetch(`${board.url}/queues/auth/me`, {
      headers: { authorization: basicHeader('viewer', 'viewer-password') },
    });

    expect((await response.json()) as any).toEqual({
      strategy: 'basic',
      user: { username: 'viewer', roles: [] },
      logoutUrl: null,
    });
  });

  it('answers /auth/logout with a fresh challenge so the browser drops its credentials', async () => {
    const response = await fetch(`${board.url}/queues/auth/logout`);

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toMatch(/^Basic /);
  });

  it('refuses a configuration with neither users nor validate', () => {
    expect(() => createAuthMiddleware({ strategy: 'basic' })).toThrow(/users.*validate/);
  });

  it('denies with 403 when onAuthenticated returns false', async () => {
    const guarded = await startBoard({
      strategy: 'basic',
      users: [{ username: 'a', password: 'b' }],
      onAuthenticated: (user) => user.username !== 'a',
    });
    try {
      const response = await fetch(`${guarded.url}/queues/`, {
        headers: { authorization: basicHeader('a', 'b') },
      });
      expect(response.status).toBe(403);
      expect(((await response.json()) as any).error).toEqual({ key: 'ERRORS.FORBIDDEN' });
    } finally {
      await guarded.close();
    }
  });
});

describe('safeEqual', () => {
  it('compares values of different lengths without throwing', () => {
    expect(safeEqual('a', 'a')).toBe(true);
    expect(safeEqual('a', 'much-longer-value')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });

  it('runs the comparison through timingSafeEqual on fixed-size digests', () => {
    // The timing-safe path: both sides are hashed to 32 bytes before comparison, so a length
    // mismatch never short-circuits.
    const crypto = jest.requireActual('node:crypto');
    const spy = jest.spyOn(crypto, 'timingSafeEqual');
    try {
      safeEqual('short', 'a-much-longer-expected-value');
      expect(spy).toHaveBeenCalled();
      const [a, b] = spy.mock.calls[0] as [Buffer, Buffer];
      expect(a.length).toBe(32);
      expect(b.length).toBe(32);
    } finally {
      spy.mockRestore();
    }
  });
});
