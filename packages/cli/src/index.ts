import { createWorkerManagerBoard } from '@worker-manager/api';
import { ExpressAdapter } from '@worker-manager/express';
import type { CliConfig } from './config/types';
import { describeConnection, RETRY_INTERVAL_MS, type ConnectionState } from './connectionState';
import { describeError } from './describeError';
import { discoverQueues, probeQueues, type DiscoveredQueue } from './discovery';
import { createHistory, warnIfCountersUnavailable } from './history';
import { createPostgresSource, type PostgresSource } from './postgres';
import { createQueueFactory } from './queueFactory';
import { createRedisClient } from './redisClient';
import { QueueRegistry } from './registry';
import { startServer } from './server';

export { describeError };

export interface RunningBoard {
  url: string;
  close(): Promise<void>;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

const SHUTDOWN_GRACE_MS = 3000;

function raceTimeout(ms: number): { promise: Promise<'timeout'>; cancel: () => void } {
  let timer: NodeJS.Timeout;
  const promise = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
    timer.unref();
  });

  return { promise, cancel: () => clearTimeout(timer) };
}

async function closeWithGrace(
  promise: Promise<unknown>,
  ms: number,
  onTimeout: () => void
): Promise<void> {
  const timeout = raceTimeout(ms);
  const outcome = await Promise.race([
    promise.then(
      () => 'done' as const,
      () => 'done' as const
    ),
    timeout.promise,
  ]);
  timeout.cancel();
  if (outcome === 'timeout') onTimeout();
}

export async function run(
  config: CliConfig,
  log = console,
  {
    beforeReady,
  }: {
    beforeReady?: (close: () => Promise<void>) => void;
  } = {}
): Promise<RunningBoard> {
  warnIfExposed(config, log);

  if (config.postgres?.only) {
    return runPostgresOnly(config, log, { beforeReady });
  }

  const redisOptions = {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    // ioredis retries unreachable sentinels forever, so connect() never rejects and --no-retry
    // would hang. The retrying path keeps ioredis's own backoff, which re-resolves a promoted
    // master faster than a flat interval would.
    ...(config.noRetry
      ? { sentinelRetryStrategy: () => null }
      : { retryStrategy: () => RETRY_INTERVAL_MS }),
    ...config.connection.options,
  };
  const client = createRedisClient(config.connection, redisOptions, config.noRetry);
  const redisLabel = describeConnection(config.connection);
  let attemptError: Error | undefined;
  client.on('error', (error: Error) => {
    attemptError ??= error;
  });
  // For the same reason, the first error rather than connect() is what releases startup onto
  // the diagnostic page.
  const firstError = new Promise<never>((_, reject) => client.once('error', reject));
  firstError.catch(() => undefined);

  const onWarning = (message: string) => log.warn(message);
  const history = config.history
    ? createHistory({ client, config: config.history, onWarning })
    : null;

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(config.basePath);
  const board = createWorkerManagerBoard({
    queues: [],
    serverAdapter,
    options: { uiConfig: config.uiConfig, historyProvider: history?.provider },
  });

  const queues = createQueueFactory({
    client,
    readOnly: config.readOnly,
    queueOptions: config.queueOptions,
    onWarning,
  });
  const postgres = config.postgres
    ? createPostgresSource({
        config: config.postgres,
        readOnly: config.readOnly,
        queueOptions: config.queueOptions,
        onWarning,
      })
    : null;
  const registry = new QueueRegistry({
    board,
    createQueue: (queue) =>
      queue.lib === 'bullmq-postgres' && postgres
        ? postgres.createQueue(queue)
        : queues.createQueue(queue),
    onWarning,
  });
  // A PostgreSQL hiccup must not take the Redis queues down with it, nor drop the PostgreSQL
  // queues already on the board, so a failed discovery keeps serving the last known list.
  let lastPostgres: DiscoveredQueue[] = [];
  let postgresFailing = false;
  const discoverPostgres = async (): Promise<DiscoveredQueue[]> => {
    if (!postgres) return [];
    try {
      // Next to Redis, explicit --queues filter what PostgreSQL actually holds rather than
      // conjuring every name there too.
      const names = config.queueNames;
      lastPostgres = (await postgres.discover(null)).filter(
        (queue) => !names || names.includes(queue.name)
      );
      if (postgresFailing) log.log('PostgreSQL reachable again.');
      postgresFailing = false;
    } catch (error) {
      if (!postgresFailing) {
        log.warn(
          `Could not list PostgreSQL queues at ${postgres.label}: ${describeError(error as Error)}`
        );
      }
      postgresFailing = true;
    }

    return lastPostgres;
  };

  let closing = false;
  let rescanTimer: NodeJS.Timeout | undefined;

  const scan = async () => {
    const discovered = config.queueNames
      ? (
          await Promise.all(
            config.prefixes.map((prefix) => probeQueues(client, prefix, config.queueNames!))
          )
        ).flat()
      : await discoverQueues(client, config.prefixes);
    discovered.push(...(await discoverPostgres()));

    if (closing) return discovered.length;

    await registry.sync(discovered);

    return discovered.length;
  };

  const startHistory = async () => {
    if (!history) return;

    history.start(() => registry.adapters());
    if (config.history?.record) {
      await warnIfCountersUnavailable(registry.adapters(), onWarning);
    } else {
      log.warn(
        'Historical metrics are served read-only: this process records nothing, so the charts ' +
          'show only what another process has already recorded.'
      );
    }
  };

  const logIfIdle = (count: number) => {
    if (count === 0) {
      log.log(
        `No queues found under ${config.prefixes.join(', ')} yet. ` +
          (config.scanInterval > 0 ? 'Watching for new ones.' : 'Scanning was set to run once.')
      );
    }
  };

  const scheduleRescan = () => {
    if (closing || config.scanInterval <= 0 || rescanTimer) return;

    rescanTimer = setTimeout(() => {
      rescanTimer = undefined;
      scan()
        .catch((error) => log.warn(`Rescan failed: ${error.message}`))
        .finally(scheduleRescan);
    }, config.scanInterval * 1000);
    rescanTimer.unref();
  };

  if (config.noRetry) {
    try {
      await client.connect();
    } catch (error) {
      throw new Error(
        `Could not connect to Redis at ${redisLabel}: ${describeError(attemptError ?? (error as Error))}`
      );
    }

    const count = await scan();
    await startHistory();
    const server = await startServer(config, { serverAdapter });

    const close = async () => {
      closing = true;
      await history?.stop();
      if (rescanTimer) clearTimeout(rescanTimer);
      await closeWithGrace(server.close(), SHUTDOWN_GRACE_MS, () => {
        log.warn(
          `Closing the HTTP server did not finish within ${SHUTDOWN_GRACE_MS}ms; forcing remaining connections closed.`
        );
        server.closeAllConnections();
      });
      await closeWithGrace(registry.close(), SHUTDOWN_GRACE_MS, () =>
        log.warn(
          `Closing queues did not finish within ${SHUTDOWN_GRACE_MS}ms; continuing shutdown.`
        )
      );
      await closeWithGrace(queues.close(), SHUTDOWN_GRACE_MS, () =>
        log.warn(
          `Closing shared Redis connections did not finish within ${SHUTDOWN_GRACE_MS}ms; continuing shutdown.`
        )
      );
      await closeWithGrace(client.quit(), SHUTDOWN_GRACE_MS, () => client.disconnect());
      await postgres?.close().catch(() => undefined);
    };

    beforeReady?.(close);

    log.log(`Worker Manager listening on ${server.url}`);
    log.log(`Redis:  ${redisLabel}`);
    log.log(`Prefix: ${config.prefixes.join(', ')}`);
    if (postgres) log.log(`Postgres: ${postgres.label} (schema ${config.postgres!.schema})`);
    logIfIdle(count);

    scheduleRescan();

    return { url: server.url, close };
  }

  let state: ConnectionState = {
    status: 'connecting',
    redis: redisLabel,
    attempts: 0,
  };
  const getState = () => state;

  const server = await startServer(config, { serverAdapter, getConnectionState: getState });

  const close = async () => {
    closing = true;
    await history?.stop();
    if (rescanTimer) clearTimeout(rescanTimer);
    await closeWithGrace(server.close(), SHUTDOWN_GRACE_MS, () => {
      log.warn(
        `Closing the HTTP server did not finish within ${SHUTDOWN_GRACE_MS}ms; forcing remaining connections closed.`
      );
      server.closeAllConnections();
    });
    await closeWithGrace(registry.close(), SHUTDOWN_GRACE_MS, () =>
      log.warn(`Closing queues did not finish within ${SHUTDOWN_GRACE_MS}ms; continuing shutdown.`)
    );
    await closeWithGrace(queues.close(), SHUTDOWN_GRACE_MS, () =>
      log.warn(
        `Closing shared Redis connections did not finish within ${SHUTDOWN_GRACE_MS}ms; continuing shutdown.`
      )
    );
    await closeWithGrace(client.quit(), SHUTDOWN_GRACE_MS, () => client.disconnect());
    await postgres?.close().catch(() => undefined);
  };

  beforeReady?.(close);

  let everFailed = false;

  let lostConnection = false;

  const markUnavailable = (message: string) => {
    if (closing) return;
    if (state.status === 'connected') {
      if (lostConnection) return;
      lostConnection = true;
      log.warn(
        `Lost the Redis connection: ${message}. Retrying every ${RETRY_INTERVAL_MS / 1000}s.`
      );
      return;
    }
    state = {
      status: 'unavailable',
      redis: redisLabel,
      attempts: state.attempts + 1,
      lastError: message,
    };
    if (!everFailed) {
      everFailed = true;
      log.warn(`Could not connect to Redis at ${redisLabel}: ${message}`);
      log.warn(
        `Serving a diagnostic page at ${server.url} and retrying every ` +
          `${RETRY_INTERVAL_MS / 1000}s. Pass --no-retry to exit instead of waiting.`
      );
    }
  };

  let inFlight: Promise<void> | undefined;

  let deferredIdleCount: number | undefined;

  const becomeConnected = (deferIdleLog = false): Promise<void> => {
    if (closing || state.status === 'connected') return Promise.resolve();
    if (inFlight) return inFlight;

    inFlight = (async () => {
      try {
        const count = await scan();
        if (closing) return;
        state = {
          status: 'connected',
          redis: redisLabel,
          attempts: state.attempts,
        };
        scheduleRescan();
        await startHistory();
        if (everFailed) log.log('Redis connected. The dashboard is live.');
        if (deferIdleLog) {
          deferredIdleCount = count;
        } else {
          logIfIdle(count);
        }
      } catch (error) {
        if (closing) return;
        const message = (error as Error).message;
        state = {
          status: 'degraded',
          redis: redisLabel,
          attempts: state.attempts,
          lastError: message,
        };
        log.warn(`Connected to Redis, but could not finish starting up: ${message}`);
      } finally {
        inFlight = undefined;
      }
    })();

    return inFlight;
  };

  try {
    const connecting = client.connect();
    connecting.catch(() => undefined);
    await Promise.race([connecting, firstError]);
  } catch (error) {
    markUnavailable(describeError(attemptError ?? (error as Error)));
  }
  if (client.status === 'ready') {
    await becomeConnected(true);
  }

  log.log(`Worker Manager listening on ${server.url}`);
  log.log(`Redis:  ${redisLabel}`);
  log.log(`Prefix: ${config.prefixes.join(', ')}`);
  if (postgres) log.log(`Postgres: ${postgres.label} (schema ${config.postgres!.schema})`);
  if (deferredIdleCount !== undefined) logIfIdle(deferredIdleCount);

  client.on('ready', () => {
    lostConnection = false;
    void becomeConnected();
  });
  client.on('error', (error: Error) => {
    markUnavailable(describeError(error));
  });

  return { url: server.url, close };
}

function warnIfExposed(config: CliConfig, log: Pick<Console, 'warn'>): void {
  if (isLoopbackHost(config.host) || config.auth || config.keycloak) return;

  log.warn(
    `Warning: Worker Manager is listening on ${config.host}, which accepts connections from ` +
      'outside this machine, with no --user/--password set. Anyone who can reach it can ' +
      'view and modify every queue. Set --user and --password (or Keycloak), or bind to 127.0.0.1.'
  );
}

/**
 * No Redis source was configured, only PostgreSQL: there is no Redis to wait for, so no
 * diagnostic page and no connection state, just discovery against the database.
 */
async function runPostgresOnly(
  config: CliConfig,
  log: Pick<Console, 'log' | 'warn'>,
  { beforeReady }: { beforeReady?: (close: () => Promise<void>) => void }
): Promise<RunningBoard> {
  const onWarning = (message: string) => log.warn(message);
  // No Redis to keep history in, so it goes into the same database as the queues.
  const history = config.history
    ? createHistory({ postgres: config.postgres!, config: config.history, onWarning })
    : null;

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(config.basePath);
  const board = createWorkerManagerBoard({
    queues: [],
    serverAdapter,
    options: { uiConfig: config.uiConfig, historyProvider: history?.provider },
  });
  const postgres: PostgresSource = createPostgresSource({
    config: config.postgres!,
    readOnly: config.readOnly,
    queueOptions: config.queueOptions,
    onWarning,
  });
  const registry = new QueueRegistry({ board, createQueue: postgres.createQueue, onWarning });

  let closing = false;
  let rescanTimer: NodeJS.Timeout | undefined;
  const scan = async () => {
    const discovered = await postgres.discover(config.queueNames);
    if (!closing) await registry.sync(discovered);
    return discovered.length;
  };

  let count: number;
  try {
    count = await scan();
  } catch (error) {
    await history?.stop();
    await postgres.close().catch(() => undefined);
    throw new Error(
      `Could not connect to PostgreSQL at ${postgres.label}: ${describeError(error as Error)}`
    );
  }

  if (history) {
    history.start(() => registry.adapters());
    if (config.history?.record) {
      await warnIfCountersUnavailable(registry.adapters(), onWarning);
    } else {
      log.warn(
        'Historical metrics are served read-only: this process records nothing, so the charts ' +
          'show only what another process has already recorded.'
      );
    }
  }

  const server = await startServer(config, { serverAdapter });

  const scheduleRescan = () => {
    if (closing || config.scanInterval <= 0 || rescanTimer) return;
    rescanTimer = setTimeout(() => {
      rescanTimer = undefined;
      scan()
        .catch((error) => log.warn(`Rescan failed: ${error.message}`))
        .finally(scheduleRescan);
    }, config.scanInterval * 1000);
    rescanTimer.unref();
  };

  const close = async () => {
    closing = true;
    if (rescanTimer) clearTimeout(rescanTimer);
    await history?.stop();
    await closeWithGrace(server.close(), SHUTDOWN_GRACE_MS, () => server.closeAllConnections());
    await closeWithGrace(registry.close(), SHUTDOWN_GRACE_MS, () =>
      log.warn(`Closing queues did not finish within ${SHUTDOWN_GRACE_MS}ms; continuing shutdown.`)
    );
    await postgres.close().catch(() => undefined);
  };

  beforeReady?.(close);

  log.log(`Worker Manager listening on ${server.url}`);
  log.log(`Postgres: ${postgres.label} (schema ${config.postgres!.schema})`);
  if (history) log.log(`History: ${history.label}`);
  if (count === 0) {
    log.log(
      'No PostgreSQL queues found yet. ' +
        (config.scanInterval > 0 ? 'Watching for new ones.' : 'Scanning was set to run once.')
    );
  }
  scheduleRescan();

  return { url: server.url, close };
}
