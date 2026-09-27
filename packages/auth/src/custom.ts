import type { StrategyHandler } from './basic';
import { sendJson } from './http';
import type { CustomAuthOptions } from './types';

/**
 * Delegates the decision to the application: validate a Cloudflare Access JWT, reuse an API-key
 * check, read a header set by an authenticating proxy. The rest of the middleware (role hook,
 * `req.user`, `/auth/me`) behaves as for the built-in strategies.
 */
export function createCustomStrategy(options: CustomAuthOptions): StrategyHandler {
  if (typeof options.authenticate !== 'function') {
    throw new Error('@worker-manager/auth: the custom strategy needs an `authenticate` function.');
  }

  return {
    async authenticate(req, res) {
      const user = await options.authenticate(req);
      if (user) {
        if (typeof user !== 'object' || typeof user.username !== 'string') {
          throw new TypeError(
            '@worker-manager/auth: `authenticate` must resolve a user with a string `username`, or null.'
          );
        }
        return { ...user, roles: user.roles ?? [] };
      }

      if (options.onUnauthenticated) await options.onUnauthenticated(req, res);
      if (!res.headersSent && !res.writableEnded) {
        sendJson(res, 401, { error: { key: 'ERRORS.UNAUTHORIZED' }, code: 'UNAUTHORIZED' });
      }
      return null;
    },

    async route() {
      return false;
    },

    meResponse() {
      return { logoutUrl: options.logoutUrl ?? null };
    },
  };
}
