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
import { WorkerManagerModule } from '../../src';
import { WORKER_MANAGER_INSTANCE } from '../../src/worker-manager.constants';
import type { WorkerManagerBoard } from '../../src/worker-manager.types';

runServerAdapterContract('NestJS', async ({ basePath, queue }) => {
  const appModule = WorkerManagerModule.forRoot({
    route: basePath || '/',
    adapter: WorkerManagerExpressAdapter,
    boardOptions: { uiBasePath: uiFixtureBasePath },
    middleware: json(),
  });

  const app = await NestFactory.create(appModule, new ExpressAdapter(), { logger: false });
  await app.init();
  app.get<WorkerManagerBoard>(WORKER_MANAGER_INSTANCE).addQueue(queue.adapter);

  const send = async (req: ContractRequest): Promise<NormalizedResponse> => {
    const m = req.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete';
    let r = request(app.getHttpServer())[m](req.path);
    if (req.body !== undefined) r = r.send(req.body as object);
    const res = await r;
    return { status: res.status, headers: res.headers as any, text: res.text };
  };

  return { request: send, teardown: () => app.close() };
});
