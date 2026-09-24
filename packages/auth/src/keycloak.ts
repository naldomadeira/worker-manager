import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { StrategyHandler } from './basic';
import {
  appendSetCookie,
  forbidden,
  isNavigation,
  parseCookies,
  redirect,
  requestOrigin,
  requestTarget,
  requestUrl,
  safeReturnTo,
  serializeCookie,
  unauthorized,
} from './http';
import { Sealer } from './seal';
import type { AuthUser, KeycloakAuthOptions } from './types';

interface OidcConfiguration {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
}

interface TokenResponse {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
}

/** What the session cookie carries. Short keys, since the whole thing must fit in ~4 KB. */
interface Session {
  v: 1;
  u: AuthUser;
  /** Expiry of the session's access, epoch seconds. */
  e: number;
  /** Refresh token, when it fits. */
  r?: string;
  /** ID token, kept as the logout hint when it fits. */
  i?: string;
}

interface FlowState {
  s: string;
  v: string;
  n: string;
  t: string;
}

const DEFAULT_SCOPE = 'openid profile email';
const DEFAULT_COOKIE_NAME = 'wm_session';
const DEFAULT_MAX_AGE = 8 * 60 * 60;
const FLOW_MAX_AGE = 10 * 60;
/** Browsers drop cookies over 4096 bytes including name and attributes. */
const MAX_COOKIE_VALUE = 3800;

const base64url = (buffer: Buffer) => buffer.toString('base64url');
const randomToken = () => base64url(randomBytes(32));
const pkceChallenge = (verifier: string) =>
  base64url(createHash('sha256').update(verifier).digest());

export function rolesFromClaims(claims: JWTPayload, clientId: string): string[] {
  const roles = new Set<string>();
  const realmAccess = claims.realm_access as { roles?: unknown } | undefined;
  const resourceAccess = claims.resource_access as
    | Record<string, { roles?: unknown } | undefined>
    | undefined;

  for (const role of Array.isArray(realmAccess?.roles) ? realmAccess!.roles : []) {
    if (typeof role === 'string') roles.add(role);
  }
  const clientRoles = resourceAccess?.[clientId]?.roles;
  for (const role of Array.isArray(clientRoles) ? clientRoles : []) {
    if (typeof role === 'string') roles.add(role);
  }

  return [...roles];
}

export function userFromClaims(claims: JWTPayload, roles: string[]): AuthUser {
  const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

  return {
    username: str(claims.preferred_username) ?? str(claims.email) ?? String(claims.sub ?? ''),
    name: str(claims.name),
    email: str(claims.email),
    roles,
  };
}

export function createKeycloakStrategy(
  options: KeycloakAuthOptions,
  basePath: string
): StrategyHandler {
  if (!options.url || !options.realm || !options.clientId) {
    throw new Error(
      '@worker-manager/auth: the keycloak strategy needs `url`, `realm` and `clientId`.'
    );
  }

  const issuer = `${options.url.replace(/\/+$/, '')}/realms/${encodeURIComponent(options.realm)}`;
  const audiences = options.audience
    ? Array.isArray(options.audience)
      ? options.audience
      : [options.audience]
    : [options.clientId];
  const clockTolerance = options.clockToleranceSeconds ?? 30;
  const cookieName = options.cookie?.name ?? DEFAULT_COOKIE_NAME;
  const flowCookieName = `${cookieName}_flow`;
  const cookiePath = basePath || '/';
  const maxAge = options.cookie?.maxAgeSeconds ?? DEFAULT_MAX_AGE;
  const scope = options.scope ?? DEFAULT_SCOPE;
  const requiredRoles = options.requiredRoles ?? [];
  const bearerChallenge = `Bearer realm="${options.realm.replace(/"/g, '')}"`;

  let secret = options.cookie?.secret ?? options.clientSecret;
  if (!secret && !options.bearerOnly) {
    secret = randomToken();
    // oxlint-disable-next-line no-console
    console.warn(
      '@worker-manager/auth: no cookie.secret configured, sessions are encrypted with a random ' +
        'per-process key. They will not survive a restart or be shared between instances.'
    );
  }
  const sealer = secret ? new Sealer(secret) : null;

  let discovery: Promise<OidcConfiguration> | undefined;
  let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
  const sources = new WeakMap<IncomingMessage, 'bearer' | 'session'>();

  const getConfiguration = (): Promise<OidcConfiguration> => {
    discovery ??= (async () => {
      const response = await fetch(`${issuer}/.well-known/openid-configuration`, {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`OIDC discovery failed for ${issuer}: HTTP ${response.status}`);
      }

      return (await response.json()) as OidcConfiguration;
    })();
    // A failed discovery is retried by the next request rather than cached forever.
    discovery.catch(() => {
      discovery = undefined;
    });

    return discovery;
  };

  const getJwks = async () => {
    if (!jwks) {
      const configuration = await getConfiguration();
      jwks = createRemoteJWKSet(new URL(configuration.jwks_uri));
    }

    return jwks;
  };

  const verifyAccessToken = async (token: string): Promise<JWTPayload> => {
    const { payload } = await jwtVerify(token, await getJwks(), { issuer, clockTolerance });
    const aud =
      payload.aud === undefined ? [] : Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const azp = typeof payload.azp === 'string' ? payload.azp : undefined;
    if (!audiences.some((audience) => aud.includes(audience) || azp === audience)) {
      throw new Error('token audience does not match');
    }

    return payload;
  };

  const hasRequiredRole = (user: AuthUser) =>
    requiredRoles.length === 0 || requiredRoles.some((role) => user.roles.includes(role));

  // A bare origin (`https://ops.example.com`) is completed with the base path, so both that and
  // the full board URL (`https://ops.example.com/queues`) produce the same redirect URI.
  const configuredUrl = (() => {
    if (!options.publicUrl) return undefined;
    const trimmed = options.publicUrl.replace(/\/+$/, '');
    const hasPath = new URL(trimmed).pathname.replace(/\/+$/, '') !== '';
    return hasPath ? trimmed : `${trimmed}${basePath.replace(/\/+$/, '')}`;
  })();
  const boardUrl = (req: IncomingMessage) => configuredUrl ?? `${requestOrigin(req)}${basePath}`;
  const redirectUri = (req: IncomingMessage) => `${boardUrl(req)}/auth/callback`;
  const isSecure = (req: IncomingMessage) =>
    options.cookie?.secure ?? boardUrl(req).startsWith('https://');

  const setCookie = (
    req: IncomingMessage,
    res: ServerResponse,
    name: string,
    value: string,
    age: number
  ) =>
    appendSetCookie(
      res,
      serializeCookie(name, value, { path: cookiePath, maxAge: age, secure: isSecure(req) })
    );
  const clearCookie = (req: IncomingMessage, res: ServerResponse, name: string) =>
    setCookie(req, res, name, '', 0);

  const tokenRequest = async (params: Record<string, string>): Promise<TokenResponse> => {
    const configuration = await getConfiguration();
    const body = new URLSearchParams({ client_id: options.clientId, ...params });
    if (options.clientSecret) body.set('client_secret', options.clientSecret);
    const response = await fetch(configuration.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(),
    });
    if (!response.ok) {
      throw new Error(`token endpoint answered HTTP ${response.status}`);
    }

    return (await response.json()) as TokenResponse;
  };

  /** Builds and stores the session for a fresh token set. Returns the user. */
  const establishSession = async (
    req: IncomingMessage,
    res: ServerResponse,
    tokens: TokenResponse,
    nonce?: string,
    previous?: Session
  ): Promise<AuthUser> => {
    let idClaims: JWTPayload | undefined;
    if (tokens.id_token) {
      const { payload } = await jwtVerify(tokens.id_token, await getJwks(), {
        issuer,
        audience: options.clientId,
        clockTolerance,
      });
      if (nonce !== undefined && payload.nonce !== nonce)
        throw new Error('ID token nonce mismatch');
      idClaims = payload;
    }

    let accessClaims: JWTPayload | undefined;
    try {
      accessClaims = await verifyAccessToken(tokens.access_token);
    } catch (error) {
      // Opaque or foreign-audience access tokens still leave the verified ID token.
      if (!idClaims) throw error;
    }

    const claims = { ...idClaims, ...accessClaims };
    const user = userFromClaims(claims, rolesFromClaims(claims, options.clientId));
    const now = Math.floor(Date.now() / 1000);
    const accessExp =
      typeof accessClaims?.exp === 'number' ? accessClaims.exp : now + (tokens.expires_in ?? 300);
    const refreshToken = tokens.refresh_token ?? previous?.r;
    const idToken = tokens.id_token ?? previous?.i;

    // Without a refresh token the session cannot be renewed, so it lives as long as the
    // provider would have let the refresh token live. Tokens are dropped, least useful first,
    // until the sealed session fits in a cookie.
    const longExp = now + (tokens.refresh_expires_in || maxAge);
    const candidates: Array<Session | null> = [
      refreshToken && idToken ? { v: 1, u: user, e: accessExp, r: refreshToken, i: idToken } : null,
      refreshToken ? { v: 1, u: user, e: accessExp, r: refreshToken } : null,
      idToken ? { v: 1, u: user, e: longExp, i: idToken } : null,
      { v: 1, u: user, e: longExp },
    ];
    const sealed = candidates
      .filter((candidate): candidate is Session => candidate !== null)
      .map((candidate) => sealer!.seal(candidate))
      .find((value) => value.length <= MAX_COOKIE_VALUE);
    if (!sealed) throw new Error('session does not fit in a cookie');

    setCookie(req, res, cookieName, sealed, maxAge);

    return user;
  };

  const startLogin = async (req: IncomingMessage, res: ServerResponse, returnTo: string) => {
    const configuration = await getConfiguration();
    const flow: FlowState = { s: randomToken(), v: randomToken(), n: randomToken(), t: returnTo };
    setCookie(req, res, flowCookieName, sealer!.seal(flow), FLOW_MAX_AGE);

    const url = new URL(configuration.authorization_endpoint);
    url.searchParams.set('client_id', options.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', scope);
    url.searchParams.set('redirect_uri', redirectUri(req));
    url.searchParams.set('state', flow.s);
    url.searchParams.set('nonce', flow.n);
    url.searchParams.set('code_challenge', pkceChallenge(flow.v));
    url.searchParams.set('code_challenge_method', 'S256');
    redirect(res, url.toString());
  };

  const handleCallback = async (req: IncomingMessage, res: ServerResponse) => {
    const url = requestUrl(req);
    const cookies = parseCookies(req);
    const flow = sealer!.unseal<FlowState>(cookies[flowCookieName]);
    clearCookie(req, res, flowCookieName);

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!flow || !code || !state || state !== flow.s) {
      unauthorized(res, bearerChallenge);
      return;
    }

    let user: AuthUser;
    try {
      const tokens = await tokenRequest({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri(req),
        code_verifier: flow.v,
      });
      user = await establishSession(req, res, tokens, flow.n);
    } catch {
      unauthorized(res, bearerChallenge);
      return;
    }

    if (!hasRequiredRole(user)) {
      forbidden(res);
      return;
    }
    redirect(res, safeReturnTo(flow.t, `${basePath}/`));
  };

  const handleLogout = async (req: IncomingMessage, res: ServerResponse) => {
    const session = sealer?.unseal<Session>(parseCookies(req)[cookieName]);
    clearCookie(req, res, cookieName);

    let endSession: string | undefined;
    try {
      endSession = (await getConfiguration()).end_session_endpoint;
    } catch {
      endSession = undefined;
    }
    if (!endSession) {
      redirect(res, `${basePath}/`);
      return;
    }

    const url = new URL(endSession);
    url.searchParams.set('client_id', options.clientId);
    url.searchParams.set('post_logout_redirect_uri', `${boardUrl(req)}/`);
    if (session?.i) url.searchParams.set('id_token_hint', session.i);
    redirect(res, url.toString());
  };

  /** Reads, and when needed silently refreshes, the browser session. */
  const sessionUser = async (
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<AuthUser | null> => {
    if (!sealer) return null;
    const raw = parseCookies(req)[cookieName];
    const session = sealer.unseal<Session>(raw);
    if (!session || session.v !== 1) {
      if (raw) clearCookie(req, res, cookieName);
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    if (session.e > now) return session.u;

    if (session.r) {
      try {
        const tokens = await tokenRequest({
          grant_type: 'refresh_token',
          refresh_token: session.r,
        });
        return await establishSession(req, res, tokens, undefined, session);
      } catch {
        // Fall through: the refresh token is revoked or expired, so a new login is needed.
      }
    }
    clearCookie(req, res, cookieName);

    return null;
  };

  return {
    async authenticate(req, res) {
      const header = req.headers.authorization;
      const [scheme, token] = (header ?? '').trim().split(/\s+/, 2);
      let user: AuthUser | null = null;

      if (scheme?.toLowerCase() === 'bearer' && token) {
        try {
          const claims = await verifyAccessToken(token);
          user = userFromClaims(claims, rolesFromClaims(claims, options.clientId));
          sources.set(req, 'bearer');
        } catch {
          unauthorized(res, `${bearerChallenge}, error="invalid_token"`);
          return null;
        }
      } else if (!options.bearerOnly) {
        user = await sessionUser(req, res);
        if (user) sources.set(req, 'session');
      }

      if (!user) {
        if (!options.bearerOnly && isNavigation(req)) {
          await startLogin(req, res, safeReturnTo(requestTarget(req), `${basePath}/`));
        } else {
          unauthorized(res, bearerChallenge);
        }
        return null;
      }

      if (!hasRequiredRole(user)) {
        forbidden(res);
        return null;
      }

      return user;
    },

    async route(req, res, path) {
      if (options.bearerOnly) return false;

      if (path === `${basePath}/auth/login`) {
        const returnTo = requestUrl(req).searchParams.get('returnTo');
        await startLogin(req, res, safeReturnTo(returnTo, `${basePath}/`));
        return true;
      }
      if (path === `${basePath}/auth/callback`) {
        await handleCallback(req, res);
        return true;
      }
      if (path === `${basePath}/auth/logout`) {
        await handleLogout(req, res);
        return true;
      }

      return false;
    },

    meResponse(_user, req) {
      return { logoutUrl: sources.get(req) === 'session' ? `${basePath}/auth/logout` : null };
    },
  };
}
