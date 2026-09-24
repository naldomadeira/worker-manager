import Hapi from '@hapi/hapi';
import { createWorkerManagerBoard } from '@worker-manager/api';
import {
  runServerAdapterContract,
  uiFixtureBasePath,
  NormalizedResponse,
  ContractRequest,
} from '@worker-manager/test-utils';
import { HapiAdapter } from '../src';

runServerAdapterContract('Hapi', async ({ basePath, queue }) => {
  const serverAdapter = new HapiAdapter();
  serverAdapter.setBasePath(basePath);
  createWorkerManagerBoard({
    queues: [queue.adapter],
    serverAdapter,
    options: { uiBasePath: uiFixtureBasePath },
  });

  const server = Hapi.server({ router: { stripTrailingSlash: true } });
  await server.register({
    plugin: serverAdapter.registerPlugin(),
    ...(basePath ? { routes: { prefix: basePath } } : {}),
  });
  await server.initialize();

  const send = async (req: ContractRequest): Promise<NormalizedResponse> => {
    const res = await server.inject({
      method: req.method.toUpperCase() as any,
      url: req.path,
      payload: req.body as any,
    });
    return { status: res.statusCode, headers: res.headers as any, text: res.payload };
  };

  return {
    request: send,
    teardown: async () => {
      await server.stop();
    },
  };
});
