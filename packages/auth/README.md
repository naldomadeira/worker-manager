# <img alt="Worker Manager" src="https://raw.githubusercontent.com/naldomadeira/worker-manager/main/packages/ui/src/static/images/logo.svg" width="35px" /> @worker-manager/auth

Authentication for the Worker Manager dashboard: HTTP Basic or Keycloak (OpenID Connect), as
one framework-agnostic middleware.

It works on Node's `IncomingMessage` / `ServerResponse`, so the same middleware runs in front of
Express, Koa (through `koa-connect`), NestJS, plain `http`, and Fastify (through a hook helper).

```sh
npm install @worker-manager/auth
```

## Usage

```ts
import { createAuthMiddleware } from '@worker-manager/auth';

const auth = createAuthMiddleware(options, { basePath: '/queues' });

// Express
app.use('/queues', auth, serverAdapter.getRouter());
```

`basePath` is where the board is mounted. The middleware serves its own endpoints under it and
matches them against the full request path, so mounting it at the root or under the base path
both work.

Every request the middleware sees must be authenticated: the page, the API and the static assets.
On success the user is attached to `req.user`:

```ts
interface AuthUser {
  username: string;
  name?: string;
  email?: string;
  roles: string[];
}
```

### Basic

```ts
createAuthMiddleware(
  {
    strategy: 'basic',
    users: [{ username: 'admin', password: process.env.BOARD_PASSWORD!, roles: ['admin'] }],
    // Optional: checked when no static user matches.
    validate: async (username, password) => lookupUser(username, password), // AuthUser | boolean
    realm: 'ops', // WWW-Authenticate realm, default "worker-manager"
  },
  { basePath: '/queues' }
);
```

Credentials are compared in constant time: both sides are SHA-256 hashed and compared with
`crypto.timingSafeEqual`, and every configured user is checked on every request. A failure
answers `401` with `WWW-Authenticate: Basic realm="..."`.

### Keycloak

```ts
createAuthMiddleware(
  {
    strategy: 'keycloak',
    url: 'https://sso.example.com', // add /auth for Keycloak older than 17
    realm: 'ops',
    clientId: 'worker-manager',
    clientSecret: process.env.KEYCLOAK_CLIENT_SECRET, // confidential clients
    publicUrl: 'https://ops.example.com/queues', // optional, see below
    requiredRoles: ['wm-admin'], // realm roles or client roles, any one grants access
    cookie: { secret: process.env.SESSION_SECRET! },
  },
  { basePath: '/queues' }
);
```

| Option | Default | |
|---|---|---|
| `url`, `realm`, `clientId` | required | Issuer is `${url}/realms/${realm}`. Discovery (`/.well-known/openid-configuration`) is fetched once and cached. |
| `clientSecret` | | Sent to the token endpoint for confidential clients. |
| `publicUrl` | request origin + `basePath` | External URL of the board, base path included. The redirect URI is `${publicUrl}/auth/callback`. Without it the origin is derived from `Host` / `X-Forwarded-Proto` / `X-Forwarded-Host`. |
| `requiredRoles` | none | Matched against `realm_access.roles` and `resource_access[clientId].roles`. |
| `scope` | `openid profile email` | |
| `cookie.secret` | `clientSecret`, else a random per-process key | Key for the AES-256-GCM encrypted session cookie. Set it explicitly when running several instances. |
| `cookie.name` | `wm_session` | |
| `cookie.secure` | `true` when the board is on https | |
| `cookie.maxAgeSeconds` | 8 hours | |
| `bearerOnly` | `false` | Accept only bearer tokens, never start a browser login. |
| `audience` | `clientId` | Accepted `aud` (or `azp`) values for bearer tokens. |
| `clockToleranceSeconds` | 30 | |

How a request is handled:

- `Authorization: Bearer <jwt>` is verified against the realm JWKS (signature, issuer, expiry,
  and `aud` or `azp` matching the client).
- Otherwise the session cookie is read. When its access has expired it is refreshed silently
  with the refresh token; if that fails, a new login is needed.
- A browser navigation (a `GET` accepting `text/html`) without a session is redirected into the
  authorization code flow with PKCE (S256), `state` and `nonce`.
- Anything else without credentials (API calls, XHR, assets) gets `401` with
  `{ "error": { "key": "ERRORS.UNAUTHORIZED" } }`.
- An authenticated user without one of `requiredRoles` gets `403` with
  `{ "error": { "key": "ERRORS.FORBIDDEN" } }`.

The session cookie is `HttpOnly`, `SameSite=Lax`, scoped to `basePath`, and encrypted, so neither
the claims nor the refresh token are readable client side. When the tokens do not fit in a 4 KB
cookie, the ID token and then the refresh token are dropped.

In Keycloak, register `${publicUrl}/auth/callback` as a valid redirect URI and `${publicUrl}/` as a
valid post logout redirect URI, and enable PKCE (S256) on the client.

## Endpoints

Served under `basePath` by both strategies:

| Endpoint | |
|---|---|
| `GET /auth/me` | `200 { strategy, user: { username, name?, email?, roles }, logoutUrl }`, or `401`. `logoutUrl` is `null` for Basic and bearer tokens. |
| `GET /auth/login` | Keycloak: starts the login flow. `?returnTo=/queues/...` (same origin only). |
| `GET /auth/callback` | Keycloak: the OIDC redirect URI. |
| `GET /auth/logout` | Keycloak: clears the session and redirects to the end-session endpoint with `post_logout_redirect_uri` and `id_token_hint`. Basic: answers a fresh `401` challenge so the browser forgets the credentials. |

## Hooks

```ts
createAuthMiddleware({
  strategy: 'keycloak',
  // ...
  onAuthenticated: async (user, req) => {
    audit.log(user.username, req.url);
    return user.email?.endsWith('@example.com'); // false answers 403
  },
});
```

## Frameworks

### Express

```ts
app.use('/queues', createAuthMiddleware(options, { basePath: '/queues' }), serverAdapter.getRouter());
```

### Fastify

```ts
import { createAuthMiddleware, createFastifyAuthPlugin } from '@worker-manager/auth';

const auth = createAuthMiddleware(options, { basePath: '/queues' });
app.register(createFastifyAuthPlugin(serverAdapter.registerPlugin(), auth), { prefix: '/queues' });
```

The hook is encapsulated with the board's routes, so the rest of the app is untouched.
`createFastifyAuthHook(auth)` gives you the bare `onRequest` hook if you would rather wire it
yourself.

### Koa

```ts
import c2k from 'koa-connect';

app.use(c2k(createAuthMiddleware(options, { basePath: '/queues' })));
```

### NestJS

`@worker-manager/nestjs` takes the same options as `auth` and wires the middleware for you, on
Express and Fastify alike.

### Anything else

`middleware.handle(req, res)` is the promise-based core: it resolves `true` when the request may
continue (with `req.user` set) and `false` when the middleware already answered it.

For more info visit the main [README](https://github.com/naldomadeira/worker-manager#readme)
