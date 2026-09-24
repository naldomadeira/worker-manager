import { getQueueToken } from '@nestjs/bull-shared';
import type { HttpAdapterHost } from '@nestjs/core';
import { ModuleRef } from '@nestjs/core';
import type { BoardOptions } from '@worker-manager/api/typings/app';
import {
  BullBoardExpressAdapter,
  BullBoardFastifyAdapter,
  BullBoardInstance,
  BullBoardModuleOptions,
  BullBoardQueueOptions,
  BullBoardServerAdapter,
} from './bull-board.types';

export const isFastifyAdapter = (
  adapter: BullBoardServerAdapter
): adapter is BullBoardFastifyAdapter => {
  return 'registerPlugin' in adapter;
};

export const isExpressAdapter = (
  adapter: BullBoardServerAdapter
): adapter is BullBoardExpressAdapter => {
  return 'getRouter' in adapter;
};

export const isEnabled = (options: BullBoardModuleOptions | undefined | null): boolean =>
  options?.enabled !== false;

/** `boardOptions` with the `uiConfig`, `title`, `logo` and `theme` shortcuts folded in. */
export function resolveBoardOptions(options: BullBoardModuleOptions): BoardOptions | undefined {
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
  options: BullBoardModuleOptions,
  adapterHost: HttpAdapterHost
): Promise<BullBoardServerAdapter> {
  if (options.adapter) return new options.adapter();

  const platform = adapterHost?.httpAdapter?.getType?.();
  const target = PLATFORM_PACKAGES[platform as keyof typeof PLATFORM_PACKAGES];
  if (!target) {
    throw new Error(
      `BullBoardModule could not pick a server adapter for the "${platform ?? 'unknown'}" HTTP ` +
        'platform. Pass `adapter` explicitly (ExpressAdapter from @worker-manager/express or ' +
        'FastifyAdapter from @worker-manager/fastify).'
    );
  }

  let loaded: Record<string, any>;
  try {
    loaded = await import(target.pkg);
  } catch (error) {
    throw new Error(
      `BullBoardModule detected a ${platform} application but could not load ${target.pkg}. ` +
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
  board: BullBoardInstance,
  moduleRef: ModuleRef,
  queues: BullBoardQueueOptions[],
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
