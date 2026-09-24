import type { QueueAdapterOptions } from '@worker-manager/api/typings/app';
import type { KeycloakAuthOptions } from '@worker-manager/auth';
import { resolveConnection } from './connection';
import type { FlagValues } from './flags';
import type {
  CliConfig,
  FileConfig,
  FileHistoryConfig,
  HistoryConfig,
  PostgresConfig,
} from './types';

const DEFAULTS = {
  port: 3000,
  host: '127.0.0.1',
  prefixes: ['bull'],
  scanInterval: 10,
};

function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  return values.find((value) => value !== undefined && value !== '');
}

function toList(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const parts = (Array.isArray(value) ? value : value.split(','))
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length > 0 ? parts : undefined;
}

function toNumber(value: string | number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  return parsed;
}

function toBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;

  return !['0', 'false', 'no', ''].includes(value.toLowerCase());
}

function normalizeBasePath(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.replace(/^\/+|\/+$/g, '');

  return trimmed === '' ? '' : `/${trimmed}`;
}

export function resolveConfig({
  flags,
  env,
  file,
}: {
  flags: FlagValues;
  env: NodeJS.ProcessEnv;
  file: FileConfig;
}): CliConfig {
  const explicitQueues = Array.isArray(file.queues) ? file.queues : undefined;
  const queueOptions = (file.queues && !Array.isArray(file.queues) ? file.queues : {}) as Record<
    string,
    Partial<QueueAdapterOptions>
  >;

  const user = firstDefined(flags.user, env.BULL_BOARD_USER, file.user);
  const password = firstDefined(flags.password, env.BULL_BOARD_PASSWORD, file.password);
  if (Boolean(user) !== Boolean(password)) {
    throw new Error('Basic auth needs both --user and --password (or neither).');
  }

  const keycloak = resolveKeycloak({ flags, env, file });
  if (keycloak && user) {
    throw new Error('Use either --user/--password (Basic auth) or Keycloak, not both.');
  }

  const uiConfig = { ...file.uiConfig };
  const boardTitle = firstDefined(flags['board-title'], env.BULL_BOARD_BOARD_TITLE);
  if (boardTitle) {
    uiConfig.boardTitle = boardTitle;
  }

  const readOnly =
    flags['read-only'] ?? toBoolean(env.BULL_BOARD_READ_ONLY) ?? file.readOnly ?? false;
  const history = resolveHistory({ flags, env, file, readOnly });
  if (history) {
    // Without showMetrics the per-queue chart never renders, so nor does its range selector.
    uiConfig.showMetrics = uiConfig.showMetrics ?? true;
  }

  return {
    connection: resolveConnection({ flags, env, file }),
    port:
      toNumber(flags.port, 'port') ??
      toNumber(env.BULL_BOARD_PORT, 'port') ??
      toNumber(file.port, 'port') ??
      DEFAULTS.port,
    host: firstDefined(flags.host, env.BULL_BOARD_HOST, file.host) ?? DEFAULTS.host,
    prefixes:
      toList(flags.prefix) ??
      toList(env.BULL_BOARD_PREFIX) ??
      toList(file.prefix) ??
      DEFAULTS.prefixes,
    queueNames:
      toList(flags.queues) ?? toList(env.BULL_BOARD_QUEUES) ?? toList(explicitQueues) ?? null,
    scanInterval:
      toNumber(flags['scan-interval'], 'scan-interval') ??
      toNumber(env.BULL_BOARD_SCAN_INTERVAL, 'scan-interval') ??
      toNumber(file.scanInterval, 'scan-interval') ??
      DEFAULTS.scanInterval,
    basePath:
      normalizeBasePath(flags['base-path']) ??
      normalizeBasePath(env.BULL_BOARD_BASE_PATH) ??
      normalizeBasePath(file.basePath) ??
      '',
    readOnly,
    auth: user && password ? { user, password } : null,
    keycloak,
    postgres: resolvePostgres({ flags, env, file }),
    open: flags['no-open'] === true ? false : (toBoolean(env.BULL_BOARD_OPEN) ?? file.open ?? true),
    browser: firstDefined(flags.browser, env.BULL_BOARD_BROWSER, env.BROWSER, file.browser),
    uiConfig,
    queueOptions,
    noRetry: flags['no-retry'] ?? toBoolean(env.BULL_BOARD_NO_RETRY) ?? file.noRetry ?? false,
    history,
  };
}

function resolveHistory({
  flags,
  env,
  file,
  readOnly,
}: {
  flags: FlagValues;
  env: NodeJS.ProcessEnv;
  file: FileConfig;
  readOnly: boolean;
}): HistoryConfig | null {
  const fileHistory: FileHistoryConfig =
    typeof file.history === 'boolean' ? { enabled: file.history } : (file.history ?? {});
  const enabled =
    flags.history ?? toBoolean(env.BULL_BOARD_HISTORY) ?? fileHistory.enabled ?? false;
  if (!enabled) return null;

  return {
    // Recording writes to Redis, which is what --read-only says not to do.
    record: fileHistory.record ?? !readOnly,
    prefix: fileHistory.prefix,
    retentionDays:
      toNumber(flags['history-retention-days'], 'history-retention-days') ??
      toNumber(env.BULL_BOARD_HISTORY_RETENTION_DAYS, 'history-retention-days') ??
      toNumber(fileHistory.retentionDays, 'history-retention-days'),
    retention: fileHistory.retention,
    latency: fileHistory.latency ?? true,
    snapshotIntervalMs: fileHistory.snapshotIntervalMs,
  };
}

function resolveKeycloak({
  flags,
  env,
  file,
}: {
  flags: FlagValues;
  env: NodeJS.ProcessEnv;
  file: FileConfig;
}): KeycloakAuthOptions | null {
  const fromFile = file.keycloak;
  const url = firstDefined(flags['keycloak-url'], env.BULL_BOARD_KEYCLOAK_URL, fromFile?.url);
  if (!url) return null;

  const realm = firstDefined(
    flags['keycloak-realm'],
    env.BULL_BOARD_KEYCLOAK_REALM,
    fromFile?.realm
  );
  const clientId = firstDefined(
    flags['keycloak-client-id'],
    env.BULL_BOARD_KEYCLOAK_CLIENT_ID,
    fromFile?.clientId
  );
  if (!realm || !clientId) {
    throw new Error(
      'Keycloak auth needs --keycloak-realm and --keycloak-client-id with --keycloak-url.'
    );
  }

  const clientSecret = firstDefined(
    flags['keycloak-client-secret'],
    env.BULL_BOARD_KEYCLOAK_CLIENT_SECRET,
    fromFile?.clientSecret
  );
  const roles =
    toList(flags['keycloak-roles']) ??
    toList(env.BULL_BOARD_KEYCLOAK_ROLES) ??
    toList(fromFile?.requiredRoles);
  const bearerOnly =
    flags['keycloak-bearer-only'] ??
    toBoolean(env.BULL_BOARD_KEYCLOAK_BEARER_ONLY) ??
    fromFile?.bearerOnly;
  const publicUrl = firstDefined(
    flags['public-url'],
    env.BULL_BOARD_PUBLIC_URL,
    fromFile?.publicUrl
  );
  const sessionSecret = firstDefined(
    flags['session-secret'],
    env.BULL_BOARD_SESSION_SECRET,
    fromFile?.cookie?.secret
  );

  return {
    ...fromFile,
    strategy: 'keycloak',
    url,
    realm,
    clientId,
    ...(clientSecret ? { clientSecret } : {}),
    ...(roles ? { requiredRoles: roles } : {}),
    ...(bearerOnly !== undefined ? { bearerOnly } : {}),
    ...(publicUrl ? { publicUrl } : {}),
    ...(sessionSecret ? { cookie: { ...fromFile?.cookie, secret: sessionSecret } } : {}),
  };
}

function hasExplicitRedis(flags: FlagValues, env: NodeJS.ProcessEnv, file: FileConfig): boolean {
  return (
    firstDefined(
      flags.redis,
      flags.sentinel,
      flags.cluster,
      env.BULL_BOARD_REDIS_URL,
      env.BULL_BOARD_SENTINELS,
      env.BULL_BOARD_CLUSTER_NODES
    ) !== undefined || file.redis !== undefined
  );
}

function resolvePostgres({
  flags,
  env,
  file,
}: {
  flags: FlagValues;
  env: NodeJS.ProcessEnv;
  file: FileConfig;
}): PostgresConfig | null {
  const url = firstDefined(flags.postgres, env.BULL_BOARD_POSTGRES_URL);
  const fromFile = url ? undefined : file.postgres;
  if (!url && !fromFile) return null;

  const schema =
    firstDefined(
      flags['postgres-schema'],
      env.BULL_BOARD_POSTGRES_SCHEMA,
      typeof fromFile === 'object' ? fromFile.schema : undefined
    ) ?? 'bullmq';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error(`Invalid --postgres-schema: ${schema}`);
  }

  const source = url ?? fromFile!;
  if (typeof source === 'string' && !/^postgres(ql)?:\/\//.test(source)) {
    throw new Error(`PostgreSQL URL must use postgres:// or postgresql://, got "${source}"`);
  }
  const base = typeof source === 'string' ? { connectionString: source } : { ...source };

  return {
    connection: { ...base, schema },
    schema,
    only: !hasExplicitRedis(flags, env, file),
  };
}
