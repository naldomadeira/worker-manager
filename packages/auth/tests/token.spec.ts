import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createAuthMiddleware, type TokenAuthOptions } from '../src';
import { Sealer } from '../src/seal';
import { CookieJar, startBoard, type Harness } from './harness';

const TOKEN = 'board-token-0123456789abcdefghijklmnop';
const SECRET = 'a-session-secret-of-at-least-32-characters';
const navigation = { accept: 'text/html', 'sec-fetch-dest': 'document' };
const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
const formHeaders = (origin: string, extra: Record<string, string> = {}) => ({
  'content-type': 'application/x-www-form-urlencoded',
  origin,
  ...extra,
});

describe('token strategy', () => {
  let board: Harness;
  const revoked = new Set<string>();
  const validate = jest.fn(async (token: string) => {
    if (revoked.has(token)) return false;
    if (token === 'dynamic-token-from-the-database') {
      return { username: 'ci', roles: ['deploy'] };
    }
    return token === 'accepted-as-true-token';
  });

  const options: TokenAuthOptions = {
    strategy: 'token',
    tokens: [TOKEN, 'second-static-token-abcdefghijklmnop'],
    validate,
    header: 'X-Board-Token',
    user: { username: 'ops-board', name: 'Ops Board', roles: ['ops'] },
    cookie: { secret: SECRET },
  };

  beforeAll(async () => {
    board = await startBoard(options);
  });

  afterAll(() => board.close());

  const login = (token: string, extra: Record<string, string> = {}, returnTo?: string) =>
    fetch(`${board.url}/queues/auth/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: formHeaders(board.url, extra),
      body: form(returnTo === undefined ? { token } : { token, returnTo }),
    });

  describe('headers', () => {
    it.each([
      ['Authorization: Bearer', { authorization: `Bearer ${TOKEN}` }],
      ['the configured header', { 'x-board-token': TOKEN }],
    ])('accepts a static token in %s and attaches the configured user', async (_label, headers) => {
      const response = await fetch(`${board.url}/queues/api/queues`, { headers });

      expect(response.status).toBe(200);
      expect(((await response.json()) as any).user).toEqual({
        username: 'ops-board',
        name: 'Ops Board',
        roles: ['ops'],
      });
    });

    it('falls back to validate() and attaches the user it returns', async () => {
      const response = await fetch(`${board.url}/queues/auth/me`, {
        headers: { authorization: 'Bearer dynamic-token-from-the-database' },
      });

      expect(await response.json()).toEqual({
        strategy: 'token',
        user: { username: 'ci', roles: ['deploy'] },
        logoutUrl: null,
      });
    });

    it('uses the configured identity when validate() returns true', async () => {
      const response = await fetch(`${board.url}/queues/api/queues`, {
        headers: { 'x-board-token': 'accepted-as-true-token' },
      });

      expect(((await response.json()) as any).user.username).toBe('ops-board');
    });

    it('lets a valid Bearer token through when the custom header is wrong', async () => {
      const response = await fetch(`${board.url}/queues/api/queues`, {
        headers: { 'x-board-token': 'wrong', authorization: `Bearer ${TOKEN}` },
      });

      expect(response.status).toBe(200);
    });

    it.each([
      ['a wrong token of the same length', { authorization: `Bearer ${TOKEN.replace(/.$/, '!')}` }],
      ['a shorter token', { authorization: 'Bearer short' }],
      ['a wrong custom header', { 'x-board-token': 'nope' }],
      ['an oversized token', { authorization: `Bearer ${'x'.repeat(5000)}` }],
    ])('rejects %s with 401 invalid_token and never echoes it', async (_label, headers) => {
      const response = await fetch(`${board.url}/queues/api/queues`, { headers });
      const text = await response.text();

      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe(
        'Bearer realm="worker-manager", error="invalid_token"'
      );
      expect(JSON.parse(text).error).toEqual({ key: 'ERRORS.UNAUTHORIZED' });
      expect(text).not.toContain('nope');
      expect(text).not.toContain('short');
    });

    it('ignores a Basic Authorization header', async () => {
      const response = await fetch(`${board.url}/queues/api/queues`, {
        headers: { authorization: `Basic ${Buffer.from(`x:${TOKEN}`).toString('base64')}` },
      });

      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe('Bearer realm="worker-manager"');
    });

    it('compares against every configured token even on a miss', async () => {
      const crypto = jest.requireActual('node:crypto');
      const spy = jest.spyOn(crypto, 'timingSafeEqual');
      try {
        await fetch(`${board.url}/queues/api/queues`, {
          headers: { authorization: `Bearer ${TOKEN}` },
        });
        expect(spy).toHaveBeenCalledTimes(2);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('unauthenticated requests', () => {
    it('answers an API request with 401 JSON, not a redirect', async () => {
      const response = await fetch(`${board.url}/queues/api/queues`, {
        headers: { accept: 'application/json' },
        redirect: 'manual',
      });

      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe('Bearer realm="worker-manager"');
      expect(((await response.json()) as any).code).toBe('UNAUTHORIZED');
    });

    it('sends a page load to the login form with the page as returnTo', async () => {
      const response = await fetch(`${board.url}/queues/queue/emails?status=failed`, {
        headers: navigation,
        redirect: 'manual',
      });

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe(
        `/queues/auth/login?returnTo=${encodeURIComponent('/queues/queue/emails?status=failed')}`
      );
    });

    it('reloads a cross-site page load from its own origin, so a Strict cookie is sent', async () => {
      const response = await fetch(`${board.url}/queues/queue/emails`, {
        headers: { ...navigation, 'sec-fetch-site': 'cross-site' },
        redirect: 'manual',
      });
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain('<meta http-equiv="refresh" content="0;url=/queues/queue/emails">');
      expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    });
  });

  describe('login page', () => {
    it('serves a self-contained form that posts back to itself', async () => {
      const response = await fetch(
        `${board.url}/queues/auth/login?returnTo=${encodeURIComponent('/queues/queue/a"b<c>')}`
      );
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-frame-options')).toBe('DENY');
      expect(response.headers.get('content-security-policy')).toBe(
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
      );
      expect(html).toContain('<form method="post" action="/queues/auth/login">');
      expect(html).toContain('name="token" type="password"');
      expect(html).toContain('value="/queues/queue/a&quot;b&lt;c&gt;"');
      expect(html).not.toMatch(/<(script|link|img)\b/);
      expect(html).not.toContain('role="alert"');
    });

    it('drops a returnTo that leaves the origin', async () => {
      const html = await (
        await fetch(`${board.url}/queues/auth/login?returnTo=${encodeURIComponent('//evil.test')}`)
      ).text();

      expect(html).toContain('name="returnTo" value="/queues/"');
    });
  });

  describe('browser session', () => {
    it('exchanges the token for a sealed, Strict session cookie and redirects back', async () => {
      const response = await login(TOKEN, {}, '/queues/queue/emails');
      const [cookie] = response.headers.getSetCookie();

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/queues/queue/emails');
      expect(cookie).toMatch(
        /^wm_session=[^;]+; Path=\/queues; SameSite=Strict; HttpOnly; Max-Age=28800$/
      );
      expect(cookie).not.toContain(TOKEN);
      expect(await response.text()).not.toContain(TOKEN);
    });

    it('lets the session in, reports a logout URL and signs out', async () => {
      const jar = new CookieJar();
      jar.store(await login(TOKEN));

      const board200 = await fetch(`${board.url}/queues/api/queues`, {
        headers: { cookie: jar.header() },
      });
      expect(board200.status).toBe(200);

      const me = await fetch(`${board.url}/queues/auth/me`, { headers: { cookie: jar.header() } });
      expect(await me.json()).toEqual({
        strategy: 'token',
        user: { username: 'ops-board', name: 'Ops Board', roles: ['ops'] },
        logoutUrl: '/queues/auth/logout',
      });

      const logout = await fetch(`${board.url}/queues/auth/logout`, {
        headers: { cookie: jar.header() },
        redirect: 'manual',
      });
      expect(logout.status).toBe(302);
      expect(logout.headers.get('location')).toBe('/queues/auth/login');
      expect(logout.headers.getSetCookie()[0]).toMatch(/^wm_session=; .*Max-Age=0/);
      jar.store(logout);

      const after = await fetch(`${board.url}/queues/api/queues`, {
        headers: { cookie: jar.header() },
      });
      expect(after.status).toBe(401);
    });

    it('re-renders the form with 401 for a wrong token, without echoing it or setting a cookie', async () => {
      const response = await login('the-wrong-token-value');
      const html = await response.text();

      expect(response.status).toBe(401);
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(html).toContain('role="alert"');
      expect(html).not.toContain('the-wrong-token-value');
    });

    it('accepts the form when only a same-origin Referer is sent', async () => {
      const response = await fetch(`${board.url}/queues/auth/login`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          referer: `${board.url}/queues/auth/login`,
        },
        body: form({ token: TOKEN }),
      });

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/queues/');
    });

    it('marks the cookie Secure when the form was posted from https', async () => {
      const host = new URL(board.url).host;
      const response = await login(TOKEN, { origin: `https://${host}` });

      expect(response.status).toBe(303);
      expect(response.headers.getSetCookie()[0]).toContain('; Secure');
    });

    it.each([
      ['a foreign Origin', { origin: 'http://evil.test' }],
      ['an opaque Origin', { origin: 'null' }],
      ['a cross-site fetch', { 'sec-fetch-site': 'cross-site' }],
      ['a same-site fetch from a sibling host', { 'sec-fetch-site': 'same-site' }],
    ])('refuses a login posted from %s', async (_label, extra) => {
      const response = await login(TOKEN, extra);

      expect(response.status).toBe(403);
      expect(response.headers.getSetCookie()).toEqual([]);
    });

    it('refuses a login with neither Origin nor Referer', async () => {
      const response = await fetch(`${board.url}/queues/auth/login`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form({ token: TOKEN }),
      });

      expect(response.status).toBe(403);
    });

    it('refuses an https page posting to a different host', async () => {
      const response = await login(TOKEN, { origin: 'https://evil.test' });

      expect(response.status).toBe(403);
    });

    it('never redirects outside the origin after login', async () => {
      const response = await login(TOKEN, {}, 'https://evil.test/');

      expect(response.headers.get('location')).toBe('/queues/');
    });

    it('answers an oversized form with 413', async () => {
      const response = await login('x'.repeat(20 * 1024));

      expect(response.status).toBe(413);
    });

    it('ends the session of a token validate() no longer accepts', async () => {
      const jar = new CookieJar();
      jar.store(await login('dynamic-token-from-the-database'));
      const before = await fetch(`${board.url}/queues/api/queues`, {
        headers: { cookie: jar.header() },
      });
      expect(before.status).toBe(200);

      revoked.add('dynamic-token-from-the-database');
      try {
        const after = await fetch(`${board.url}/queues/api/queues`, {
          headers: { cookie: jar.header() },
        });
        expect(after.status).toBe(401);
        expect(after.headers.getSetCookie()[0]).toMatch(/^wm_session=; .*Max-Age=0/);
      } finally {
        revoked.clear();
      }
    });

    it.each([
      ['a tampered cookie', () => 'not-a-sealed-value'],
      [
        'a cookie sealed with another secret',
        () => new Sealer('another-secret').seal({ v: 1, t: TOKEN, e: 9e9 }),
      ],
      ['an expired session', () => new Sealer(SECRET).seal({ v: 1, t: TOKEN, e: 1 })],
    ])('refuses and clears %s', async (_label, value) => {
      const response = await fetch(`${board.url}/queues/queue/emails`, {
        headers: { ...navigation, cookie: `wm_session=${value()}` },
        redirect: 'manual',
      });

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toMatch(/^\/queues\/auth\/login\?returnTo=/);
      expect(response.headers.getSetCookie()[0]).toMatch(/^wm_session=; .*Max-Age=0/);
    });
  });

  describe('without a cookie', () => {
    let headerOnly: Harness;

    beforeAll(async () => {
      headerOnly = await startBoard({ strategy: 'token', tokens: [TOKEN] }, '');
    });

    afterAll(() => headerOnly.close());

    it('answers a page load with 401 instead of a login form', async () => {
      const response = await fetch(`${headerOnly.url}/`, {
        headers: navigation,
        redirect: 'manual',
      });

      expect(response.status).toBe(401);
    });

    it('does not serve /auth/login', async () => {
      const response = await fetch(`${headerOnly.url}/auth/login`);

      expect(response.status).toBe(401);
    });

    it('attaches the default identity to a valid token', async () => {
      const response = await fetch(`${headerOnly.url}/auth/me`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });

      expect(await response.json()).toEqual({
        strategy: 'token',
        user: { username: 'token', roles: [] },
        logoutUrl: null,
      });
    });
  });

  it('checks the login Origin against publicUrl when one is configured', async () => {
    const proxied = await startBoard({
      strategy: 'token',
      tokens: [TOKEN],
      cookie: { secret: SECRET, name: 'board', maxAgeSeconds: 60 },
      publicUrl: 'https://ops.example.com/queues',
    });
    try {
      const post = (origin: string) =>
        fetch(`${proxied.url}/queues/auth/login`, {
          method: 'POST',
          redirect: 'manual',
          headers: formHeaders(origin),
          body: form({ token: TOKEN }),
        });

      expect((await post(proxied.url)).status).toBe(403);
      const ok = await post('https://ops.example.com');
      expect(ok.status).toBe(303);
      expect(ok.headers.getSetCookie()[0]).toMatch(
        /^board=[^;]+; Path=\/queues; SameSite=Strict; HttpOnly; Secure; Max-Age=60$/
      );
    } finally {
      await proxied.close();
    }
  });

  it('denies with 403 when onAuthenticated returns false', async () => {
    const guarded = await startBoard({
      strategy: 'token',
      tokens: [TOKEN],
      onAuthenticated: () => false,
    });
    try {
      const response = await fetch(`${guarded.url}/queues/`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(response.status).toBe(403);
    } finally {
      await guarded.close();
    }
  });

  it.each([
    [{ strategy: 'token' }, /tokens.*validate/],
    [{ strategy: 'token', tokens: [''] }, /non-empty string/],
    [{ strategy: 'token', tokens: [TOKEN], header: 'X Board' }, /not a header name/],
    [{ strategy: 'token', tokens: [TOKEN], cookie: { secret: '' } }, /secret must not be empty/],
  ])('refuses the configuration %j', (config, message) => {
    expect(() => createAuthMiddleware(config as TokenAuthOptions)).toThrow(message);
  });

  describe('behind a body parser', () => {
    const middleware = createAuthMiddleware(
      { strategy: 'token', tokens: [TOKEN], cookie: { secret: SECRET } },
      { basePath: '/queues' }
    );

    const serve = async (parse: (req: IncomingMessage) => Promise<void>) => {
      const server: Server = createServer(async (req, res) => {
        await parse(req);
        middleware(req, res, () => res.end('board'));
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const response = await fetch(`${url}/queues/auth/login`, {
        method: 'POST',
        redirect: 'manual',
        headers: formHeaders(url),
        body: form({ token: TOKEN }),
      });
      await new Promise<void>((resolve) => server.close(() => resolve()));
      return response;
    };

    it('reads the fields a parser already put on req.body', async () => {
      const response = await serve(async (req) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        (req as any).body = Object.fromEntries(
          new URLSearchParams(Buffer.concat(chunks).toString())
        );
      });

      expect(response.status).toBe(303);
    });

    it('reads the stream when a JSON parser left an empty req.body behind', async () => {
      const response = await serve(async (req) => {
        (req as any).body = {};
      });

      expect(response.status).toBe(303);
    });
  });
});
