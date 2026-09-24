import { createAuthMiddleware, type AuthMiddleware } from '@worker-manager/auth';
import type { RequestHandler } from 'express';
import type { CliConfig } from './config/types';

/**
 * Basic auth for a single user, through @worker-manager/auth: credentials are compared in
 * constant time, a failure answers 401 with a `WWW-Authenticate` challenge.
 */
export function basicAuth({ user, password }: { user: string; password: string }): RequestHandler {
  return createAuthMiddleware({
    strategy: 'basic',
    realm: 'bull-board',
    users: [{ username: user, password }],
  }) as unknown as RequestHandler;
}

/** The middleware guarding the whole server, or null when no auth is configured. */
export function createCliAuth(config: CliConfig): AuthMiddleware | null {
  if (config.keycloak) {
    return createAuthMiddleware(config.keycloak, { basePath: config.basePath });
  }
  if (config.auth) {
    return createAuthMiddleware(
      {
        strategy: 'basic',
        realm: 'bull-board',
        users: [{ username: config.auth.user, password: config.auth.password }],
      },
      { basePath: config.basePath }
    );
  }

  return null;
}
