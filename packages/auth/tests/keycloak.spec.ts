import type { KeycloakAuthOptions } from '../src';
import { FakeOidcProvider, type FakeUser } from './fakeOidc';
import { CookieJar, startBoard, type Harness } from './harness';

const admin: FakeUser = {
  sub: 'u-1',
  preferred_username: 'alice',
  name: 'Alice Admin',
  email: 'alice@example.com',
  realmRoles: ['wm-admin', 'offline_access'],
};
const viewer: FakeUser = { sub: 'u-2', preferred_username: 'bob', realmRoles: ['wm-viewer'] };
const clientRoleUser: FakeUser = {
  sub: 'u-3',
  preferred_username: 'carol',
  clientRoles: ['wm-admin'],
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const HTML = { accept: 'text/html,application/xhtml+xml' };

describe('keycloak strategy', () => {
  const idp = new FakeOidcProvider();
  let board: Harness;

  const options = (overrides: Partial<KeycloakAuthOptions> = {}): KeycloakAuthOptions => ({
    strategy: 'keycloak',
    url: idp.url,
    realm: idp.realm,
    clientId: idp.clientId,
    clientSecret: idp.clientSecret,
    requiredRoles: ['wm-admin'],
    cookie: { secret: 'a-test-secret-that-is-long-enough-123456' },
    ...overrides,
  });

  beforeAll(async () => {
    await idp.start();
    board = await startBoard(options());
  });

  afterAll(async () => {
    await board.close();
    await idp.stop();
  });

  /** Drives the whole browser flow: navigation, IdP login, callback. */
  async function login(user: FakeUser, target = '/queues/') {
    const jar = new CookieJar();
    const start = await fetch(`${board.url}${target}`, { headers: HTML, redirect: 'manual' });
    expect(start.status).toBe(302);
    jar.store(start);
    const authorizeUrl = start.headers.get('location')!;

    const { code, state } = idp.issueCode(authorizeUrl, user);
    const callback = await fetch(
      `${board.url}/queues/auth/callback?code=${code}&state=${encodeURIComponent(state)}`,
      { headers: { ...HTML, cookie: jar.header() }, redirect: 'manual' }
    );
    jar.store(callback);

    return { jar, authorizeUrl, callback };
  }

  describe('bearer tokens', () => {
    it('accepts a valid token carrying a required realm role', async () => {
      const token = await idp.accessToken(admin);
      const response = await fetch(`${board.url}/queues/api/queues`, {
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.status).toBe(200);
      expect(((await response.json()) as any).user).toEqual({
        username: 'alice',
        name: 'Alice Admin',
        email: 'alice@example.com',
        roles: ['wm-admin', 'offline_access'],
      });
    });

    it('accepts a required role granted as a client role', async () => {
      const token = await idp.accessToken(clientRoleUser);
      const response = await fetch(`${board.url}/queues/api/queues`, {
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.status).toBe(200);
    });

    it('rejects an expired token with 401', async () => {
      const token = await idp.accessToken(admin, { expiresIn: -120 });
      const response = await fetch(`${board.url}/queues/api/queues`, {
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toMatch(/invalid_token/);
      expect(((await response.json()) as any).error).toEqual({ key: 'ERRORS.UNAUTHORIZED' });
    });

    it('rejects a token from another issuer', async () => {
      const token = await idp.accessToken(admin, { issuer: `${idp.url}/realms/other` });
      const response = await fetch(`${board.url}/queues/api/queues`, {
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.status).toBe(401);
    });

    it('rejects a token issued to another client', async () => {
      const token = await idp.accessToken(admin, { azp: 'someone-else' });
      const response = await fetch(`${board.url}/queues/api/queues`, {
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.status).toBe(401);
    });

    it('answers 403 with ERRORS.FORBIDDEN when the required role is missing', async () => {
      const token = await idp.accessToken(viewer);
      const response = await fetch(`${board.url}/queues/api/queues`, {
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.status).toBe(403);
      expect(((await response.json()) as any).error).toEqual({ key: 'ERRORS.FORBIDDEN' });
    });

    it('reports a bearer identity on /auth/me with no logout URL', async () => {
      const token = await idp.accessToken(admin);
      const response = await fetch(`${board.url}/queues/auth/me`, {
        headers: { authorization: `Bearer ${token}` },
      });

      expect((await response.json()) as any).toEqual({
        strategy: 'keycloak',
        user: expect.objectContaining({ username: 'alice' }),
        logoutUrl: null,
      });
    });
  });

  describe('unauthenticated requests', () => {
    it('answers an API call with 401 JSON rather than a redirect', async () => {
      const response = await fetch(`${board.url}/queues/api/queues`, {
        headers: { accept: 'application/json' },
        redirect: 'manual',
      });

      expect(response.status).toBe(401);
      expect(((await response.json()) as any).error).toEqual({ key: 'ERRORS.UNAUTHORIZED' });
    });

    it('answers /auth/me with 401 JSON even from a browser', async () => {
      const response = await fetch(`${board.url}/queues/auth/me`, { redirect: 'manual' });

      expect(response.status).toBe(401);
    });

    it('redirects a navigation to the authorization endpoint with PKCE S256 and state', async () => {
      const response = await fetch(`${board.url}/queues/queue/emails?status=failed`, {
        headers: HTML,
        redirect: 'manual',
      });

      expect(response.status).toBe(302);
      const location = new URL(response.headers.get('location')!);
      expect(`${location.origin}${location.pathname}`).toBe(
        `${idp.issuer}/protocol/openid-connect/auth`
      );
      expect(location.searchParams.get('client_id')).toBe(idp.clientId);
      expect(location.searchParams.get('response_type')).toBe('code');
      expect(location.searchParams.get('code_challenge_method')).toBe('S256');
      expect(location.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/);
      expect(location.searchParams.get('state')).toBeTruthy();
      expect(location.searchParams.get('redirect_uri')).toBe(`${board.url}/queues/auth/callback`);
      expect(response.headers.getSetCookie().join()).toMatch(
        /wm_session_flow=.*Path=\/queues; SameSite=Lax; HttpOnly/
      );
    });

    it('derives the redirect URI from forwarding headers', async () => {
      const response = await fetch(`${board.url}/queues/`, {
        headers: { ...HTML, 'x-forwarded-proto': 'https', 'x-forwarded-host': 'ops.example.com' },
        redirect: 'manual',
      });

      const location = new URL(response.headers.get('location')!);
      expect(location.searchParams.get('redirect_uri')).toBe(
        'https://ops.example.com/queues/auth/callback'
      );
      expect(response.headers.getSetCookie().join()).toMatch(/Secure/);
    });
  });

  describe('authorization code flow', () => {
    it('logs in, sets an encrypted session cookie, and returns to the original page', async () => {
      const { jar, callback } = await login(admin, '/queues/queue/emails?status=failed');

      expect(callback.status).toBe(302);
      expect(callback.headers.get('location')).toBe('/queues/queue/emails?status=failed');
      const session = jar.get('wm_session');
      expect(session).toBeTruthy();
      // Encrypted, so neither the username nor the refresh token is readable client side.
      expect(Buffer.from(decodeURIComponent(session!), 'base64url').toString()).not.toContain(
        'alice'
      );

      const me = await fetch(`${board.url}/queues/auth/me`, { headers: { cookie: jar.header() } });
      expect(me.status).toBe(200);
      expect(await me.json()).toEqual({
        strategy: 'keycloak',
        user: {
          username: 'alice',
          name: 'Alice Admin',
          email: 'alice@example.com',
          roles: ['wm-admin', 'offline_access'],
        },
        logoutUrl: '/queues/auth/logout',
      });

      const api = await fetch(`${board.url}/queues/api/queues`, {
        headers: { cookie: jar.header() },
      });
      expect(api.status).toBe(200);
    });

    it('sends the PKCE verifier and client credentials to the token endpoint', async () => {
      idp.tokenRequests = [];
      await login(admin);

      const exchange = idp.tokenRequests.find((p) => p.get('grant_type') === 'authorization_code');
      expect(exchange?.get('code_verifier')).toMatch(/^[\w-]{43}$/);
      expect(exchange?.get('client_secret')).toBe(idp.clientSecret);
    });

    it('rejects a callback whose state does not match the flow cookie', async () => {
      const jar = new CookieJar();
      const start = await fetch(`${board.url}/queues/`, { headers: HTML, redirect: 'manual' });
      jar.store(start);
      const { code } = idp.issueCode(start.headers.get('location')!, admin);

      const callback = await fetch(`${board.url}/queues/auth/callback?code=${code}&state=forged`, {
        headers: { cookie: jar.header() },
        redirect: 'manual',
      });

      expect(callback.status).toBe(401);
      expect(callback.headers.getSetCookie().join()).not.toMatch(/wm_session=[^;]/);
    });

    it('rejects a tampered session cookie', async () => {
      const { jar } = await login(admin);
      const session = decodeURIComponent(jar.get('wm_session')!);
      const tampered = `${session.slice(0, -4)}${session.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA'}`;
      jar.set('wm_session', tampered);

      const response = await fetch(`${board.url}/queues/api/queues`, {
        headers: { cookie: jar.header() },
      });
      expect(response.status).toBe(401);
    });

    it('answers 403 after login when the user lacks the required role', async () => {
      const { callback } = await login(viewer);

      expect(callback.status).toBe(403);
      expect(((await callback.json()) as any).error).toEqual({ key: 'ERRORS.FORBIDDEN' });
    });

    it('refreshes an expired session silently with the refresh token', async () => {
      idp.accessTokenTtl = 1;
      try {
        const { jar } = await login(admin);
        idp.tokenRequests = [];
        await sleep(1100);

        const response = await fetch(`${board.url}/queues/api/queues`, {
          headers: { cookie: jar.header() },
        });

        expect(response.status).toBe(200);
        expect(idp.tokenRequests.map((p) => p.get('grant_type'))).toEqual(['refresh_token']);
        expect(response.headers.getSetCookie().join()).toMatch(/wm_session=[^;]+/);
      } finally {
        idp.accessTokenTtl = 300;
      }
    });

    it('asks for a new login when the refresh token is no longer accepted', async () => {
      idp.accessTokenTtl = 1;
      try {
        const { jar } = await login(admin);
        idp.revokeRefreshTokens();
        await sleep(1100);

        const api = await fetch(`${board.url}/queues/api/queues`, {
          headers: { cookie: jar.header() },
        });
        expect(api.status).toBe(401);

        const page = await fetch(`${board.url}/queues/`, {
          headers: { ...HTML, cookie: jar.header() },
          redirect: 'manual',
        });
        expect(page.status).toBe(302);
        expect(page.headers.get('location')).toContain('/protocol/openid-connect/auth');
      } finally {
        idp.accessTokenTtl = 300;
      }
    });

    it('starts the flow from /auth/login, honouring only same-origin returnTo', async () => {
      const jar = new CookieJar();
      const start = await fetch(`${board.url}/queues/auth/login?returnTo=//evil.example.com`, {
        redirect: 'manual',
      });
      jar.store(start);
      const { code, state } = idp.issueCode(start.headers.get('location')!, admin);
      const callback = await fetch(
        `${board.url}/queues/auth/callback?code=${code}&state=${encodeURIComponent(state)}`,
        { headers: { cookie: jar.header() }, redirect: 'manual' }
      );

      expect(callback.headers.get('location')).toBe('/queues/');
    });
  });

  describe('logout', () => {
    it('clears the session and redirects to the end-session endpoint with an id_token_hint', async () => {
      const { jar } = await login(admin);

      const response = await fetch(`${board.url}/queues/auth/logout`, {
        headers: { cookie: jar.header() },
        redirect: 'manual',
      });

      expect(response.status).toBe(302);
      const location = new URL(response.headers.get('location')!);
      expect(`${location.origin}${location.pathname}`).toBe(
        `${idp.issuer}/protocol/openid-connect/logout`
      );
      expect(location.searchParams.get('post_logout_redirect_uri')).toBe(`${board.url}/queues/`);
      expect(location.searchParams.get('client_id')).toBe(idp.clientId);
      expect(location.searchParams.get('id_token_hint')).toBeTruthy();
      expect(response.headers.getSetCookie().join()).toMatch(/wm_session=;.*Max-Age=0/);

      jar.store(response);
      const me = await fetch(`${board.url}/queues/auth/me`, { headers: { cookie: jar.header() } });
      expect(me.status).toBe(401);
    });
  });

  describe('bearerOnly', () => {
    it('never redirects and serves no login endpoints', async () => {
      const bearerBoard = await startBoard(options({ bearerOnly: true, cookie: undefined }));
      try {
        const page = await fetch(`${bearerBoard.url}/queues/`, {
          headers: HTML,
          redirect: 'manual',
        });
        expect(page.status).toBe(401);

        const token = await idp.accessToken(admin);
        const api = await fetch(`${bearerBoard.url}/queues/api/queues`, {
          headers: { authorization: `Bearer ${token}` },
        });
        expect(api.status).toBe(200);
      } finally {
        await bearerBoard.close();
      }
    });
  });

  describe('publicUrl', () => {
    it('builds the redirect URI from the configured public URL', async () => {
      const proxied = await startBoard(
        options({ publicUrl: 'https://ops.example.com/tools/queues/' })
      );
      try {
        const response = await fetch(`${proxied.url}/queues/`, {
          headers: HTML,
          redirect: 'manual',
        });
        const location = new URL(response.headers.get('location')!);
        expect(location.searchParams.get('redirect_uri')).toBe(
          'https://ops.example.com/tools/queues/auth/callback'
        );
      } finally {
        await proxied.close();
      }
    });

    it('completes a bare origin with the base path', async () => {
      const proxied = await startBoard(options({ publicUrl: 'https://ops.example.com' }));
      try {
        const response = await fetch(`${proxied.url}/queues/`, {
          headers: HTML,
          redirect: 'manual',
        });
        const location = new URL(response.headers.get('location')!);
        expect(location.searchParams.get('redirect_uri')).toBe(
          'https://ops.example.com/queues/auth/callback'
        );
      } finally {
        await proxied.close();
      }
    });
  });
});
