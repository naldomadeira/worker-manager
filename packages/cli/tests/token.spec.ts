import { run, type RunningBoard } from '../src';
import { parseFlags } from '../src/config/flags';
import { resolveConfig } from '../src/config/resolve';

const REDIS_URL = `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`;
const TOKEN = 'cli-board-token-0123456789abcdefghij';
const quiet = { log: () => undefined, warn: () => undefined } as unknown as Console;
const noEnv = {} as NodeJS.ProcessEnv;

describe('token auth flags', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => warn.mockRestore());

  it('builds token options from flags', () => {
    const config = resolveConfig({
      flags: parseFlags([
        '--token',
        `${TOKEN}, second-token`,
        '--token-header',
        'X-Board-Token',
        '--session-secret',
        'session-secret',
        '--public-url',
        'https://ops.example.com',
      ]),
      env: noEnv,
      file: {},
    });

    expect(config.token).toEqual({
      strategy: 'token',
      tokens: [TOKEN, 'second-token'],
      header: 'X-Board-Token',
      publicUrl: 'https://ops.example.com',
      cookie: { secret: 'session-secret' },
    });
    expect(config.auth).toBeNull();
    expect(config.keycloak).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('reads env and the config file, flags and env winning', () => {
    const config = resolveConfig({
      flags: parseFlags([]),
      env: { WORKER_MANAGER_TOKENS: 'from-env', WORKER_MANAGER_TOKEN_HEADER: 'X-Env' } as any,
      file: {
        token: {
          tokens: ['from-file'],
          header: 'X-File',
          user: { username: 'board' },
          cookie: { secret: 'file-secret', maxAgeSeconds: 60 },
        },
      },
    });

    expect(config.token).toEqual({
      strategy: 'token',
      tokens: ['from-env'],
      header: 'X-Env',
      user: { username: 'board' },
      cookie: { secret: 'file-secret', maxAgeSeconds: 60 },
    });
  });

  it('falls back to a random session secret, with a warning', () => {
    const first = resolveConfig({ flags: parseFlags(['--token', TOKEN]), env: noEnv, file: {} });
    const second = resolveConfig({ flags: parseFlags(['--token', TOKEN]), env: noEnv, file: {} });

    expect(first.token!.cookie!.secret).toMatch(/^[\w-]{43}$/);
    expect(first.token!.cookie!.secret).not.toBe(second.token!.cookie!.secret);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/--session-secret/));
  });

  it('leaves token auth off without tokens', () => {
    expect(resolveConfig({ flags: parseFlags([]), env: noEnv, file: {} }).token).toBeNull();
  });

  it.each([
    [['--user', 'a', '--password', 'b', '--token', TOKEN]],
    [
      [
        '--token',
        TOKEN,
        '--keycloak-url',
        'https://sso',
        '--keycloak-realm',
        'r',
        '--keycloak-client-id',
        'c',
      ],
    ],
  ])('refuses --token next to another strategy (%j)', (argv) => {
    expect(() => resolveConfig({ flags: parseFlags(argv), env: noEnv, file: {} })).toThrow(
      /not several/
    );
  });
});

describe('token auth end to end', () => {
  let board: RunningBoard;

  beforeAll(async () => {
    const config = resolveConfig({
      flags: parseFlags([
        '--port',
        '0',
        '--no-open',
        '--redis',
        REDIS_URL,
        '--prefix',
        `cli-token-${process.pid}`,
        '--scan-interval',
        '0',
        '--base-path',
        '/ui',
        '--token',
        TOKEN,
        '--token-header',
        'X-Board-Token',
        '--session-secret',
        'a-session-secret-of-at-least-32-characters',
      ]),
      env: noEnv,
      file: {},
    });
    board = await run(config, quiet);
  });

  afterAll(() => board?.close());

  it('answers an API call without the token with 401 JSON', async () => {
    const res = await fetch(`${board.url}/api/queues`);

    expect(res.status).toBe(401);
    expect(((await res.json()) as any).error).toEqual({ key: 'ERRORS.UNAUTHORIZED' });
  });

  it('serves the API for the token header', async () => {
    const res = await fetch(`${board.url}/api/queues`, { headers: { 'x-board-token': TOKEN } });

    expect(res.status).toBe(200);
  });

  it('logs a browser in through the form', async () => {
    const origin = new URL(board.url).origin;
    const page = await fetch(`${board.url}/`, {
      headers: { accept: 'text/html' },
      redirect: 'manual',
    });
    expect(page.status).toBe(302);
    expect(page.headers.get('location')).toBe('/ui/auth/login?returnTo=%2Fui%2F');

    const login = await fetch(`${origin}/ui/auth/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
      body: new URLSearchParams({ token: TOKEN, returnTo: '/ui/' }).toString(),
    });
    expect(login.status).toBe(303);
    const cookie = login.headers.getSetCookie()[0].split(';')[0];

    const api = await fetch(`${board.url}/api/queues`, { headers: { cookie } });
    expect(api.status).toBe(200);
  });
});
