import type { Server } from 'node:http';
import type { ExpressAdapter } from '@worker-manager/express';
import express, { type Express } from 'express';
import { createCliAuth } from './auth';
import type { CliConfig } from './config/types';
import type { ConnectionState } from './connectionState';
import { statusHandler, STATUS_PATH, unavailableGate } from './unavailableGate';

export interface RunningServer {
  app: Express;
  url: string;
  close(): Promise<void>;
  closeAllConnections(): void;
}

/** A board served under a path of its own, next to the one at the root. */
export interface MountedBoard {
  /** Relative to `--base-path`, e.g. `/pg-boss`. */
  path: string;
  serverAdapter: ExpressAdapter;
}

export async function startServer(
  config: CliConfig,
  {
    serverAdapter,
    getConnectionState,
    boards = [],
  }: {
    serverAdapter: ExpressAdapter;
    getConnectionState?: () => ConnectionState;
    boards?: MountedBoard[];
  }
): Promise<RunningServer> {
  const app = express();

  const auth = createCliAuth(config);
  if (auth) {
    // Mounted at the root, so the status endpoint and the diagnostic page are guarded too.
    app.use(auth as unknown as express.RequestHandler);
  }

  // Ahead of the Redis gate: a board that does not live in Redis keeps working while it is down.
  for (const board of boards) {
    app.use(`${config.basePath}${board.path}`, board.serverAdapter.getRouter());
  }

  if (getConnectionState) {
    app.get(STATUS_PATH, statusHandler(getConnectionState));
    app.use(unavailableGate(getConnectionState, { apiPrefix: `${config.basePath}/api` }));
  }

  app.use(config.basePath || '/', serverAdapter.getRouter());

  // Express registers this callback as both the 'listening' and the 'error' handler, so a
  // failed bind arrives here rather than through a later .on('error').
  const server = await new Promise<Server>((resolve, reject) => {
    const listening = app.listen(config.port, config.host, (error?: Error) =>
      error ? reject(error) : resolve(listening)
    );
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;

  return {
    app,
    url: `http://${config.host}:${port}${config.basePath}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
    closeAllConnections: () => server.closeAllConnections(),
  };
}
