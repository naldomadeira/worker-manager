import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, unauthorized } from './http';
import type { AuthUser, BasicAuthOptions } from './types';

export interface StrategyHandler {
  /** Resolves the authenticated user, or `null` after answering the request itself. */
  authenticate(req: IncomingMessage, res: ServerResponse): Promise<AuthUser | null>;
  /** Answers the strategy's own endpoints; `true` when it did. */
  route(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean>;
  meResponse(user: AuthUser, req: IncomingMessage): { logoutUrl: string | null };
}

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();

/**
 * Both sides are hashed first, so the comparison always runs over 32 bytes and neither the
 * length nor the content of the expected value leaks through timing.
 */
export function safeEqual(supplied: string, expected: string): boolean {
  return timingSafeEqual(digest(supplied), digest(expected));
}

export function parseBasicHeader(
  header: string | undefined
): { username: string; password: string } | null {
  if (!header) return null;
  const [scheme, encoded] = header.trim().split(/\s+/, 2);
  if (scheme?.toLowerCase() !== 'basic' || !encoded) return null;

  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 0) return null;

  return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
}

export function createBasicStrategy(options: BasicAuthOptions, basePath: string): StrategyHandler {
  const users = options.users ?? [];
  if (users.length === 0 && !options.validate) {
    throw new Error('@worker-manager/auth: the basic strategy needs `users` or `validate`.');
  }
  const realm = (options.realm ?? 'worker-manager').replace(/"/g, '');
  const challenge = `Basic realm="${realm}", charset="UTF-8"`;

  const checkStatic = (username: string, password: string): AuthUser | null => {
    let match: AuthUser | null = null;
    // Every entry is compared, match or not, so the position of a user in the list is not
    // observable either.
    for (const user of users) {
      const ok = safeEqual(username, user.username) && safeEqual(password, user.password);
      if (ok && !match) {
        match = {
          username: user.username,
          name: user.name,
          email: user.email,
          roles: user.roles ?? [],
        };
      }
    }

    return match;
  };

  return {
    async authenticate(req, res) {
      const credentials = parseBasicHeader(req.headers.authorization);
      if (credentials) {
        const staticUser = checkStatic(credentials.username, credentials.password);
        if (staticUser) return staticUser;

        if (options.validate) {
          const result = await options.validate(credentials.username, credentials.password);
          if (result === true) return { username: credentials.username, roles: [] };
          if (result && typeof result === 'object') {
            return { ...result, roles: result.roles ?? [] };
          }
        }
      }

      unauthorized(res, challenge);

      return null;
    },

    async route(_req, res, path) {
      if (path !== `${basePath}/auth/logout`) return false;
      // Browsers only forget Basic credentials when they are challenged again.
      res.setHeader('WWW-Authenticate', challenge);
      sendJson(res, 401, { error: { key: 'ERRORS.UNAUTHORIZED' }, code: 'UNAUTHORIZED' });

      return true;
    },

    meResponse() {
      return { logoutUrl: null };
    },
  };
}
