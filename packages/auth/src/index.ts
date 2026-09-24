import type { IncomingMessage, ServerResponse } from 'node:http';
import { createBasicStrategy, type StrategyHandler } from './basic';
import { forbidden, normalizeBasePath, requestUrl, sendJson } from './http';
import { createKeycloakStrategy } from './keycloak';
import type {
  AuthMeResponse,
  AuthMiddleware,
  AuthMiddlewareContext,
  AuthOptions,
  AuthUser,
  RequestWithUser,
} from './types';

export * from './types';
export { safeEqual } from './basic';
export { rolesFromClaims, userFromClaims } from './keycloak';

/**
 * Builds a connect-style `(req, res, next)` middleware that authenticates every request it
 * sees and serves `${basePath}/auth/{me,login,callback,logout}`. It only touches the Node
 * `IncomingMessage` / `ServerResponse` pair, so it runs in front of Express, Koa (through
 * koa-connect), Nest, plain `http`, and Fastify (see `createFastifyAuthHook`).
 *
 * Mount it where the board is mounted, or at the root: it matches its endpoints against the
 * full request path either way.
 */
export function createAuthMiddleware(
  options: AuthOptions,
  context: AuthMiddlewareContext = {}
): AuthMiddleware {
  const basePath = normalizeBasePath(context.basePath);
  const strategy: StrategyHandler =
    options.strategy === 'basic'
      ? createBasicStrategy(options, basePath)
      : options.strategy === 'keycloak'
        ? createKeycloakStrategy(options, basePath)
        : (() => {
            throw new Error(
              `@worker-manager/auth: unknown strategy "${(options as { strategy?: string }).strategy}".`
            );
          })();

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const path = requestUrl(req).pathname.replace(/\/+$/, '');

    if (await strategy.route(req, res, path)) return false;

    const user = await strategy.authenticate(req, res);
    if (!user) return false;

    if (options.onAuthenticated) {
      const verdict = await options.onAuthenticated(user, req);
      if (verdict === false) {
        forbidden(res);
        return false;
      }
    }
    (req as RequestWithUser).user = user;

    if (path === `${basePath}/auth/me` && (req.method === 'GET' || req.method === 'HEAD')) {
      const body: AuthMeResponse = {
        strategy: options.strategy,
        user,
        ...strategy.meResponse(user, req),
      };
      sendJson(res, 200, body);
      return false;
    }

    return true;
  };

  const middleware = ((req, res, next) => {
    handle(req, res).then(
      (proceed) => {
        if (proceed) next();
      },
      (error) => next(error)
    );
  }) as AuthMiddleware;

  Object.defineProperties(middleware, {
    handle: { value: handle },
    strategy: { value: options.strategy, enumerable: true },
    basePath: { value: basePath, enumerable: true },
  });

  return middleware;
}

interface FastifyLikeRequest {
  raw: IncomingMessage;
  user?: AuthUser;
}

interface FastifyLikeReply {
  raw: ServerResponse;
  hijack(): unknown;
}

/**
 * The same middleware as a Fastify `onRequest` hook. When the middleware answers a request
 * itself (a 401, a redirect, `/auth/me`) the reply is hijacked so Fastify does not try to send
 * a second response.
 *
 * ```ts
 * app.register(async (scope) => {
 *   scope.addHook('onRequest', createFastifyAuthHook(options, { basePath: '/ui' }));
 *   await scope.register(serverAdapter.registerPlugin());
 * }, { prefix: '/ui' });
 * ```
 */
export function createFastifyAuthHook(
  options: AuthOptions | AuthMiddleware,
  context: AuthMiddlewareContext = {}
): (request: FastifyLikeRequest, reply: FastifyLikeReply) => Promise<void> {
  const middleware =
    typeof options === 'function' ? options : createAuthMiddleware(options, context);

  return async (request, reply) => {
    const proceed = await middleware.handle(request.raw, reply.raw);
    if (proceed) {
      request.user = (request.raw as RequestWithUser).user;
      return;
    }
    reply.hijack();
  };
}

interface FastifyLikeScope {
  addHook(name: 'onRequest', hook: (request: any, reply: any) => Promise<void>): unknown;
  get(path: string, handler: (request: any, reply: any) => unknown): unknown;
  register(plugin: any, options?: any): unknown;
}

/**
 * Wraps a board's Fastify plugin so every route it registers, plus the `/auth/*` endpoints,
 * sits behind the auth hook. Register the result where the board plugin would have gone:
 *
 * ```ts
 * app.register(createFastifyAuthPlugin(serverAdapter.registerPlugin(), auth), { prefix: '/ui' });
 * ```
 *
 * The hook is encapsulated in the plugin's scope, so the rest of the application is untouched.
 */
export function createFastifyAuthPlugin(
  boardPlugin: unknown,
  auth: AuthMiddleware
): (scope: FastifyLikeScope, options: Record<string, unknown>) => Promise<void> {
  const hook = createFastifyAuthHook(auth);

  return async (scope) => {
    scope.addHook('onRequest', hook);
    // Fastify only runs a scope's hooks for routes it knows, so the auth endpoints need a
    // route to hang off. The hook answers the real ones; anything else under /auth is a 404.
    scope.get('/auth/:action', (_request, reply) => reply.code(404).send());
    await scope.register(boardPlugin);
  };
}

/** The user the middleware attached to the request, if any. */
export function getAuthUser(req: IncomingMessage): AuthUser | undefined {
  return (req as RequestWithUser).user;
}
