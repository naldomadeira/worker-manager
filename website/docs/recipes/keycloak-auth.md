# Keycloak auth

`@worker-manager/auth` puts a Keycloak (OpenID Connect) login in front of the dashboard. Browsers
go through the authorization code flow with PKCE and keep an encrypted session cookie; scripts and
other services send a bearer token. It is one framework-agnostic middleware, so the same options
work on Express, Fastify, Koa, NestJS and the [CLI](/guide/cli#keycloak-auth).

```sh
npm install @worker-manager/auth
```

## Configure the Keycloak client

In your realm, create an OpenID Connect client (say `worker-manager`) with:

- **Client authentication** on (a confidential client), or off for a public client without a secret.
- **Standard flow** enabled. Enable **Direct access grants** only if scripts log in with a password.
- **Valid redirect URIs**: `https://ops.example.com/queues/auth/callback`
- **Valid post logout redirect URIs**: `https://ops.example.com/queues/`
- **Advanced → Proof Key for Code Exchange Code Challenge Method**: `S256`

Then create a realm role (say `wm-admin`) and assign it to the people who should see the board.
Client roles on the `worker-manager` client work too.

## Express

```ts
import express from 'express';
import { createBullBoard } from '@worker-manager/api';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { ExpressAdapter } from '@worker-manager/express';
import { createAuthMiddleware } from '@worker-manager/auth';

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/queues');
createBullBoard({ queues: [new BullMQAdapter(emails)], serverAdapter });

const auth = createAuthMiddleware(
  {
    strategy: 'keycloak',
    url: 'https://sso.example.com', // append /auth for Keycloak older than 17
    realm: 'ops',
    clientId: 'worker-manager',
    clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
    publicUrl: 'https://ops.example.com/queues',
    requiredRoles: ['wm-admin'],
    cookie: { secret: process.env.SESSION_SECRET! },
  },
  { basePath: '/queues' }
);

const app = express();
app.use('/queues', auth, serverAdapter.getRouter());
```

## Fastify

```ts
import { createAuthMiddleware, createFastifyAuthPlugin } from '@worker-manager/auth';

const serverAdapter = new FastifyAdapter();
serverAdapter.setBasePath('/queues');
createBullBoard({ queues: [new BullMQAdapter(emails)], serverAdapter });

const auth = createAuthMiddleware(keycloakOptions, { basePath: '/queues' });
app.register(createFastifyAuthPlugin(serverAdapter.registerPlugin(), auth), { prefix: '/queues' });
```

The hook lives in the board plugin's own scope, so it guards the board's page, API and assets and
nothing else in your app.

## NestJS

Pass the same options as `auth`, typically from `ConfigService`:

```ts
BullBoardModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    auth: {
      strategy: 'keycloak',
      url: config.getOrThrow('KEYCLOAK_URL'),
      realm: config.getOrThrow('KEYCLOAK_REALM'),
      clientId: config.getOrThrow('KEYCLOAK_CLIENT_ID'),
      clientSecret: config.get('KEYCLOAK_CLIENT_SECRET'),
      requiredRoles: ['wm-admin'],
      cookie: { secret: config.getOrThrow('SESSION_SECRET') },
    },
  }),
});
```

See [NestJS](/server-adapters/nestjs#authentication) for the rest of the module options.

## What happens to a request

| Request | Answer |
|---|---|
| `Authorization: Bearer <jwt>` | Verified against the realm JWKS: signature, issuer `${url}/realms/${realm}`, expiry, and `aud` or `azp` equal to `clientId`. |
| Valid session cookie | Let through. An expired session is refreshed silently with the refresh token. |
| Browser navigation without a session | `302` to the Keycloak login page, then back to the page it started on. |
| API call, XHR or asset without credentials | `401` with `{ "error": { "key": "ERRORS.UNAUTHORIZED" } }`. |
| Signed in, but without one of `requiredRoles` | `403` with `{ "error": { "key": "ERRORS.FORBIDDEN" } }`. |

The middleware also serves, under the board's base path:

- `GET /auth/me` returns `{ strategy, user: { username, name, email, roles }, logoutUrl }`. The UI
  uses it to show who is signed in.
- `GET /auth/login?returnTo=/queues/...` starts a login explicitly.
- `GET /auth/callback` is the redirect URI.
- `GET /auth/logout` clears the session and sends the browser to Keycloak's end-session endpoint.

## The session cookie

The cookie (`wm_session` by default) is `HttpOnly`, `SameSite=Lax`, scoped to the base path,
`Secure` when the board is on https, and encrypted with AES-256-GCM using `cookie.secret`. It holds
the user's claims, the access expiry and, when they fit in the 4 KB cookie limit, the refresh
token and the ID token (used as the logout hint).

Set `cookie.secret` to a long random value and share it across instances. Without it the
middleware falls back to `clientSecret`, and failing that to a random per-process key, which logs
everyone out on every restart.

## Behind a reverse proxy

The redirect URI must match what Keycloak has registered. Set `publicUrl` to the board's external
URL, base path included. Without it, the URL is built from the request's `X-Forwarded-Proto`,
`X-Forwarded-Host` (or `Host`) and the base path, so make sure your proxy sends those.

## API clients only

`bearerOnly: true` disables the browser flow: every request without a valid bearer token gets a
`401`, and `/auth/login`, `/auth/callback` and `/auth/logout` are not served. No cookie secret is
needed.

## Extra checks

`onAuthenticated(user, req)` runs after the role check. Return `false` to answer `403`, for rules
the options cannot express:

```ts
createAuthMiddleware({
  strategy: 'keycloak',
  // ...
  onAuthenticated: (user) => user.email?.endsWith('@example.com'),
});
```

## Combine with read-only mode

Give viewers a board they cannot break: run a second, [read-only](/recipes/read-only-mode) board
for a wider role, and keep `requiredRoles: ['wm-admin']` on the writable one.
