import type { IncomingMessage, ServerResponse } from 'node:http';
import { safeEqual, type StrategyHandler } from './basic';
import {
  appendSetCookie,
  BodyTooLargeError,
  escapeHtml,
  firstHeader,
  forbidden,
  isNavigation,
  parseCookies,
  readForm,
  redirect,
  requestOrigin,
  requestTarget,
  requestUrl,
  safeReturnTo,
  sendHtml,
  sendJson,
  serializeCookie,
  unauthorized,
} from './http';
import { Sealer } from './seal';
import type { AuthUser, TokenAuthOptions } from './types';

/**
 * What the session cookie carries: the token itself, sealed with AES-256-GCM so it is never
 * readable client side, and re-checked on every request so a revoked token ends its sessions.
 */
interface TokenSession {
  v: 1;
  t: string;
  /** Expiry, epoch seconds. */
  e: number;
}

const DEFAULT_COOKIE_NAME = 'wm_session';
const DEFAULT_MAX_AGE = 8 * 60 * 60;
const FORM_LIMIT = 16 * 1024;
/** Longer candidates are rejected before any comparison. */
const MAX_TOKEN_LENGTH = 4096;
/** Browsers drop cookies over 4096 bytes including name and attributes. */
const MAX_COOKIE_VALUE = 3800;
const CHALLENGE = 'Bearer realm="worker-manager"';
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9a-z-]+$/;

export function createTokenStrategy(options: TokenAuthOptions, basePath: string): StrategyHandler {
  const tokens = options.tokens ?? [];
  if (tokens.length === 0 && !options.validate) {
    throw new Error('@worker-manager/auth: the token strategy needs `tokens` or `validate`.');
  }
  if (tokens.some((token) => typeof token !== 'string' || token === '')) {
    throw new Error('@worker-manager/auth: every entry of `tokens` must be a non-empty string.');
  }

  const header = options.header?.trim().toLowerCase();
  if (header !== undefined && !HEADER_NAME.test(header)) {
    throw new Error(
      `@worker-manager/auth: ${JSON.stringify(options.header)} is not a header name.`
    );
  }
  // `Authorization` is always read, as a Bearer credential.
  const extraHeader = header === 'authorization' ? undefined : header;

  const sealer = options.cookie ? new Sealer(options.cookie.secret) : null;
  const cookieName = options.cookie?.name ?? DEFAULT_COOKIE_NAME;
  const cookiePath = basePath || '/';
  const maxAge = options.cookie?.maxAgeSeconds ?? DEFAULT_MAX_AGE;
  const loginPath = `${basePath}/auth/login`;
  const logoutPath = `${basePath}/auth/logout`;
  const home = `${basePath}/`;
  const publicOrigin = options.publicUrl ? new URL(options.publicUrl).origin : undefined;
  const sources = new WeakMap<IncomingMessage, 'header' | 'session'>();

  const identity = (): AuthUser => ({
    ...options.user,
    username: options.user?.username ?? 'token',
    roles: [...(options.user?.roles ?? [])],
  });

  const matchesStatic = (candidate: string): boolean => {
    let matched = false;
    // Every entry is compared, match or not, so which token matched is not observable.
    for (const token of tokens) {
      if (safeEqual(candidate, token)) matched = true;
    }
    return matched;
  };

  const verify = async (candidate: string): Promise<AuthUser | null> => {
    if (!candidate || candidate.length > MAX_TOKEN_LENGTH) return null;
    if (matchesStatic(candidate)) return identity();
    if (options.validate) {
      const result = await options.validate(candidate);
      if (result === true) return identity();
      if (result && typeof result === 'object') return { ...result, roles: result.roles ?? [] };
    }
    return null;
  };

  /** The tokens a request carries in headers: the custom header first, then a Bearer one. */
  const headerTokens = (req: IncomingMessage): string[] => {
    const found: string[] = [];
    if (extraHeader) {
      const value = firstHeaderValue(req, extraHeader);
      if (value) found.push(value);
    }
    const [scheme, value] = (req.headers.authorization ?? '').trim().split(/\s+/, 2);
    if (scheme?.toLowerCase() === 'bearer' && value) found.push(value);
    return found;
  };

  const expectedOrigin = (req: IncomingMessage) => publicOrigin ?? requestOrigin(req);

  const isSecure = (req: IncomingMessage) =>
    options.cookie?.secure ??
    (expectedOrigin(req).startsWith('https://') ||
      firstHeader(req, 'origin')?.startsWith('https://') === true);

  const setSessionCookie = (
    req: IncomingMessage,
    res: ServerResponse,
    value: string,
    age: number
  ) =>
    appendSetCookie(
      res,
      serializeCookie(cookieName, value, {
        path: cookiePath,
        maxAge: age,
        secure: isSecure(req),
        sameSite: 'Strict',
      })
    );

  const sessionUser = async (req: IncomingMessage, res: ServerResponse) => {
    if (!sealer) return null;
    const raw = parseCookies(req)[cookieName];
    if (!raw) return null;

    const session = sealer.unseal<TokenSession>(raw);
    const now = Math.floor(Date.now() / 1000);
    const user =
      session?.v === 1 && typeof session.t === 'string' && session.e > now
        ? await verify(session.t)
        : null;
    if (!user) setSessionCookie(req, res, '', 0);
    return user;
  };

  /**
   * The login form is only taken from a page of the board's own origin. The session cookie is
   * `SameSite=Strict` as well, so a cross-site form cannot plant or ride a session either way.
   * A scheme upgrade (the page on https, the app seeing http behind a TLS proxy) is accepted:
   * whoever controls the https origin controls the board already.
   */
  const isSameOriginPost = (req: IncomingMessage): boolean => {
    const site = firstHeader(req, 'sec-fetch-site');
    if (site && site !== 'same-origin') return false;

    const source = firstHeader(req, 'origin') ?? firstHeader(req, 'referer');
    if (!source || source === 'null') return false;
    let from: URL;
    let expected: URL;
    try {
      from = new URL(source);
      expected = new URL(expectedOrigin(req));
    } catch {
      return false;
    }
    if (from.host !== expected.host) return false;
    return from.protocol === expected.protocol || from.protocol === 'https:';
  };

  const renderLogin = (res: ServerResponse, status: number, returnTo: string, failed: boolean) =>
    sendHtml(res, status, loginPage({ action: loginPath, returnTo, failed }));

  const handleLogin = async (req: IncomingMessage, res: ServerResponse) => {
    if (!isSameOriginPost(req)) {
      forbidden(res);
      return;
    }

    let form: URLSearchParams;
    try {
      form = await readForm(req, FORM_LIMIT);
    } catch (error) {
      if (!(error instanceof BodyTooLargeError)) throw error;
      sendJson(res, 413, {
        error: { key: 'ERRORS.INVALID_REQUEST_BODY' },
        code: 'PAYLOAD_TOO_LARGE',
      });
      return;
    }

    const returnTo = safeReturnTo(form.get('returnTo'), home);
    const token = form.get('token') ?? '';
    const user = await verify(token);
    const sealed = user
      ? sealer!.seal({ v: 1, t: token, e: Math.floor(Date.now() / 1000) + maxAge })
      : undefined;
    if (!sealed || sealed.length > MAX_COOKIE_VALUE) {
      renderLogin(res, 401, returnTo, true);
      return;
    }

    setSessionCookie(req, res, sealed, maxAge);
    redirect(res, returnTo, 303);
  };

  return {
    async authenticate(req, res) {
      const candidates = headerTokens(req);
      if (candidates.length > 0) {
        for (const candidate of candidates) {
          const user = await verify(candidate);
          if (user) {
            sources.set(req, 'header');
            return user;
          }
        }
        unauthorized(res, `${CHALLENGE}, error="invalid_token"`);
        return null;
      }

      const user = await sessionUser(req, res);
      if (user) {
        sources.set(req, 'session');
        return user;
      }

      if (sealer && isNavigation(req)) {
        const target = safeReturnTo(requestTarget(req), home);
        // A SameSite=Strict cookie is withheld from a navigation that starts on another site (a
        // link in chat or mail). Reloading from a page of this origin sends it, so a signed-in
        // user lands on the board instead of the login form.
        if (firstHeader(req, 'sec-fetch-site') === 'cross-site') {
          sendHtml(res, 200, bouncePage(target));
        } else {
          redirect(res, `${loginPath}?returnTo=${encodeURIComponent(target)}`);
        }
        return null;
      }

      unauthorized(res, CHALLENGE);
      return null;
    },

    async route(req, res, path) {
      if (!sealer) return false;

      if (path === loginPath) {
        if (req.method === 'GET' || req.method === 'HEAD') {
          const returnTo = safeReturnTo(requestUrl(req).searchParams.get('returnTo'), home);
          renderLogin(res, 200, returnTo, false);
          return true;
        }
        if (req.method === 'POST') {
          await handleLogin(req, res);
          return true;
        }
        return false;
      }
      if (path === logoutPath) {
        setSessionCookie(req, res, '', 0);
        redirect(res, loginPath);
        return true;
      }

      return false;
    },

    meResponse(_user, req) {
      return { logoutUrl: sources.get(req) === 'session' ? logoutPath : null };
    },
  };
}

function firstHeaderValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() || undefined;
}

function bouncePage(target: string): string {
  const url = escapeHtml(target);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=${url}"><title>Worker Manager</title></head><body><a href="${url}">Continue to Worker Manager</a></body></html>`;
}

function loginPage({
  action,
  returnTo,
  failed,
}: {
  action: string;
  returnTo: string;
  failed: boolean;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Sign in · Worker Manager</title>
<style>
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--fg:#0f172a;--muted:#64748b;--border:#e2e8f0;--accent:#2563eb;--danger:#dc2626}
@media (prefers-color-scheme:dark){:root{--bg:#0b0f17;--card:#111827;--fg:#e5e7eb;--muted:#94a3b8;--border:#1f2937;--accent:#3b82f6;--danger:#f87171}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
form{width:100%;max-width:360px;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:28px}
h1{margin:0 0 4px;font-size:20px}
p{margin:0 0 20px;color:var(--muted)}
.error{color:var(--danger)}
label{display:block;font-weight:600;margin-bottom:6px}
input[type=password]{width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:transparent;color:inherit;font:inherit}
input[type=password]:focus{outline:2px solid var(--accent);outline-offset:1px}
button{margin-top:16px;width:100%;padding:10px 12px;border:0;border-radius:8px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
</style>
</head>
<body>
<form method="post" action="${escapeHtml(action)}">
<h1>Worker Manager</h1>
<p>Enter the access token to open the dashboard.</p>
${failed ? '<p class="error" role="alert">That token was not accepted.</p>\n' : ''}<label for="token">Access token</label>
<input id="token" name="token" type="password" autocomplete="current-password" spellcheck="false" required autofocus>
<input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}">
<button type="submit">Sign in</button>
</form>
</body>
</html>
`;
}
