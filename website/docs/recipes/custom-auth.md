# Custom auth

The `custom` strategy of `@worker-manager/auth` hands the decision to your code: validate a
Cloudflare Access JWT, reuse your app's API-key check, trust a header set by an authenticating
proxy. The rest of the middleware behaves as for the built-in strategies: `req.user` is set, the
`onAuthenticated` hook runs, `GET ${basePath}/auth/me` answers, and the dashboard header shows who
is signed in.

```sh
npm install @worker-manager/auth
```

## Options

| Option | Description |
|---|---|
| `authenticate(req)` | Required. Resolve an `AuthUser` (`{ username, name?, email?, roles? }`) to let the request in, or `null`/`undefined` to reject it. A thrown error fails the request with that error. |
| `onUnauthenticated(req, res)` | Optional. Answers a rejected request instead of the default `401` JSON: a redirect, a challenge header, a page. If it leaves the response unsent, the default `401` is sent after it. |
| `logoutUrl` | Optional. Where the dashboard's "Sign out" item points. Hidden when unset. |
| `onAuthenticated(user, req)` | Optional. Return `false` to answer `403`. |

`req` is Node's `IncomingMessage`, so the same function works on Express, Fastify, Koa and NestJS.
The default rejection is `401` with `{ "error": { "key": "ERRORS.UNAUTHORIZED" }, "code": "UNAUTHORIZED" }`.

## Cloudflare Access

Cloudflare Access puts a signed JWT in the `Cf-Access-Jwt-Assertion` header of every request it
lets through. Verify it against your team's keys with [`jose`](https://github.com/panva/jose):

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { CustomAuthOptions } from '@worker-manager/auth';

const TEAM = 'https://your-team.cloudflareaccess.com';
const jwks = createRemoteJWKSet(new URL(`${TEAM}/cdn-cgi/access/certs`));

export const cloudflareAccess: CustomAuthOptions = {
  strategy: 'custom',
  async authenticate(req) {
    const token = req.headers['cf-access-jwt-assertion'];
    if (typeof token !== 'string') return null;
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: TEAM,
        audience: process.env.CF_ACCESS_AUD, // the application's AUD tag
      });
      const email = String(payload.email);
      return { username: email, email, roles: [] };
    } catch {
      return null;
    }
  },
  logoutUrl: '/cdn-cgi/access/logout',
};
```

Always verify the JWT. The plain `Cf-Access-Authenticated-User-Email` header can be forged by
anything that reaches your origin without going through Cloudflare.

## Reusing an API-key check (NestJS)

```ts
WorkerManagerModule.forRootAsync({
  imports: [ApiKeysModule],
  inject: [ApiKeysService],
  useFactory: (apiKeys: ApiKeysService) => ({
    route: '/admin/queues',
    auth: {
      strategy: 'custom',
      authenticate: async (req) => {
        const key = req.headers['x-api-key'];
        const owner = typeof key === 'string' ? await apiKeys.verify(key) : null;
        return owner?.scopes.includes('queues:admin')
          ? { username: owner.name, roles: owner.scopes }
          : null;
      },
    },
  }),
});
```

## Customising the rejection

```ts
{
  strategy: 'custom',
  authenticate: readSessionFromMyApp,
  onUnauthenticated: (req, res) => {
    res.statusCode = 302;
    res.setHeader('Location', `/login?next=${encodeURIComponent(req.url ?? '/')}`);
    res.end();
  },
}
```

Redirect only page loads: the dashboard's own API calls expect a JSON `401`. Checking
`req.headers.accept?.includes('text/html')` is enough to tell them apart.
