import type { IncomingMessage, ServerResponse } from 'node:http';

/** The identity the middleware attaches to `req.user` once a request is authenticated. */
export interface AuthUser {
  username: string;
  name?: string;
  email?: string;
  roles: string[];
}

export type AuthStrategy = 'basic' | 'keycloak';

/**
 * Called once per authenticated request, after role checks. Returning `false` (or a promise of
 * it) rejects the request with 403, which is the hook for rules the options cannot express.
 */
export type OnAuthenticated = (
  user: AuthUser,
  req: IncomingMessage
) => void | boolean | Promise<void | boolean>;

interface CommonAuthOptions {
  onAuthenticated?: OnAuthenticated;
}

export interface BasicAuthUser {
  username: string;
  password: string;
  roles?: string[];
  name?: string;
  email?: string;
}

export interface BasicAuthOptions extends CommonAuthOptions {
  strategy: 'basic';
  /** Static credentials. Compared in constant time, every entry on every request. */
  users?: BasicAuthUser[];
  /**
   * Custom credential check, tried when no static user matched. Return the user to attach,
   * `true` to accept with a user built from the username, or `false` to reject.
   */
  validate?: (
    username: string,
    password: string
  ) => AuthUser | boolean | null | undefined | Promise<AuthUser | boolean | null | undefined>;
  /** The realm named in the `WWW-Authenticate` challenge. Defaults to `worker-manager`. */
  realm?: string;
}

export interface KeycloakCookieOptions {
  /** Session cookie name. Defaults to `wm_session`. */
  name?: string;
  /** Key material the session cookie is encrypted with (AES-256-GCM). Use 32+ random chars. */
  secret: string;
  /** Defaults to true when the board is reached over https. */
  secure?: boolean;
  /** Lifetime of the session cookie. Defaults to 8 hours. */
  maxAgeSeconds?: number;
}

export interface KeycloakAuthOptions extends CommonAuthOptions {
  strategy: 'keycloak';
  /** Keycloak base URL, e.g. `https://sso.example.com` (append `/auth` for pre-17 installs). */
  url: string;
  realm: string;
  clientId: string;
  /** Required for confidential clients. */
  clientSecret?: string;
  /**
   * External URL of the board, e.g. `https://ops.example.com/queues`. A bare origin
   * (`https://ops.example.com`) is completed with the board's base path. The redirect URI is
   * `${publicUrl}/auth/callback`. Defaults to the request's own origin
   * (honouring `X-Forwarded-Proto` / `X-Forwarded-Host`) plus the base path.
   */
  publicUrl?: string;
  /** Realm roles or client roles (`resource_access[clientId].roles`). Any one of them grants access. */
  requiredRoles?: string[];
  /** Defaults to `openid profile email`. */
  scope?: string;
  cookie?: KeycloakCookieOptions;
  /** Only accept `Authorization: Bearer` tokens; never start a browser login. */
  bearerOnly?: boolean;
  /** Accepted token audiences. Defaults to `clientId` (matched against `aud` or `azp`). */
  audience?: string | string[];
  /** Clock skew tolerated when checking `exp` / `nbf`, in seconds. Defaults to 30. */
  clockToleranceSeconds?: number;
}

export type AuthOptions = BasicAuthOptions | KeycloakAuthOptions;

export interface AuthMiddlewareContext {
  /** The path the board is mounted under, e.g. `/queues`. `''` or `/` for the root. */
  basePath?: string;
}

/** The body of `GET ${basePath}/auth/me`. */
export interface AuthMeResponse {
  strategy: AuthStrategy;
  user: AuthUser;
  logoutUrl: string | null;
}

export type NextFunction = (error?: unknown) => void;

export interface AuthMiddleware {
  (req: IncomingMessage, res: ServerResponse, next: NextFunction): void;
  /**
   * The promise-based core, for hosts that are not connect-style. Resolves `true` when the
   * request may continue to the board (and `req.user` is set), `false` when the middleware
   * already answered it.
   */
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  readonly strategy: AuthStrategy;
  readonly basePath: string;
}

export type RequestWithUser = IncomingMessage & { user?: AuthUser };
