import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { run, type RunningBoard } from '../src';
import { parseFlags } from '../src/config/flags';
import { resolveConfig } from '../src/config/resolve';
import type { FileConfig } from '../src/config/types';
import {
  assertPgBossRuntime,
  boardLinks,
  describeReason,
  PGBOSS_HISTORY_SCHEMA,
} from '../src/pgBoss';

const POSTGRES_URL = process.env.POSTGRES_URL;
const REDIS_URL = `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`;
const UNREACHABLE_PG = 'postgres://nobody@127.0.0.1:1/none';
const CLI_ROOT = join(__dirname, '..');
const BIN_PATH = join(CLI_ROOT, 'dist', 'bin.js');
const noEnv = {} as NodeJS.ProcessEnv;

const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
const PGBOSS_NODE = nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 12);

function resolve(argv: string[], env: NodeJS.ProcessEnv = noEnv, file: FileConfig = {}) {
  return resolveConfig({ flags: parseFlags(argv), env, file });
}

function recorder() {
  const lines: string[] = [];
  const log = {
    log: (line: string) => lines.push(line),
    warn: (line: string) => lines.push(line),
  } as unknown as Console;
  return { log, lines };
}

const start = (argv: string[], log: Console) =>
  run(resolve(['--port', '0', '--no-open', '--scan-interval', '0', ...argv]), log);

/** Skips loudly: a silent pass would look exactly like coverage. */
function describeWhen(ready: boolean, reason: string, name: string, body: () => void) {
  if (!ready) {
    describe.skip(`${name} (skipped: ${reason})`, () => {
      it(reason, () => undefined);
    });
    return;
  }
  describe(name, body);
}

describe('pg-boss flags', () => {
  it('parses every pg-boss flag', () => {
    expect(
      parseFlags([
        '--pg-boss',
        'postgres://db/app',
        '--pg-boss-schema',
        'jobs',
        '--pg-boss-queues',
        'a,b',
        '--pg-boss-path',
        '/boss',
      ])
    ).toMatchObject({
      'pg-boss': 'postgres://db/app',
      'pg-boss-schema': 'jobs',
      'pg-boss-queues': 'a,b',
      'pg-boss-path': '/boss',
    });
  });

  it('leaves pg-boss off until something asks for it', () => {
    expect(resolve([]).pgBoss).toBeNull();
  });

  it('serves pg-boss alone, with the defaults, when no BullMQ source is configured', () => {
    expect(resolve(['--pg-boss', 'postgres://u:p@db:5432/app']).pgBoss).toEqual({
      connection: { connectionString: 'postgres://u:p@db:5432/app' },
      schema: 'pgboss',
      queues: null,
      path: '/pg-boss',
      only: true,
    });
  });

  it('shares the root with a BullMQ board on Redis or on PostgreSQL', () => {
    const redis = resolve(['--pg-boss', 'postgres://db/app', '--redis', 'redis://cache:6379']);
    expect(redis.pgBoss?.only).toBe(false);

    const postgres = resolve(['--pg-boss', 'postgres://db/app', '--postgres', 'postgres://db/q']);
    expect(postgres.pgBoss?.only).toBe(false);
    expect(postgres.postgres?.only).toBe(true);

    const file = resolve(['--pg-boss', 'postgres://db/app'], noEnv, { redis: 'redis://cache' });
    expect(file.pgBoss?.only).toBe(false);
  });

  it('reads every option from the environment', () => {
    const config = resolve([], {
      WORKER_MANAGER_PGBOSS_URL: 'postgresql://db/app',
      WORKER_MANAGER_PGBOSS_SCHEMA: 'boss',
      WORKER_MANAGER_PGBOSS_QUEUES: 'emails, invoices',
      WORKER_MANAGER_PGBOSS_PATH: 'ops/boss/',
    } as NodeJS.ProcessEnv);

    expect(config.pgBoss).toEqual({
      connection: { connectionString: 'postgresql://db/app' },
      schema: 'boss',
      queues: ['emails', 'invoices'],
      path: '/ops/boss',
      only: true,
    });
  });

  it('prefers a flag over env over the config file, option by option', () => {
    const config = resolve(
      ['--pg-boss-schema', 'from_flag'],
      { WORKER_MANAGER_PGBOSS_QUEUES: 'from-env' } as NodeJS.ProcessEnv,
      {
        pgBoss: {
          connectionString: 'postgres://file/app',
          schema: 'from_file',
          queues: ['from-file'],
          path: '/from-file',
        },
      }
    );

    expect(config.pgBoss).toMatchObject({
      connection: { connectionString: 'postgres://file/app' },
      schema: 'from_flag',
      queues: ['from-env'],
      path: '/from-file',
    });
  });

  it('takes a connection string or a pool config from the config file', () => {
    expect(resolve([], noEnv, { pgBoss: 'postgres://file/app' }).pgBoss?.connection).toEqual({
      connectionString: 'postgres://file/app',
    });

    const pool = resolve([], noEnv, {
      pgBoss: { host: 'db', user: 'app', max: 4, schema: 'boss', queues: 'a,b' },
    }).pgBoss;
    expect(pool).toMatchObject({
      connection: { host: 'db', user: 'app', max: 4 },
      schema: 'boss',
      queues: ['a', 'b'],
    });
  });

  it('lets a URL from a flag replace the file connection but keep its other options', () => {
    const config = resolve(['--pg-boss', 'postgres://flag/app'], noEnv, {
      pgBoss: { host: 'file', schema: 'boss', path: '/boss' },
    });

    expect(config.pgBoss).toMatchObject({
      connection: { connectionString: 'postgres://flag/app' },
      schema: 'boss',
      path: '/boss',
    });
  });

  it('rejects a non-postgres URL and an unsafe schema name', () => {
    expect(() => resolve(['--pg-boss', 'mysql://db'])).toThrow(/postgres:\/\//);
    expect(() => resolve(['--pg-boss', 'postgres://db', '--pg-boss-schema', 'x;drop'])).toThrow(
      /Invalid --pg-boss-schema: x;drop/
    );
    expect(() => resolve([], noEnv, { pgBoss: { connectionString: 'redis://db' } })).toThrow(
      /postgres:\/\//
    );
  });

  it('rejects a --pg-boss-path the BullMQ board already answers', () => {
    const next = (path: string) => () =>
      resolve(['--pg-boss', 'postgres://db', '--redis', 'redis://cache', '--pg-boss-path', path]);

    expect(next('/')).toThrow(/Invalid --pg-boss-path/);
    expect(next('/api')).toThrow(/Invalid --pg-boss-path/);
    expect(next('static/x')).toThrow(/Invalid --pg-boss-path/);
    expect(next('/boss')).not.toThrow();
    expect(resolve(['--pg-boss', 'postgres://db', '--pg-boss-path', '/']).pgBoss?.path).toBe('');
  });
});

describe('pg-boss board links', () => {
  it('links each board to the other, after the links the caller configured', () => {
    const config = resolve(['--pg-boss', 'postgres://db', '--redis', 'redis://cache'], noEnv, {
      basePath: '/ops',
      uiConfig: { miscLinks: [{ text: 'Runbook', url: 'https://example.com' }] },
    });

    const links = boardLinks(config);
    expect(links.bullmq.miscLinks).toEqual([
      { text: 'Runbook', url: 'https://example.com' },
      { text: 'pg-boss', url: '/ops/pg-boss/' },
    ]);
    expect(links.pgBoss.miscLinks).toEqual([
      { text: 'Runbook', url: 'https://example.com' },
      { text: 'BullMQ', url: '/ops/' },
    ]);
    expect(config.uiConfig.miscLinks).toHaveLength(1);
  });

  it('spells the schema guard reasons out for the startup log', () => {
    expect(
      describeReason({ key: 'ERRORS.PGBOSS_SCHEMA_MISMATCH', options: { found: 41, expected: 42 } })
    ).toBe(
      'the database is on pg-boss schema version 41, but the pg-boss bundled with this CLI writes version 42'
    );
    expect(describeReason({ key: 'ERRORS.PGBOSS_NOT_INSTALLED' })).toBe(
      'pg-boss is not installed in this schema'
    );
    expect(describeReason({ key: 'ERRORS.PGBOSS_BULK_LIMIT', options: { max: 100 } })).toBe(
      'ERRORS.PGBOSS_BULK_LIMIT {"max":100}'
    );
  });
});

describe('pg-boss Node.js guard', () => {
  it('accepts 22.12 and later and refuses anything older', () => {
    expect(() => assertPgBossRuntime('22.12.0')).not.toThrow();
    expect(() => assertPgBossRuntime('24.1.0')).not.toThrow();
    expect(() => assertPgBossRuntime('22.11.0')).toThrow(/Node\.js 22\.12\.0 or later/);
    expect(() => assertPgBossRuntime('20.19.2')).toThrow(/this is Node\.js 20\.19\.2/);
  });

  describe('on Node.js 20', () => {
    // Read-only, so neither assignable nor restorable through jest.replaceProperty.
    const versions = Object.getOwnPropertyDescriptor(process, 'versions')!;

    beforeEach(() => {
      Object.defineProperty(process, 'versions', {
        ...versions,
        value: { ...process.versions, node: '20.19.2' },
      });
    });

    afterEach(() => {
      Object.defineProperty(process, 'versions', versions);
    });

    it('fails --pg-boss at startup, before connecting to anything', async () => {
      const { log } = recorder();
      await expect(start(['--pg-boss', UNREACHABLE_PG], log)).rejects.toThrow(
        /--pg-boss needs Node\.js 22\.12\.0 or later.*this is Node\.js 20\.19\.2/
      );
      await expect(
        start(['--pg-boss', UNREACHABLE_PG, '--redis', REDIS_URL, '--no-retry'], log)
      ).rejects.toThrow(/--pg-boss needs Node\.js 22\.12\.0/);
    });

    it('keeps every other mode running', async () => {
      const { log } = recorder();
      await expect(start(['--postgres', UNREACHABLE_PG], log)).rejects.toThrow(
        /Could not connect to PostgreSQL/
      );
    });
  });
});

describeWhen(
  PGBOSS_NODE,
  `pg-boss needs Node >= 22.12, this is ${process.versions.node}`,
  'pg-boss next to BullMQ',
  () => {
    let board: RunningBoard | undefined;
    const prefix = `cli-pgb-${process.pid}-${Date.now()}`;

    afterEach(async () => {
      await board?.close();
      board = undefined;
    });

    const auth = { authorization: `Basic ${Buffer.from('u:p').toString('base64')}` };
    const html = async (url: string) => {
      const res = await fetch(url, { headers: auth });
      expect(res.status).toBe(200);
      return res.text();
    };

    it('serves BullMQ at the root and pg-boss under --pg-boss-path, both behind one auth', async () => {
      const { log, lines } = recorder();
      board = await start(
        [
          '--redis',
          REDIS_URL,
          '--prefix',
          prefix,
          '--pg-boss',
          UNREACHABLE_PG,
          '--user',
          'u',
          '--password',
          'p',
        ],
        log
      );
      const origin = new URL(board.url).origin;

      expect((await fetch(`${origin}/`)).status).toBe(401);
      expect((await fetch(`${origin}/pg-boss/`)).status).toBe(401);
      expect((await fetch(`${origin}/pg-boss/api/pg-boss/info`)).status).toBe(401);

      const root = await html(`${origin}/`);
      expect(root).toContain('<base href="/"');
      expect(root).toContain('"engine":"bullmq"');
      expect(root).toContain('{"text":"pg-boss","url":"/pg-boss/"}');

      const pgBoss = await html(`${origin}/pg-boss/`);
      expect(pgBoss).toContain('<base href="/pg-boss/"');
      expect(pgBoss).toContain('"engine":"pg-boss"');
      expect(pgBoss).toContain('{"text":"BullMQ","url":"/"}');

      const queues = await fetch(`${origin}/api/queues`, { headers: auth });
      expect(queues.status).toBe(200);

      expect(lines.join('\n')).toMatch(
        /Could not connect to PostgreSQL for pg-boss at postgres:\/\/nobody@127\.0\.0\.1:1\/none.*The pg-boss board answers once PostgreSQL is reachable/
      );
    });

    it('nests both boards under --base-path and a custom --pg-boss-path', async () => {
      const { log } = recorder();
      board = await start(
        [
          '--redis',
          REDIS_URL,
          '--prefix',
          prefix,
          '--pg-boss',
          UNREACHABLE_PG,
          '--pg-boss-path',
          'jobs/pg',
          '--base-path',
          '/ops',
        ],
        log
      );
      const origin = new URL(board.url).origin;

      const root = await (await fetch(`${origin}/ops/`)).text();
      expect(root).toContain('{"text":"pg-boss","url":"/ops/jobs/pg/"}');
      const pgBoss = await (await fetch(`${origin}/ops/jobs/pg/`)).text();
      expect(pgBoss).toContain('<base href="/ops/jobs/pg/"');
      expect(pgBoss).toContain('{"text":"BullMQ","url":"/ops/"}');
    });

    it('keeps the pg-boss board up while Redis is still unreachable', async () => {
      const { log } = recorder();
      board = await start(['--redis', 'redis://127.0.0.1:1', '--pg-boss', UNREACHABLE_PG], log);
      const origin = new URL(board.url).origin;

      expect((await fetch(`${origin}/`, { headers: { accept: 'text/html' } })).status).toBe(503);
      const pgBoss = await fetch(`${origin}/pg-boss/`);
      expect(pgBoss.status).toBe(200);
      expect(await pgBoss.text()).toContain('"engine":"pg-boss"');
    });
  }
);

describeWhen(
  PGBOSS_NODE && Boolean(POSTGRES_URL),
  POSTGRES_URL ? `pg-boss needs Node >= 22.12` : 'POSTGRES_URL is not set',
  'pg-boss end to end',
  () => {
    const schema = `wm_cli_pgb_${process.env.JEST_WORKER_ID ?? '1'}`;
    const queue = 'cli-pgb-emails';
    let admin: pg.Pool;
    let board: RunningBoard | undefined;

    /** pg-boss is ESM only, so it runs in a child process rather than through Jest's CJS loader. */
    const installSchema = () => {
      const script = `
        import { PgBoss } from 'pg-boss';
        const boss = new PgBoss({
          connectionString: process.env.PG_URL, schema: process.env.PG_SCHEMA,
          migrate: true, supervise: false, schedule: false,
        });
        boss.on('error', () => {});
        await boss.start();
        await boss.createQueue(process.env.PG_QUEUE);
        await boss.send(process.env.PG_QUEUE, { n: 1 });
        await boss.stop({ graceful: false, close: true });
      `;
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: CLI_ROOT,
        env: { ...process.env, PG_URL: POSTGRES_URL, PG_SCHEMA: schema, PG_QUEUE: queue },
        encoding: 'utf8',
      });
      if (result.status !== 0) throw new Error(`Installing pg-boss failed:\n${result.stderr}`);
    };

    beforeAll(async () => {
      admin = new pg.Pool({ connectionString: POSTGRES_URL, max: 1 });
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      installSchema();
    });

    afterEach(async () => {
      await board?.close();
      board = undefined;
    });

    afterAll(async () => {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      for (const table of ['counters', 'histograms', 'sampler_state']) {
        await admin
          .query(
            `DELETE FROM "${PGBOSS_HISTORY_SCHEMA}".worker_manager_metrics_${table} WHERE queue LIKE $1`,
            [`pgboss:${schema}:%`]
          )
          .catch(() => undefined);
      }
      await admin.end();
    });

    it('serves one pg-boss board at the root when it is the only source', async () => {
      const { log, lines } = recorder();
      board = await start(['--pg-boss', POSTGRES_URL!, '--pg-boss-schema', schema], log);

      const page = await (await fetch(`${board.url}/`)).text();
      expect(page).toContain('"engine":"pg-boss"');
      expect(page).not.toContain('miscLinks');

      const info = (await (await fetch(`${board.url}/api/pg-boss/info`)).json()) as any;
      expect(info).toMatchObject({ schema, installed: true, readable: true, readOnly: false });
      expect(lines).toContain(
        `pg-boss: ${POSTGRES_URL!.replace(/:[^:@/]+@/, ':***@')} (schema ${schema}, version ${info.schemaVersion})`
      );

      const queues = (await (await fetch(`${board.url}/api/pg-boss/queues`)).json()) as any;
      expect(queues.queues.map((q: { name: string }) => q.name)).toEqual([queue]);
    });

    it('limits the board to --pg-boss-queues', async () => {
      const { log } = recorder();
      board = await start(
        ['--pg-boss', POSTGRES_URL!, '--pg-boss-schema', schema, '--pg-boss-queues', 'other'],
        log
      );

      const queues = (await (await fetch(`${board.url}/api/pg-boss/queues`)).json()) as any;
      expect(queues.queues).toEqual([]);
      expect((await fetch(`${board.url}/api/pg-boss/queues/${queue}`)).status).toBe(404);
    });

    it('applies --read-only to the pg-boss board', async () => {
      const { log, lines } = recorder();
      board = await start(
        ['--pg-boss', POSTGRES_URL!, '--pg-boss-schema', schema, '--read-only'],
        log
      );

      const info = (await (await fetch(`${board.url}/api/pg-boss/info`)).json()) as any;
      expect(info).toMatchObject({ readOnly: true, writable: false });
      const send = await fetch(`${board.url}/api/pg-boss/queues/${queue}/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: {} }),
      });
      expect(send.status).toBe(404);
      expect(lines.join('\n')).not.toContain('pg-boss writes are disabled');
    });

    it('fails startup when the pg-boss database is unreachable and it is the only source', async () => {
      const { log } = recorder();
      await expect(start(['--pg-boss', UNREACHABLE_PG], log)).rejects.toThrow(
        /Could not connect to PostgreSQL for pg-boss at postgres:\/\/nobody@127\.0\.0\.1:1\/none/
      );
    });

    it('logs why the board cannot read a schema pg-boss was never installed in', async () => {
      const { log, lines } = recorder();
      board = await start(['--pg-boss', POSTGRES_URL!, '--pg-boss-schema', `${schema}_none`], log);

      expect(lines).toContain(
        `pg-boss board cannot read schema "${schema}_none": pg-boss is not installed in this schema.`
      );
    });

    it('records --history into the worker_manager schema, never the pg-boss one', async () => {
      const { log, lines } = recorder();
      board = await start(
        ['--pg-boss', POSTGRES_URL!, '--pg-boss-schema', schema, '--history'],
        log
      );

      const page = await (await fetch(`${board.url}/`)).text();
      expect(page).toContain('"hasHistoryProvider":true');
      expect(lines).toContain(
        `pg-boss history: PostgreSQL (schema ${PGBOSS_HISTORY_SCHEMA}, tables worker_manager_metrics_*)`
      );

      // Read back through the board, so the namespace the recorder writes is the one it serves.
      let queues: { queue: string }[] = [];
      for (let i = 0; i < 100 && !queues.some((q) => q.queue === queue); i++) {
        const usage = await fetch(`${board.url}/api/metrics/history/usage`);
        expect(usage.status).toBe(200);
        queues = ((await usage.json()) as { queues: { queue: string }[] }).queues;
        if (!queues.some((q) => q.queue === queue)) await new Promise((r) => setTimeout(r, 100));
      }
      expect(queues.map((q) => q.queue)).toContain(queue);

      const tables = (name: string) =>
        admin
          .query(
            `SELECT count(*)::int AS count FROM pg_tables
              WHERE schemaname = $1 AND tablename LIKE 'worker_manager_metrics_%'`,
            [name]
          )
          .then(({ rows }) => rows[0].count as number);
      expect(await tables(PGBOSS_HISTORY_SCHEMA)).toBeGreaterThan(0);
      expect(await tables(schema)).toBe(0);

      const purge = await fetch(`${board.url}/api/metrics/history/purge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ queue }),
      });
      expect(purge.status).toBeLessThan(300);
    });

    describe('through the built binary', () => {
      /** The real Node.js loader, where pg-boss itself loads and the board can write. */
      const boot = (args: string[]) =>
        new Promise<{ url: string; output: () => string; stop(): Promise<void> }>(
          (resolveBoot, reject) => {
            const child = spawn(
              process.execPath,
              [BIN_PATH, '--port', '0', '--no-open', '--pg-boss', POSTGRES_URL!, ...args],
              { env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] }
            );
            let out = '';
            const timer = setTimeout(() => {
              child.kill('SIGKILL');
              reject(new Error(`No banner within 10s:\n${out}`));
            }, 10000);
            const collect = (chunk: Buffer) => {
              out += chunk.toString();
              const match = /Worker Manager listening on (http:\/\/\S+)/.exec(out);
              // The schema report follows the banner, so wait for it too.
              if (match && /pg-boss: /.test(out)) {
                clearTimeout(timer);
                resolveBoot({
                  url: match[1],
                  output: () => out,
                  stop: () =>
                    new Promise<void>((done) => {
                      child.once('exit', () => done());
                      child.kill('SIGINT');
                    }),
                });
              }
            };
            child.stdout.on('data', collect);
            child.stderr.on('data', collect);
            child.once('exit', (code) => reject(new Error(`Exited with ${code}:\n${out}`)));
          }
        );

      beforeAll(() => {
        if (!existsSync(BIN_PATH)) {
          spawnSync('yarn', ['build'], { cwd: CLI_ROOT, stdio: 'inherit' });
        }
      });

      it('writes through the pg-boss it bundles', async () => {
        const cli = await boot(['--pg-boss-schema', schema]);
        try {
          const send = await fetch(`${cli.url}/api/pg-boss/queues/${queue}/jobs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ data: { from: 'cli' } }),
          });
          expect(send.status).toBe(200);
          expect(((await send.json()) as { id: string }).id).toMatch(/^[0-9a-f-]{36}$/);
          expect(cli.output()).not.toContain('pg-boss writes are disabled');
        } finally {
          await cli.stop();
        }
      });

      it('turns writes off and says why when the schema version drifts', async () => {
        const { rows } = await admin.query(`SELECT version FROM "${schema}".version`);
        const installed = Number(rows[0].version);
        await admin.query(`UPDATE "${schema}".version SET version = $1`, [installed - 1]);
        const cli = await boot(['--pg-boss-schema', schema]);
        try {
          const reason =
            `pg-boss writes are disabled: the database is on pg-boss schema version ${installed - 1}, ` +
            `but the pg-boss bundled with this CLI writes version ${installed}. Reading keeps working.`;
          // The warning goes to stderr, which may arrive after the stdout lines boot() waits on.
          for (let i = 0; i < 50 && !cli.output().includes(reason); i++) {
            await new Promise((r) => setTimeout(r, 50));
          }
          expect(cli.output()).toContain(reason);
          const info = (await (await fetch(`${cli.url}/api/pg-boss/info`)).json()) as any;
          expect(info).toMatchObject({ readable: true, writable: false });
        } finally {
          await cli.stop();
          await admin.query(`UPDATE "${schema}".version SET version = $1`, [installed]);
        }
      });
    });
  }
);
