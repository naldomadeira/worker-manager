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
 * Also checks that both a Redis and (when configured) a PostgreSQL queue are listed, and, when
 * /health reports `pgBoss: true`, the second board at /pg-boss under the same auth mode: its
 * entry page, the pg-boss queues, `info.writable`, and a send -> cancel -> resume -> delete cycle.
 * With WM_READONLY=true on the app, the pg-boss mutations must answer 404 (routes not registered).
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

const PGBOSS_QUEUES = ['mail.send', 'reports.nightly', 'billing.sync', 'payments.capture'];
const PGBOSS_DLQ = 'payments.dead-letter';

/** Headers that get a request past the board's auth, per mode. */
async function credentials(mode) {
  if (mode === 'basic') {
    const user = process.env.WM_BASIC_USER ?? 'admin';
    const pass = process.env.WM_BASIC_PASSWORD ?? 'admin';
    return { authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') };
  }
  if (mode === 'keycloak') return { authorization: `Bearer ${await token('admin', 'admin')}` };
  return {};
}

async function call(method, path, headers, body) {
  const init = { method, redirect: 'manual', headers: { ...headers } };
  if (body) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, init);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function checkPgBoss(health) {
  const auth = await credentials(health.auth);
  const api = '/pg-boss/api/pg-boss';

  if (health.auth === 'basic') {
    const anon = await get('/pg-boss', { accept: 'text/html' });
    check('pg-boss: 401 without credentials', anon.status === 401, String(anon.status));
  }
  if (health.auth === 'keycloak') {
    const nav = await get('/pg-boss', { accept: 'text/html' });
    const location = nav.headers.get('location') ?? '';
    check('pg-boss: navigation redirects to Keycloak', nav.status === 302 && location.startsWith(`${KC}/realms/${REALM}/`), `${nav.status} ${location.slice(0, 60)}`);
    const anon = await get(`${api}/queues`, { accept: 'application/json' });
    check('pg-boss: API 401 without a session', anon.status === 401, String(anon.status));
  }

  const entry = await get('/pg-boss', { ...auth, accept: 'text/html' });
  const html = entry.status === 200 ? await entry.text() : '';
  check('pg-boss: entry HTML', entry.status === 200 && html.includes('"engine":"pg-boss"'), String(entry.status));
  check('pg-boss: links to the BullMQ board', html.includes('BullMQ board'));
  const bullmq = await get('/queues', { ...auth, accept: 'text/html' });
  check('BullMQ board links to the pg-boss board', (await bullmq.text()).includes('pg-boss board'));

  const queues = await call('GET', `${api}/queues`, auth);
  const names = (queues.body.queues ?? []).map((q) => q.name);
  check('pg-boss: lists the 4 queues', PGBOSS_QUEUES.every((name) => names.includes(name)), names.join(', '));
  const policies = Object.fromEntries((queues.body.queues ?? []).map((q) => [q.name, q.policy]));
  check('pg-boss: standard, singleton and stately policies', policies['mail.send'] === 'standard' && policies['reports.nightly'] === 'singleton' && policies['billing.sync'] === 'stately', JSON.stringify(policies));
  const capture = (queues.body.queues ?? []).find((q) => q.name === 'payments.capture');
  check('pg-boss: payments.capture dead-letters into its DLQ', capture?.deadLetter === PGBOSS_DLQ && names.includes(PGBOSS_DLQ), String(capture?.deadLetter));

  const info = await call('GET', `${api}/info`, auth);
  if (health.readOnly) {
    check('pg-boss: info reports read-only', info.status === 200 && info.body.readOnly === true && info.body.writable === false, JSON.stringify({ readOnly: info.body.readOnly, writable: info.body.writable }));
  } else {
    check('pg-boss: info reports writable', info.status === 200 && info.body.writable === true, JSON.stringify({ status: info.status, writable: info.body.writable, schemaVersion: info.body.schemaVersion }));
  }

  const schedules = await call('GET', `${api}/schedules`, auth);
  const kinds = (schedules.body.schedules ?? []).map((s) => s.kind).sort();
  check('pg-boss: a cron and an rrule schedule', kinds.includes('cron') && kinds.includes('rrule'), kinds.join(', '));

  const jobs = `${api}/queues/mail.send/jobs`;
  if (health.readOnly) {
    const send = await call('POST', jobs, auth, { data: { smoke: true } });
    check('pg-boss read-only: send answers 404', send.status === 404, String(send.status));
    const cancel = await call('PUT', `${jobs}/00000000-0000-4000-8000-000000000000/cancel`, auth);
    check('pg-boss read-only: cancel answers 404', cancel.status === 404, String(cancel.status));
    return;
  }

  // Deferred an hour, so the playground's own worker cannot pick it up mid-cycle.
  const sent = await call('POST', jobs, auth, { data: { smoke: true }, options: { startAfter: 3600 } });
  const id = sent.body.id;
  check('pg-boss: send', sent.status === 200 && typeof id === 'string', `${sent.status} ${id}`);
  if (!id) return;
  const state = async () => (await call('GET', `${jobs}/${id}`, auth)).body.job?.state;

  const cancel = await call('PUT', `${jobs}/${id}/cancel`, auth);
  check('pg-boss: cancel', cancel.status === 200 && cancel.body.affected === 1 && (await state()) === 'cancelled', `${cancel.status} ${JSON.stringify(cancel.body)}`);
  const resume = await call('PUT', `${jobs}/${id}/resume`, auth);
  check('pg-boss: resume', resume.status === 200 && resume.body.affected === 1 && (await state()) === 'created', `${resume.status} ${JSON.stringify(resume.body)}`);
  const remove = await call('PUT', `${jobs}/${id}/remove`, auth);
  const gone = await call('GET', `${jobs}/${id}`, auth);
  check('pg-boss: delete', remove.status === 200 && remove.body.affected === 1 && gone.status === 404, `${remove.status} then ${gone.status}`);
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

if (health.pgBoss) {
  console.log('\npg-boss board at /pg-boss');
  await checkPgBoss(health);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
