import type { IncomingMessage, ServerResponse } from 'node:http';

export function normalizeBasePath(basePath: string | undefined): string {
  const trimmed = (basePath ?? '').trim().replace(/\/+$/, '');
  if (trimmed === '') return '';

  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/**
 * Express strips a mount path from `req.url` and keeps the full one in `originalUrl`, so the
 * middleware reads that first. It matches its own endpoints against the full path whether it
 * was mounted at the root, under the base path, or in front of a Fastify plugin.
 */
export function requestUrl(req: IncomingMessage): URL {
  const raw = (req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url ?? '/';

  return new URL(raw, 'http://internal.invalid');
}

/** The request's path plus query, used as the post-login return target. */
export function requestTarget(req: IncomingMessage): string {
  const url = requestUrl(req);

  return `${url.pathname}${url.search}`;
}

function firstHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  const first = Array.isArray(value) ? value[0] : value;

  return first?.split(',')[0]?.trim() || undefined;
}

/** `scheme://host` as the client sees it, honouring a reverse proxy's forwarding headers. */
export function requestOrigin(req: IncomingMessage): string {
  const encrypted = Boolean((req.socket as { encrypted?: boolean } | undefined)?.encrypted);
  const proto = firstHeader(req, 'x-forwarded-proto') ?? (encrypted ? 'https' : 'http');
  const host = firstHeader(req, 'x-forwarded-host') ?? firstHeader(req, 'host') ?? 'localhost';

  return `${proto}://${host}`;
}

/**
 * A top-level browser navigation, the only kind of request worth answering with a redirect to
 * the identity provider. Everything else (XHR, fetch, static assets) gets a 401 it can handle.
 */
export function isNavigation(req: IncomingMessage): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  // Browsers mark a page load as a document destination; fetch()/XHR and subresources carry
  // another one. Sec-Fetch-Mode is not used because server-side fetch clients set it to "cors".
  const dest = firstHeader(req, 'sec-fetch-dest');
  if (dest && dest !== 'document' && dest !== 'iframe') return false;

  const accept = String(req.headers.accept ?? '');

  return accept.includes('text/html');
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', Buffer.byteLength(payload));
  res.end(payload);
}

export function redirect(res: ServerResponse, location: string): void {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

export function unauthorized(res: ServerResponse, challenge: string): void {
  res.setHeader('WWW-Authenticate', challenge);
  sendJson(res, 401, { error: { key: 'ERRORS.UNAUTHORIZED' }, code: 'UNAUTHORIZED' });
}

export function forbidden(res: ServerResponse): void {
  sendJson(res, 403, { error: { key: 'ERRORS.FORBIDDEN' }, code: 'FORBIDDEN' });
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  const cookies: Record<string, string> = {};
  if (!header) return cookies;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name || name in cookies) continue;
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }

  return cookies;
}

export interface CookieAttributes {
  path: string;
  maxAge?: number;
  secure: boolean;
  httpOnly?: boolean;
}

export function serializeCookie(name: string, value: string, attrs: CookieAttributes): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${attrs.path}`, 'SameSite=Lax'];
  if (attrs.httpOnly !== false) parts.push('HttpOnly');
  if (attrs.secure) parts.push('Secure');
  if (attrs.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(attrs.maxAge))}`);
    if (attrs.maxAge <= 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  }

  return parts.join('; ');
}

export function appendSetCookie(res: ServerResponse, cookie: string): void {
  const existing = res.getHeader('Set-Cookie');
  const list =
    existing === undefined ? [] : Array.isArray(existing) ? existing : [String(existing)];
  res.setHeader('Set-Cookie', [...list, cookie]);
}

/** A same-origin relative path, so a crafted `returnTo` cannot bounce the user elsewhere. */
export function safeReturnTo(value: string | null | undefined, fallback: string): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return fallback;
  }

  return value;
}
