import { getQueueToken } from '@nestjs/bull-shared';
import type { HttpAdapterHost } from '@nestjs/core';
import { ModuleRef } from '@nestjs/core';
import { createWorkerManagerBoard } from '@worker-manager/api';
import type { BoardOptions } from '@worker-manager/api/typings/app';
import type { AuthOptions, KeycloakCookieOptions } from '@worker-manager/auth';
import {
  WorkerManagerExpressAdapter,
  WorkerManagerFastifyAdapter,
  WorkerManagerBoard,
  WorkerManagerModuleOptions,
  WorkerManagerPgBossBoard,
  WorkerManagerQueueOptions,
  WorkerManagerServerAdapter,
} from './worker-manager.types';

export const isFastifyAdapter = (
  adapter: WorkerManagerServerAdapter
): adapter is WorkerManagerFastifyAdapter => {
  return 'registerPlugin' in adapter;
};

export const isExpressAdapter = (
  adapter: WorkerManagerServerAdapter
): adapter is WorkerManagerExpressAdapter => {
  return 'getRouter' in adapter;
};

export const isEnabled = (options: WorkerManagerModuleOptions | undefined | null): boolean =>
  options?.enabled !== false;

/** `boardOptions` with the `uiConfig`, `title`, `logo` and `theme` shortcuts folded in. */
export function resolveBoardOptions(options: WorkerManagerModuleOptions): BoardOptions | undefined {
  const shortcuts = {
    ...options.uiConfig,
    ...(options.title !== undefined ? { boardTitle: options.title } : {}),
    ...(options.logo !== undefined ? { boardLogo: options.logo } : {}),
    ...(options.theme !== undefined ? { theme: options.theme } : {}),
  };
  if (Object.keys(shortcuts).length === 0) return options.boardOptions;

  return {
    ...options.boardOptions,
    uiConfig: { ...options.boardOptions?.uiConfig, ...shortcuts },
  };
}

const PLATFORM_PACKAGES = {
  express: { pkg: '@worker-manager/express', exportName: 'ExpressAdapter' },
  fastify: { pkg: '@worker-manager/fastify', exportName: 'FastifyAdapter' },
} as const;

/**
 * The configured adapter, or the one matching the Nest HTTP platform. The package is loaded
 * with a dynamic import so neither is a hard dependency, and so it also resolves when the
 * module itself runs as ESM (Nest 12).
 */
export async function resolveServerAdapter(
  options: WorkerManagerModuleOptions,
  adapterHost: HttpAdapterHost
): Promise<WorkerManagerServerAdapter> {
  if (options.adapter) return new options.adapter();

  const platform = adapterHost?.httpAdapter?.getType?.();
  const target = PLATFORM_PACKAGES[platform as keyof typeof PLATFORM_PACKAGES];
  if (!target) {
    throw new Error(
      `WorkerManagerModule could not pick a server adapter for the "${platform ?? 'unknown'}" HTTP ` +
        'platform. Pass `adapter` explicitly (ExpressAdapter from @worker-manager/express or ' +
        'FastifyAdapter from @worker-manager/fastify).'
    );
  }

  let loaded: Record<string, any>;
  try {
    loaded = await import(target.pkg);
  } catch (error) {
    throw new Error(
      `WorkerManagerModule detected a ${platform} application but could not load ${target.pkg}. ` +
        `Install it (npm install ${target.pkg}) or pass \`adapter\` explicitly. ` +
        `Cause: ${(error as Error).message}`
    );
  }
  const AdapterClass = loaded[target.exportName] ?? loaded.default?.[target.exportName];
  if (typeof AdapterClass !== 'function') {
    throw new Error(`${target.pkg} does not export ${target.exportName}.`);
  }

  return new AdapterClass();
}

/** Resolves each queue (instance or DI name) and adds it to the board. */
export function registerQueues(
  board: WorkerManagerBoard,
  moduleRef: ModuleRef,
  queues: WorkerManagerQueueOptions[],
  readOnly: boolean | undefined
): void {
  for (const queueOption of queues) {
    const queue =
      queueOption.queue ?? moduleRef.get(getQueueToken(queueOption.name), { strict: false });
    const options =
      readOnly === undefined
        ? queueOption.options
        : { readOnlyMode: readOnly, ...queueOption.options };
    board.addQueue(new queueOption.adapter(queue, options));
  }
}

const ENGINES = ['bullmq', 'pg-boss'];

/** Rejects option combinations that cannot mean anything, before any provider runs. */
export function assertEngineOptions(options: WorkerManagerModuleOptions | undefined | null): void {
  if (!options) return;
  const engine = options.engine ?? 'bullmq';
  if (!ENGINES.includes(engine)) {
    throw new Error(
      `WorkerManagerModule: unknown engine ${JSON.stringify(engine)}. Use 'bullmq' or 'pg-boss'.`
    );
  }

  if (engine !== 'pg-boss') {
    if (options.pgBoss) {
      throw new Error(
        "WorkerManagerModule: `pgBoss` is only read by a board with `engine: 'pg-boss'`."
      );
    }
    return;
  }

  if (options.queues?.length) {
    throw new Error(
      "WorkerManagerModule: `queues` registers BullMQ queues and cannot be used with `engine: 'pg-boss'`. " +
        'A pg-boss board lists the queues of its schema; narrow them with `pgBoss.queues`.'
    );
  }
  if (!isEnabled(options)) return;
  const pgBoss = options.pgBoss;
  if (!pgBoss || !(pgBoss.instance || pgBoss.useExisting || pgBoss.connection || pgBoss.engine)) {
    throw new Error(
      "WorkerManagerModule: a board with `engine: 'pg-boss'` needs `pgBoss.instance`, " +
        '`pgBoss.useExisting` or `pgBoss.connection`.'
    );
  }
}

export const isPgBossBoard = (
  board: WorkerManagerBoard | WorkerManagerPgBossBoard
): board is WorkerManagerPgBossBoard => 'engine' in board && !('addQueue' in board);

/** Creates the board a root module serves: BullMQ by default, pg-boss when asked for. */
export function createBoard(
  options: WorkerManagerModuleOptions,
  serverAdapter: WorkerManagerServerAdapter,
  moduleRef: ModuleRef
): WorkerManagerBoard | Promise<WorkerManagerPgBossBoard> {
  if (options.engine === 'pg-boss') return createPgBossBoard(options, serverAdapter, moduleRef);

  return createWorkerManagerBoard({
    queues: [],
    serverAdapter,
    options: resolveBoardOptions(options),
  });
}

async function importOptional<T>(pkg: string, reason: string): Promise<T> {
  try {
    const loaded: any = await import(pkg);
    return (
      loaded.default && !Object.keys(loaded).some((key) => key !== 'default')
        ? loaded.default
        : loaded
    ) as T;
  } catch (error) {
    throw new Error(
      `WorkerManagerModule ${reason} but could not load ${pkg}. Install it ` +
        `(npm install ${pkg}). Cause: ${(error as Error).message}`
    );
  }
}

async function createPgBossBoard(
  options: WorkerManagerModuleOptions,
  serverAdapter: WorkerManagerServerAdapter,
  moduleRef: ModuleRef
): Promise<WorkerManagerPgBossBoard> {
  const { useExisting, engine, instance, ...pgBoss } = options.pgBoss ?? {};
  const readOnly = options.readOnly ?? false;
  const boardOptions = resolveBoardOptions(options) ?? {};

  if (engine) {
    const seam = await importOptional<typeof import('@worker-manager/api/engine')>(
      '@worker-manager/api/engine',
      "mounts a board with `engine: 'pg-boss'`"
    );
    seam.mountBoard({
      engine: 'pg-boss',
      routes: seam.buildPgBossRoutes(engine, { readOnly }),
      serverAdapter,
      options: boardOptions,
      isReadOnly: () => readOnly,
      readOnlyAtMount: readOnly,
    });
    // An engine handed in is the caller's, so closing it is the caller's call too.
    return { engine, close: async () => undefined };
  }

  let resolvedInstance = instance;
  if (!resolvedInstance && useExisting) {
    try {
      resolvedInstance = moduleRef.get(useExisting, { strict: false });
    } catch (error) {
      throw new Error(
        `WorkerManagerModule could not resolve \`pgBoss.useExisting\` (${String(
          typeof useExisting === 'function' ? useExisting.name : useExisting
        )}) to a pg-boss instance. Cause: ${(error as Error).message}`
      );
    }
  }

  const { createPgBossBoard: create } = await importOptional<
    typeof import('@worker-manager/pg-boss')
  >('@worker-manager/pg-boss', "mounts a board with `engine: 'pg-boss'`");

  return create({
    serverAdapter,
    pgBoss: { ...pgBoss, instance: resolvedInstance },
    options: { ...boardOptions, readOnly },
  });
}

/**
 * Keycloak keeps its session in a `wm_session` cookie scoped to the board's path. Two boards on
 * nested paths (`/` and `/pg-boss`, or `/ops` and `/ops/pg-boss`) would both see the outer
 * board's cookie, so a named board gets `wm_session_<name>` unless a cookie name is configured.
 */
export function scopeAuthToBoard(auth: AuthOptions, name: string | undefined): AuthOptions {
  if (name === undefined || auth.strategy !== 'keycloak' || auth.cookie?.name) return auth;

  return {
    ...auth,
    cookie: { ...auth.cookie, name: `wm_session_${name}` } as KeycloakCookieOptions,
  };
}
