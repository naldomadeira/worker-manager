# Token auth

The `token` strategy of `@worker-manager/auth` protects the dashboard with one or more static
tokens, with no usernames and no identity provider. Scripts send the token in a header; a browser
types it once into a small login form and gets an encrypted session cookie. It suits internal
boards where a Keycloak realm is overkill and a shared Basic password is not wanted in the
browser's credential cache.

```sh
npm install @worker-manager/auth
```

## Options

| Option | Default | Description |
|---|---|---|
| `tokens` | | Accepted tokens. Compared in constant time against every entry on every request. |
| `validate(token)` | | Tried when no static token matched. Return an `AuthUser`, `true` (accept as `user`) or `false`. Runs on every request, so revoking a token ends its browser sessions at once. |
| `header` | | A header carrying the bare token, e.g. `X-Board-Token`. `Authorization: Bearer <token>` is always accepted too. |
| `user` | `{ username: 'token', roles: [] }` | The identity attached to `req.user` and shown in the header. |
| `cookie` | | `{ secret, name?, secure?, maxAgeSeconds? }`. Turns on the browser login form. Without it only requests carrying the token in a header get in. |
| `publicUrl` | request origin | External URL of the board. Set it when a proxy rewrites `Host`, so the login form's origin check compares against the right host. |
| `onAuthenticated(user, req)` | | Return `false` to answer `403`, as for the other strategies. |

Use long random tokens (32 characters or more): there is no lockout, so the token's entropy is the
only defence against guessing. `openssl rand -base64 32` is plenty.

## NestJS

```ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WorkerManagerModule } from '@worker-manager/nestjs';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';

@Module({
  imports: [
    WorkerManagerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        route: '/admin/queues',
        auth: {
          strategy: 'token',
          tokens: [config.getOrThrow('BOARD_TOKEN')],
          header: 'X-Board-Token',
          cookie: { secret: config.getOrThrow('BOARD_SESSION_SECRET') },
        },
      }),
    }),
    WorkerManagerModule.forFeature({ name: 'emails', adapter: BullMQAdapter }),
  ],
})
export class AppModule {}
```

## Express

```ts
import { createAuthMiddleware } from '@worker-manager/auth';

const auth = createAuthMiddleware(
  {
    strategy: 'token',
    tokens: [process.env.BOARD_TOKEN!],
    cookie: { secret: process.env.BOARD_SESSION_SECRET! },
  },
  { basePath: '/queues' }
);

app.use('/queues', auth, serverAdapter.getRouter());
```

## Fastify

```ts
import { createAuthMiddleware, createFastifyAuthPlugin } from '@worker-manager/auth';

const auth = createAuthMiddleware(tokenOptions, { basePath: '/queues' });
app.register(createFastifyAuthPlugin(serverAdapter.registerPlugin(), auth), { prefix: '/queues' });
```

The plugin registers the `POST /auth/login` route the form needs inside the board's own scope.

## CLI and Docker

```sh
worker-manager --token "$BOARD_TOKEN" --token-header X-Board-Token \
  --session-secret "$BOARD_SESSION_SECRET" --host 0.0.0.0
```

`--token` takes a comma separated list. The environment variables are `WORKER_MANAGER_TOKENS`,
`WORKER_MANAGER_TOKEN_HEADER` and `WORKER_MANAGER_SESSION_SECRET`, and a config file takes
`token: { tokens, header, user, cookie }`. Without a session secret the CLI encrypts sessions with
a random per-process key, so they end on restart.

## What happens to a request

| Request | Answer |
|---|---|
| `Authorization: Bearer <token>` or the `header` | Checked against `tokens`, then `validate`. A wrong token gets `401` with `WWW-Authenticate: Bearer realm="worker-manager", error="invalid_token"`. |
| Valid session cookie | Let through; the token inside is checked again, so a removed token no longer gets in. |
| Page load without credentials (`cookie` set) | `302` to `${basePath}/auth/login?returnTo=<the page>`. |
| API call, XHR or asset without credentials | `401` JSON with `{ "error": { "key": "ERRORS.UNAUTHORIZED" } }`, never a redirect. |
| `onAuthenticated` returned `false` | `403` with `{ "error": { "key": "ERRORS.FORBIDDEN" } }`. |

The middleware also serves, under the board's base path, when `cookie` is set:

- `GET /auth/login` renders the form: one password field, no scripts, no external assets, a strict
  `Content-Security-Policy` and `X-Frame-Options: DENY`.
- `POST /auth/login` checks the token and, on success, sets the session cookie and answers `303`
  to `returnTo` (same-origin paths only). A wrong token re-renders the form with `401`; the token is
  never echoed back.
- `GET /auth/logout` clears the cookie and returns to the form.
- `GET /auth/me` returns `{ strategy: 'token', user, logoutUrl }`, as for the other strategies.

## Security notes

- **The session cookie** (`wm_session` by default, `wm_session_<name>` for a named NestJS board) is
  `HttpOnly`, `SameSite=Strict`, scoped to the base path, `Secure` on https, and sealed with
  AES-256-GCM under `cookie.secret`. It carries the token and an expiry; nothing in it is readable
  client side, and a tampered or foreign cookie is cleared.
- **CSRF on the login form**: the `POST` is only accepted when `Origin` (or, without it, `Referer`)
  is the board's own origin, and a `Sec-Fetch-Site` other than `same-origin` is refused, so another
  site cannot log a browser into a session of its choosing. Together with `SameSite=Strict`, no
  cross-site request carries the session either.
- **Links from other sites**: a `SameSite=Strict` cookie is withheld from a navigation that starts
  on another site, such as a link in chat. Such a page load gets a tiny page that reloads itself
  from the board's origin, which does carry the cookie, so a signed-in user is not asked again.
- **No secrets in logs**: the middleware logs nothing, and neither tokens nor the session secret
  appear in any response.

Rate-limit `POST ${basePath}/auth/login` at your proxy if the board is reachable from the internet.
