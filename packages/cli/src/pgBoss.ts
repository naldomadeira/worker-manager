import type { PgBossEngine } from '@worker-manager/api/engine';
import type { PgBossInfo, TranslatableMessage, UIConfig } from '@worker-manager/api/typings/app';
import { ExpressAdapter } from '@worker-manager/express';
import { namespacedHistoryProvider } from '@worker-manager/metrics';
import type { CliConfig, PgBossConfig } from './config/types';
import { describeError } from './describeError';
import { createHistory, type HistoryRuntime } from './history';
import { describeTarget } from './postgres';

/** pg-boss 12 is ESM only and declares `engines.node >=22.12`, which `require(esm)` needs. */
export const PGBOSS_MIN_NODE = '22.12.0';

/**
 * Fails fast, before anything connects, when this Node.js cannot load pg-boss. Only `--pg-boss`
 * calls it: every other mode keeps running on the Node 20 the CLI declares.
 */
export function assertPgBossRuntime(nodeVersion: string = process.versions.node): void {
  const [major, minor] = nodeVersion.split('.').map(Number);
  if (major > 22 || (major === 22 && minor >= 12)) return;

  throw new Error(
    `--pg-boss needs Node.js ${PGBOSS_MIN_NODE} or later, because pg-boss does; this is ` +
      `Node.js ${nodeVersion}. Upgrade Node.js or run the Docker image. Every other mode ` +
      'of worker-manager still runs on Node.js 20.'
  );
}

/** Metrics history of a pg-boss board lives next to it, never inside the pg-boss schema. */
export const PGBOSS_HISTORY_SCHEMA = 'worker_manager';

const LINK_TEXT = { bullmq: 'BullMQ', pgBoss: 'pg-boss' };

/** The caller's links first, then the one to the other board, so the header offers both. */
export function withBoardLink(uiConfig: UIConfig, text: string, url: string): UIConfig {
  return { ...uiConfig, miscLinks: [...(uiConfig.miscLinks ?? []), { text, url }] };
}

/**
 * The same `uiConfig` for both boards, each with a link to the other. Both are absolute paths,
 * since each board's `<base href>` would resolve a relative one against its own root.
 */
export function boardLinks(config: CliConfig): { bullmq: UIConfig; pgBoss: UIConfig } {
  const root = `${config.basePath}/`;
  const pgBoss = `${config.basePath}${config.pgBoss?.path ?? ''}/`;

  return {
    bullmq: withBoardLink(config.uiConfig, LINK_TEXT.pgBoss, pgBoss),
    pgBoss: withBoardLink(config.uiConfig, LINK_TEXT.bullmq, root),
  };
}

// English for the startup log only. The API still answers with the keys, which the UI renders
// from its locales.
const REASONS: Record<string, (options: Record<string, unknown>) => string> = {
  'ERRORS.PGBOSS_NOT_INSTALLED': () => 'pg-boss is not installed in this schema',
  'ERRORS.PGBOSS_SCHEMA_UNSUPPORTED': (o) =>
    `pg-boss schema version ${o.found} is not supported (supported: ${o.min} to ${o.max})`,
  'ERRORS.PGBOSS_SCHEMA_MISMATCH': (o) =>
    `the database is on pg-boss schema version ${o.found}, but the pg-boss bundled with ` +
    `this CLI writes version ${o.expected}`,
  'ERRORS.PGBOSS_WRITER_UNAVAILABLE': () => 'pg-boss could not be loaded to write with',
};

export function describeReason({ key, options = {} }: TranslatableMessage): string {
  return (
    REASONS[key]?.(options) ??
    `${key}${Object.keys(options).length ? ` ${JSON.stringify(options)}` : ''}`
  );
}

export interface PgBossSide {
  serverAdapter: ExpressAdapter;
  /** Where the board is mounted, relative to `--base-path`: `''` when it has the root. */
  path: string;
  label: string;
  engine: PgBossEngine;
  history: HistoryRuntime | null;
  /** Reads the schema once. Rejects only when the database cannot be reached at all. */
  probe(): Promise<PgBossInfo>;
  /** Logs where the board is and, when it cannot read or write, why. */
  report(info: PgBossInfo, log: Pick<Console, 'log' | 'warn'>): void;
  close(): Promise<void>;
}

/**
 * The pg-boss board: one `createPgBossBoard` on its own Express adapter, which the server
 * mounts at the root or under `--pg-boss-path`. `@worker-manager/pg-boss` is required here and
 * nowhere else, after the Node.js check, so no other mode ever loads it.
 */
export function createPgBossSide(
  config: CliConfig,
  { uiConfig, onWarning }: { uiConfig: UIConfig; onWarning(message: string): void }
): PgBossSide {
  const pgBoss = config.pgBoss as PgBossConfig;
  assertPgBossRuntime();
  // oxlint-disable-next-line typescript/no-require-imports
  const { createPgBossBoard, pgBossMetricsNamespace, pgBossMetricsSources } =
    require('@worker-manager/pg-boss') as typeof import('@worker-manager/pg-boss');

  const history = config.history
    ? createHistory({
        postgres: {
          connection: { ...pgBoss.connection, schema: PGBOSS_HISTORY_SCHEMA },
          schema: PGBOSS_HISTORY_SCHEMA,
          only: true,
        },
        config: config.history,
        onWarning,
      })
    : null;

  const path = pgBoss.only ? '' : pgBoss.path;
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(`${config.basePath}${path}`);
  // pg-boss queues are recorded as `pgboss:<schema>:<queue>`, and the board reads them back
  // through the same namespace, so its history never mixes with a BullMQ board's.
  const namespace = pgBossMetricsNamespace(pgBoss.schema);
  const board = createPgBossBoard({
    serverAdapter,
    pgBoss: {
      connection: { ...pgBoss.connection },
      schema: pgBoss.schema,
      ...(pgBoss.queues ? { queues: pgBoss.queues } : {}),
    },
    options: {
      readOnly: config.readOnly,
      uiConfig,
      historyProvider: history ? namespacedHistoryProvider(history.provider, namespace) : undefined,
    },
  });
  const sources = history ? pgBossMetricsSources(board.engine, { onWarning }) : null;
  if (history && sources) history.start(() => [], sources);
  const label = describeTarget(pgBoss.connection);

  return {
    serverAdapter,
    path,
    label,
    engine: board.engine,
    history,
    async probe() {
      try {
        return await board.engine.info();
      } catch (error) {
        throw new Error(
          `Could not connect to PostgreSQL for pg-boss at ${label}: ${describeError(error as Error)}`
        );
      }
    },
    report(info, log) {
      const where = path ? ` at ${config.basePath}${path}` : '';
      const version = info.schemaVersion === null ? '' : `, version ${info.schemaVersion}`;
      log.log(`pg-boss: ${label} (schema ${info.schema}${version})${where}`);
      if (info.unavailableReason) {
        log.warn(
          `pg-boss board cannot read schema "${info.schema}": ${describeReason(info.unavailableReason)}.`
        );
      } else if (info.writesDisabledReason && !info.readOnly) {
        log.warn(
          `pg-boss writes are disabled: ${describeReason(info.writesDisabledReason)}. ` +
            'Reading keeps working.'
        );
      }
      if (history) {
        log.log(`pg-boss history: ${history.label}`);
        if (!config.history?.record) {
          log.warn(
            'pg-boss history is served read-only: this process records nothing, so the charts ' +
              'show only what another process has already recorded.'
          );
        }
      }
    },
    async close() {
      await history?.stop();
      await sources?.close().catch(() => undefined);
      await board.close().catch(() => undefined);
    },
  };
}
