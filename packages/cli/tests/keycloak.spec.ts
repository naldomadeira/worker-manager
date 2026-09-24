import { FakeOidcProvider } from '../../auth/tests/fakeOidc';
import { run, type RunningBoard } from '../src';
import { parseFlags } from '../src/config/flags';
import { resolveConfig } from '../src/config/resolve';

const REDIS_URL = `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`;
const quiet = { log: () => undefined, warn: () => undefined } as unknown as Console;

describe('keycloak auth flags', () => {
  const noFile = {};

  it('builds keycloak options from flags and env', () => {
    const config = resolveConfig({
      flags: parseFlags([
        '--keycloak-url',
        'https://sso.example.com',
        '--keycloak-realm',
        'ops',
        '--keycloak-roles',
        'wm-admin, wm-ops',
        '--public-url',
        'https://ops.example.com/queues',
      ]),
      env: {
        WORKER_MANAGER_KEYCLOAK_CLIENT_ID: 'board',
        WORKER_MANAGER_KEYCLOAK_CLIENT_SECRET: 'client-secret',
        WORKER_MANAGER_SESSION_SECRET: 'session-secret',
      } as NodeJS.ProcessEnv,
      file: noFile,
    });

    expect(config.keycloak).toEqual({
      strategy: 'keycloak',
      url: 'https://sso.example.com',
      realm: 'ops',
      clientId: 'board',
      clientSecret: 'client-secret',
      requiredRoles: ['wm-admin', 'wm-ops'],
      publicUrl: 'https://ops.example.com/queues',
      cookie: { secret: 'session-secret' },
    });
    expect(config.auth).toBeNull();
  });

  it('reads keycloak options from the config file', () => {
    const config = resolveConfig({
      flags: parseFlags([]),
      env: {} as NodeJS.ProcessEnv,
      file: { keycloak: { url: 'https://sso', realm: 'r', clientId: 'c', bearerOnly: true } },
    });

    expect(config.keycloak).toMatchObject({ strategy: 'keycloak', bearerOnly: true, realm: 'r' });
  });

  it('needs a realm and a client id', () => {
    expect(() =>
      resolveConfig({
        flags: parseFlags(['--keycloak-url', 'https://sso']),
        env: {} as NodeJS.ProcessEnv,
        file: noFile,
      })
    ).toThrow(/--keycloak-realm/);
  });

  it('refuses Basic auth and Keycloak together', () => {
    expect(() =>
      resolveConfig({
        flags: parseFlags([
          '--user',
          'a',
          '--password',
          'b',
          '--keycloak-url',
          'https://sso',
          '--keycloak-realm',
          'r',
          '--keycloak-client-id',
          'c',
        ]),
        env: {} as NodeJS.ProcessEnv,
        file: noFile,
      })
    ).toThrow(/not both/);
  });
});

describe('keycloak auth end to end', () => {
  const idp = new FakeOidcProvider();
  let board: RunningBoard;

  beforeAll(async () => {
    await idp.start();
    const config = resolveConfig({
      flags: parseFlags([
        '--port',
        '0',
        '--no-open',
        '--redis',
        REDIS_URL,
        '--prefix',
        `cli-keycloak-${process.pid}`,
        '--scan-interval',
        '0',
        '--base-path',
        '/ui',
        '--keycloak-url',
        idp.url,
        '--keycloak-realm',
        idp.realm,
        '--keycloak-client-id',
        idp.clientId,
        '--keycloak-client-secret',
        idp.clientSecret,
        '--keycloak-roles',
        'wm-admin',
      ]),
      env: {} as NodeJS.ProcessEnv,
      file: {},
    });
    board = await run(config, quiet);
  });

  afterAll(async () => {
    await board?.close();
    await idp.stop();
  });

  it('answers an unauthenticated API call with 401 and the translation key', async () => {
    const res = await fetch(`${board.url}/api/queues`);

    expect(res.status).toBe(401);
    expect(((await res.json()) as any).error).toEqual({ key: 'ERRORS.UNAUTHORIZED' });
  });

  it('redirects a browser to the Keycloak login page', async () => {
    const res = await fetch(`${board.url}/`, {
      headers: { accept: 'text/html' },
      redirect: 'manual',
    });

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe(`/realms/${idp.realm}/protocol/openid-connect/auth`);
    expect(location.searchParams.get('redirect_uri')).toBe(`${board.url}/auth/callback`);
  });

  it('serves the API to a bearer token with the required role, and 403 without it', async () => {
    const admin = await idp.accessToken({
      sub: '1',
      preferred_username: 'a',
      realmRoles: ['wm-admin'],
    });
    const viewer = await idp.accessToken({
      sub: '2',
      preferred_username: 'v',
      realmRoles: ['wm-viewer'],
    });

    const ok = await fetch(`${board.url}/api/queues`, {
      headers: { authorization: `Bearer ${admin}` },
    });
    expect(ok.status).toBe(200);

    const denied = await fetch(`${board.url}/api/queues`, {
      headers: { authorization: `Bearer ${viewer}` },
    });
    expect(denied.status).toBe(403);
  });
});
