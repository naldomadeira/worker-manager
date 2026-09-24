#!/usr/bin/env node
/* eslint-disable no-console -- a CLI check whose whole output is its report */
/**
 * End-to-end smoke check against a running playground (`yarn dev` or `yarn start`).
 * Reads the auth mode from /health and asserts the board behaves accordingly:
 *
 *   none      the dashboard and API answer without credentials
 *   basic     401 + WWW-Authenticate without credentials, 200 with them, /auth/me reports the user
 *   keycloak  navigations redirect to Keycloak, API answers 401 JSON, a wm-admin bearer token
 *             gets through, a user without the role gets 403
 *
 * Also checks that both a Redis and (when configured) a PostgreSQL queue are listed.
 */
const BASE = process.env.PLAYGROUND_URL ?? 'http://localhost:3100';
const KC = process.env.KEYCLOAK_URL ?? 'http://localhost:8090';
const REALM = process.env.KEYCLOAK_REALM ?? 'worker-manager';
const CLIENT = process.env.KEYCLOAK_CLIENT_ID ?? 'worker-manager-board';
const SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? 'playground-secret';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✔' : '✖'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};

const get = (path, headers = {}) => fetch(BASE + path, { headers, redirect: 'manual' });

async function token(username, password) {
  const res = await fetch(`${KC}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'password', client_id: CLIENT, client_secret: SECRET, username, password }),
  });
  if (!res.ok) throw new Error(`token for ${username}: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

function checkQueues(body) {
  const names = (body.queues ?? []).map((q) => q.name);
  check('lists Redis queues', names.includes('payments.charge'), `${names.length} queues`);
  const pg = (body.queues ?? []).filter((q) => q.name.startsWith('pg.'));
  check('lists PostgreSQL queues (skip if POSTGRES_URL empty)', pg.length > 0 || process.env.POSTGRES_URL === '', pg.map((q) => q.name).join(', '));
}

const health = await (await fetch(`${BASE}/health`)).json();
console.log(`Playground at ${BASE}, auth mode: ${health.auth}\n`);

if (health.auth === 'none') {
  check('dashboard HTML is public', (await get('/queues', { accept: 'text/html' })).status === 200);
  const res = await get('/queues/api/queues');
  check('API is public', res.status === 200);
  checkQueues(await res.json());
}

if (health.auth === 'basic') {
  const user = process.env.WM_BASIC_USER ?? 'admin';
  const pass = process.env.WM_BASIC_PASSWORD ?? 'admin';
  const auth = { authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') };

  const anon = await get('/queues/api/queues');
  check('401 without credentials', anon.status === 401, String(anon.status));
  check('asks for Basic credentials', /^Basic/i.test(anon.headers.get('www-authenticate') ?? ''));
  const bad = await get('/queues/api/queues', { authorization: 'Basic ' + Buffer.from('admin:nope').toString('base64') });
  check('401 with a wrong password', bad.status === 401, String(bad.status));
  const ok = await get('/queues/api/queues', auth);
  check('200 with credentials', ok.status === 200, String(ok.status));
  checkQueues(await ok.json());
  const me = await get('/queues/auth/me', auth);
  const meBody = me.ok ? await me.json() : {};
  check('/auth/me reports the basic user', me.status === 200 && meBody.user?.username === user, JSON.stringify(meBody.user ?? {}));
  check('dashboard HTML with credentials', (await get('/queues', { ...auth, accept: 'text/html' })).status === 200);
}

if (health.auth === 'keycloak') {
  const nav = await get('/queues', { accept: 'text/html' });
  const location = nav.headers.get('location') ?? '';
  check('navigation redirects to Keycloak', nav.status === 302 && location.startsWith(`${KC}/realms/${REALM}/`), `${nav.status} ${location.slice(0, 80)}`);
  check('login uses PKCE S256', location.includes('code_challenge_method=S256'));

  const anon = await get('/queues/api/queues', { accept: 'application/json' });
  const anonBody = await anon.json().catch(() => ({}));
  check('API 401 JSON without a session', anon.status === 401 && anonBody.error?.key === 'ERRORS.UNAUTHORIZED', String(anon.status));

  const admin = await get('/queues/api/queues', { authorization: `Bearer ${await token('admin', 'admin')}` });
  check('wm-admin bearer token gets through', admin.status === 200, String(admin.status));
  if (admin.ok) checkQueues(await admin.json());

  const viewer = await get('/queues/api/queues', { authorization: `Bearer ${await token('viewer', 'viewer')}` });
  const viewerBody = await viewer.json().catch(() => ({}));
  check('user without the role gets 403', viewer.status === 403 && viewerBody.error?.key === 'ERRORS.FORBIDDEN', String(viewer.status));

  const me = await get('/queues/auth/me', { authorization: `Bearer ${await token('admin', 'admin')}` });
  const meBody = me.ok ? await me.json() : {};
  check('/auth/me reports the Keycloak user', meBody.user?.username === 'admin' && meBody.strategy === 'keycloak', JSON.stringify(meBody.user ?? {}));
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
