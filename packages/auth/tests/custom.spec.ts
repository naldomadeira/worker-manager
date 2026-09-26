import type { IncomingMessage } from 'node:http';
import { createAuthMiddleware, type CustomAuthOptions } from '../src';
import { startBoard, type Harness } from './harness';

const fromAccessHeader = async (req: IncomingMessage) => {
  const email = req.headers['cf-access-authenticated-user-email'];
  if (email === 'boom@example.com') throw new Error('identity provider unreachable');
  if (email === 'shapeless@example.com') return { name: 'no username' } as any;
  return typeof email === 'string' ? { username: email, email } : null;
};

describe('custom strategy', () => {
  let board: Harness;

  beforeAll(async () => {
    board = await startBoard({
      strategy: 'custom',
      authenticate: fromAccessHeader,
      logoutUrl: '/cdn-cgi/access/logout',
    });
  });

  afterAll(() => board.close());

  it('attaches the user authenticate() resolves, with roles defaulting to []', async () => {
    const response = await fetch(`${board.url}/queues/api/queues`, {
      headers: { 'cf-access-authenticated-user-email': 'ops@example.com' },
    });

    expect(response.status).toBe(200);
    expect(((await response.json()) as any).user).toEqual({
      username: 'ops@example.com',
      email: 'ops@example.com',
      roles: [],
    });
  });

  it('serves /auth/me with the configured logout URL', async () => {
    const response = await fetch(`${board.url}/queues/auth/me`, {
      headers: { 'cf-access-authenticated-user-email': 'ops@example.com' },
    });

    expect(await response.json()).toEqual({
      strategy: 'custom',
      user: { username: 'ops@example.com', email: 'ops@example.com', roles: [] },
      logoutUrl: '/cdn-cgi/access/logout',
    });
  });

  it('answers 401 JSON when authenticate() resolves null', async () => {
    const response = await fetch(`${board.url}/queues/api/queues`);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { key: 'ERRORS.UNAUTHORIZED' },
      code: 'UNAUTHORIZED',
    });
  });

  it('fails the request with the error authenticate() throws', async () => {
    const response = await fetch(`${board.url}/queues/api/queues`, {
      headers: { 'cf-access-authenticated-user-email': 'boom@example.com' },
    });

    expect(response.status).toBe(500);
    expect(await response.text()).toContain('identity provider unreachable');
  });

  it('fails the request when authenticate() resolves a user without a username', async () => {
    const response = await fetch(`${board.url}/queues/api/queues`, {
      headers: { 'cf-access-authenticated-user-email': 'shapeless@example.com' },
    });

    expect(response.status).toBe(500);
    expect(await response.text()).toContain('string `username`');
  });

  it('lets onUnauthenticated answer instead of the default 401', async () => {
    const custom = await startBoard({
      strategy: 'custom',
      authenticate: () => null,
      onUnauthenticated: (_req, res) => {
        res.statusCode = 302;
        res.setHeader('Location', 'https://sso.example.com/login');
        res.end();
      },
    });
    try {
      const response = await fetch(`${custom.url}/queues/`, { redirect: 'manual' });
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('https://sso.example.com/login');
    } finally {
      await custom.close();
    }
  });

  it('still sends the default 401 when onUnauthenticated leaves the response open', async () => {
    const onUnauthenticated = jest.fn(async (_req, res) => {
      res.setHeader('X-Seen', 'yes');
    });
    const custom = await startBoard({
      strategy: 'custom',
      authenticate: async () => undefined,
      onUnauthenticated,
    });
    try {
      const response = await fetch(`${custom.url}/queues/api/queues`);
      expect(response.status).toBe(401);
      expect(response.headers.get('x-seen')).toBe('yes');
      expect(onUnauthenticated).toHaveBeenCalledTimes(1);
    } finally {
      await custom.close();
    }
  });

  it('hides the logout link and runs onAuthenticated', async () => {
    const custom = await startBoard({
      strategy: 'custom',
      authenticate: () => ({ username: 'viewer', roles: ['read'] }),
      onAuthenticated: (user) => user.roles.includes('read'),
    });
    try {
      const me = await fetch(`${custom.url}/queues/auth/me`);
      expect(((await me.json()) as any).logoutUrl).toBeNull();
    } finally {
      await custom.close();
    }

    const denied = await startBoard({
      strategy: 'custom',
      authenticate: () => ({ username: 'viewer', roles: [] }),
      onAuthenticated: () => false,
    });
    try {
      expect((await fetch(`${denied.url}/queues/`)).status).toBe(403);
    } finally {
      await denied.close();
    }
  });

  it('refuses a configuration without authenticate', () => {
    expect(() => createAuthMiddleware({ strategy: 'custom' } as CustomAuthOptions)).toThrow(
      /authenticate/
    );
  });
});
