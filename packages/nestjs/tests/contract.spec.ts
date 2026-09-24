import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { ExpressAdapter as WorkerManagerExpressAdapter } from '@worker-manager/express';
import {
  runServerAdapterContract,
  uiFixtureBasePath,
  NormalizedResponse,
  ContractRequest,
} from '@worker-manager/test-utils';
import { json } from 'express';
import request from 'supertest';
import { WorkerManagerModule } from '../src';
import { WORKER_MANAGER_INSTANCE } from '../src/worker-manager.constants';
import type { WorkerManagerBoard } from '../src/worker-manager.types';

runServerAdapterContract('NestJS', async ({ basePath, queue }) => {
  const nestExpressAdapter = new ExpressAdapter();

  const route = basePath || '/';

  const appModule = WorkerManagerModule.forRoot({
    route,
    adapter: WorkerManagerExpressAdapter,
    boardOptions: { uiBasePath: uiFixtureBasePath },
    middleware: json(),
  });

  const app = await NestFactory.create(appModule, nestExpressAdapter, { logger: false });
  await app.init();

  const board = app.get<WorkerManagerBoard>(WORKER_MANAGER_INSTANCE);
  board.addQueue(queue.adapter);

  const send = async (req: ContractRequest): Promise<NormalizedResponse> => {
    const agent = request(app.getHttpServer());
    const m = req.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete';
    let r = agent[m](req.path);
    if (req.body !== undefined) r = r.send(req.body as object);
    const res = await r;
    return { status: res.status, headers: res.headers as any, text: res.text };
  };

  return {
    request: send,
    teardown: async () => {
      await app.close();
    },
  };
});
