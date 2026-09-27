# Authentication reference

Source of truth: recipes [basic-auth](https://naldomadeira.github.io/worker-manager/recipes/basic-auth),
[keycloak-auth](https://naldomadeira.github.io/worker-manager/recipes/keycloak-auth),
[token-auth](https://naldomadeira.github.io/worker-manager/recipes/token-auth),
[custom-auth](https://naldomadeira.github.io/worker-manager/recipes/custom-auth).

`@worker-manager/auth` is one framework-agnostic middleware over Node's `IncomingMessage` /
`ServerResponse`. The NestJS module (`auth` option) and the CLI wire it for you; elsewhere call
`createAuthMiddleware(options, { basePath })` with the board's base path. Every request under the
board (page, API, assets) must pass it. On success `req.user` is
`{ username, name?, email?, roles }` (`getAuthUser(req)` reads it).

## Strategies

### `basic`

```ts
{
  strategy: 'basic',
  users: [{ username: 'ops', password: process.env.BOARD_PASSWORD!, roles: ['admin'] }],
  validate: async (username, password) => lookupUser(username, password), // optional: AuthUser | boolean
  realm: 'ops', // WWW-Authenticate realm, default "worker-manager"
}
```

Constant-time comparison; failures get `401` with a `WWW-Authenticate: Basic` challenge.

### `keycloak` (OIDC, PKCE)

```ts
{
  strategy: 'keycloak',
  url: 'https://sso.example.com', // append /auth for Keycloak < 17
  realm: 'ops',
  clientId: 'worker-manager',
  clientSecret: process.env.KEYCLOAK_CLIENT_SECRET, // confidential clients
  publicUrl: 'https://ops.example.com/queues', // external URL incl. base path; optional
  requiredRoles: ['wm-admin'], // realm or client roles, any one grants access
  cookie: { secret: process.env.BOARD_SESSION_SECRET! }, // 32+ random chars; set it on multi-instance deploys
}
```

Other options: `scope` (`openid profile email`), `bearerOnly` (API only, no browser login),
`audience` (defaults to `clientId`), `clockToleranceSeconds` (30), `cookie.name` (`wm_session`),
`cookie.secure`, `cookie.maxAgeSeconds` (8 h). Browsers get the authorization code flow with PKCE
and an AES-GCM encrypted `HttpOnly` cookie with silent refresh; API clients may send
`Authorization: Bearer <access token>`. Missing role: `403` `ERRORS.FORBIDDEN`.

Keycloak client settings: standard flow on; valid redirect URI `<publicUrl>/auth/callback`; valid
post logout redirect URI `<publicUrl>/`; PKCE method `S256`; client authentication on for a
confidential client. Behind a proxy, set `publicUrl` or forward `X-Forwarded-Proto`/`X-Forwarded-Host`.

### `token`

```ts
{
  strategy: 'token',
  tokens: [process.env.BOARD_TOKEN!], // long random values, constant-time compared
  validate: async (token) => lookupToken(token), // optional: AuthUser | boolean, checked every request
  header: 'X-Board-Token', // optional; Authorization: Bearer <token> is always read
  user: { username: 'ops-board', roles: ['ops'] }, // identity attached for static tokens
  cookie: { secret: process.env.BOARD_SESSION_SECRET! }, // enables the browser login form
  publicUrl: 'https://ops.example.com/queues', // when a proxy rewrites Host
}
```

With `cookie`, a page load without credentials goes to `<basePath>/auth/login`, a form that trades
the token for a `SameSite=Strict` sealed session cookie. API/XHR without credentials always get
`401` JSON. Best fit for boards an AI agent or script calls over the HTTP API.

### `custom`

```ts
{
  strategy: 'custom',
  authenticate: async (req) => verifyApiKey(req.headers['x-api-key']), // AuthUser | null (401); throw = error
  onUnauthenticated: (req, res) => { res.statusCode = 302; res.setHeader('Location', '/login'); res.end(); }, // optional
  logoutUrl: '/cdn-cgi/access/logout', // optional "Sign out" target
}
```

### Common to all

`onAuthenticated: (user, req) => boolean | void` runs after the check; returning `false` answers
`403`. Endpoints under the base path: `GET /auth/me` (all), `GET /auth/login`, `POST /auth/login`
(token), `GET /auth/callback` (keycloak), `GET /auth/logout`.

## Wiring per framework

```ts
// Express
app.use('/queues', createAuthMiddleware(options, { basePath: '/queues' }), serverAdapter.getRouter());

// Fastify: the hook is scoped to the board plugin only
import { createAuthMiddleware, createFastifyAuthPlugin } from '@worker-manager/auth';
const auth = createAuthMiddleware(options, { basePath: '/queues' });
app.register(createFastifyAuthPlugin(serverAdapter.registerPlugin(), auth), { prefix: '/queues' });

// Koa
import c2k from 'koa-connect';
app.use(c2k(createAuthMiddleware(options, { basePath: '/queues' })));

// Anything else: promise-based core, true = continue, false = already answered
const proceed = await auth.handle(req, res);

// NestJS: WorkerManagerModule.forRoot({ route: '/queues', auth: options })
// CLI: --user/--password, --keycloak-*, --token (see cli-docker.md)
```

The app already has login middleware (passport, session, JWT guard)? Mounting the board behind it
is equally valid: `app.use('/queues', requireAdmin, serverAdapter.getRouter())`. NestJS also takes
extra middleware through the `middleware` option.

## Finer-grained access

- **Read-only**: `readOnlyMode: true` per queue adapter (writes answer 405), NestJS `readOnly: true`,
  pg-boss `options.readOnly: true` (mutation routes not registered, 404).
- **Visibility guard**: `queueAdapter.setVisibilityGuard((request) => boolean)` hides queues per
  request (pg-boss: `pgBoss.visibilityGuard(request, queueName)`).
- **Access-control hooks**: `options.handlerHooks.before: ({ method, route, request }) => ...`
  returning `{ allow: false }` answers 403, e.g. allow `get` for everyone and writes for admins only.
- **CSRF**: when the board shares an origin with untrusted sessions, see the
  [CSRF recipe](https://naldomadeira.github.io/worker-manager/recipes/csrf-protection).
