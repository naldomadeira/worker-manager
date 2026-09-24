import { run, type RunningBoard } from '../src';
import { parseFlags } from '../src/config/flags';
import { resolveConfig } from '../src/config/resolve';

/**
 * BullMQ v6 queues stored in PostgreSQL. Skipped, loudly, without POSTGRES_URL: a silent
 * pass would look exactly like coverage.
 */
const POSTGRES_URL = process.env.POSTGRES_URL;
const REDIS_URL = `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`;
const quiet = { log: () => undefined, warn: () => undefined } as unknown as Console;

describe('postgres flags', () => {
  it('serves PostgreSQL only when no Redis source is configured', () => {
    const config = resolveConfig({
      flags: parseFlags(['--postgres', 'postgres://u:p@db:5432/app']),
      env: {} as NodeJS.ProcessEnv,
      file: {},
    });

    expect(config.postgres).toEqual({
      connection: { connectionString: 'postgres://u:p@db:5432/app', schema: 'bullmq' },
      schema: 'bullmq',
      only: true,
    });
  });

  it('serves both when a Redis source is configured too', () => {
    const config = resolveConfig({
      flags: parseFlags(['--postgres', 'postgres://db/app', '--redis', 'redis://cache:6379']),
      env: { BULL_BOARD_POSTGRES_SCHEMA: 'jobs' } as NodeJS.ProcessEnv,
      file: {},
    });

    expect(config.postgres).toMatchObject({ schema: 'jobs', only: false });
  });

  it('reads a pool config from the config file', () => {
    const config = resolveConfig({
      flags: parseFlags([]),
      env: {} as NodeJS.ProcessEnv,
      file: { postgres: { host: 'db', user: 'u', schema: 'queues' } },
    });

    expect(config.postgres).toEqual({
      connection: { host: 'db', user: 'u', schema: 'queues' },
      schema: 'queues',
      only: true,
    });
  });

  it('rejects a non-postgres URL and an unsafe schema name', () => {
    const resolve = (argv: string[]) =>
      resolveConfig({ flags: parseFlags(argv), env: {} as NodeJS.ProcessEnv, file: {} });

    expect(() => resolve(['--postgres', 'mysql://db'])).toThrow(/postgres:\/\//);
    expect(() => resolve(['--postgres', 'postgres://db', '--postgres-schema', 'x;drop'])).toThrow(
      /--postgres-schema/
    );
  });
});

if (!POSTGRES_URL) {
  describe.skip('postgres end to end (skipped: POSTGRES_URL is not set)', () => {
    it('needs POSTGRES_URL', () => undefined);
  });
} else {
  describe('postgres end to end', () => {
    // oxlint-disable-next-line typescript/no-require-imports
    const { Queue, createPostgresBackend } = require('bullmq-v6');
    const name = `cli-pg-${process.pid}-${Date.now()}`;
    let queue: any;
    let board: RunningBoard | undefined;

    beforeAll(async () => {
      queue = new Queue(name, { connection: POSTGRES_URL }, createPostgresBackend);
      await queue.waitUntilReady();
      await queue.add('invoice', { id: 1 });
    });

    afterEach(async () => {
      await board?.close();
      board = undefined;
    });

    afterAll(async () => {
      await queue?.obliterate({ force: true }).catch(() => undefined);
      await queue?.close();
    });

    const start = (argv: string[]) =>
      run(
        resolveConfig({
          flags: parseFlags(['--port', '0', '--no-open', '--scan-interval', '0', ...argv]),
          env: {} as NodeJS.ProcessEnv,
          file: {},
        }),
        quiet
      );

    it('discovers PostgreSQL queues without touching Redis', async () => {
      board = await start(['--postgres', POSTGRES_URL, '--read-only']);

      const res = await fetch(`${board.url}/api/queues?activeQueue=${name}&status=waiting`);
      expect(res.status).toBe(200);
      const entry = ((await res.json()) as any).queues.find(
        (q: { name: string }) => q.name === name
      );
      expect(entry).toBeDefined();
      expect(entry.readOnlyMode).toBe(true);
      expect(entry.counts.waiting).toBe(1);
      expect(entry.jobs.map((job: { name: string }) => job.name)).toEqual(['invoice']);

      const stats = await fetch(`${board.url}/api/redis/stats`);
      expect(((await stats.json()) as any).backend).toBe('postgres');
    });

    it('takes explicit --queues on a PostgreSQL-only board', async () => {
      board = await start(['--postgres', POSTGRES_URL, '--queues', name]);

      const res = await fetch(`${board.url}/api/queues`);
      const names = ((await res.json()) as any).queues.map((q: { name: string }) => q.name);
      expect(names).toEqual([name]);
    });

    it('records --history into PostgreSQL on a board with no Redis', async () => {
      board = await start(['--postgres', POSTGRES_URL, '--queues', name, '--history']);

      const html = await (await fetch(board.url)).text();
      expect(html).toContain('"hasHistoryProvider":true');

      // The recorder's first tick samples the waiting job's age into the metrics tables.
      let queues: { queue: string }[] = [];
      for (let i = 0; i < 100 && !queues.some((q) => q.queue === name); i++) {
        const usage = await fetch(`${board.url}/api/metrics/history/usage`);
        expect(usage.status).toBe(200);
        queues = ((await usage.json()) as { queues: { queue: string }[] }).queues;
        if (!queues.some((q) => q.queue === name)) await new Promise((r) => setTimeout(r, 100));
      }
      expect(queues.map((q) => q.queue)).toContain(name);

      const to = Date.now();
      const history = await fetch(
        `${board.url}/api/metrics/history?queue=${encodeURIComponent(name)}&from=${to - 86400000}&to=${to}`
      );
      expect(history.status).toBe(200);

      // Cleared through the board, so reruns start from nothing.
      const purge = await fetch(`${board.url}/api/metrics/history/purge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ queue: name }),
      });
      expect(purge.status).toBeLessThan(300);
    });

    it('serves PostgreSQL queues next to Redis ones', async () => {
      board = await start([
        '--postgres',
        POSTGRES_URL,
        '--redis',
        REDIS_URL,
        '--prefix',
        `cli-pg-mixed-${process.pid}`,
      ]);

      const res = await fetch(`${board.url}/api/queues`);
      const names = ((await res.json()) as any).queues.map((q: { name: string }) => q.name);
      expect(names).toContain(name);
    });
  });
}
