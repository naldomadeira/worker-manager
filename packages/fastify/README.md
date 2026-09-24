# <img alt="Worker Manager" src="https://raw.githubusercontent.com/naldomadeira/worker-manager/main/packages/ui/src/static/images/logo.svg" width="35px" /> @worker-manager/fastify 

[Fastify.js](https://www.fastify.io/) server adapter for Worker Manager.

<p align="center">
  <a href="https://www.npmjs.com/package/@worker-manager/fastify">
    <img alt="npm version" src="https://img.shields.io/npm/v/@worker-manager/fastify">
  </a>
  <a href="https://www.npmjs.com/package/@worker-manager/fastify">
    <img alt="npm downloads" src="https://img.shields.io/npm/dw/@worker-manager/fastify">
  </a>
  <a href="https://github.com/naldomadeira/worker-manager/blob/main/LICENSE">
    <img alt="licence" src="https://img.shields.io/github/license/naldomadeira/worker-manager">
  </a>
<p>

![Overview](https://raw.githubusercontent.com/naldomadeira/worker-manager/main/screenshots/overview.png)
![UI](https://raw.githubusercontent.com/naldomadeira/worker-manager/main/screenshots/dashboard.png)

# Usage examples
1. [Simple fastify setup](https://github.com/naldomadeira/worker-manager/tree/main/examples/with-fastify)
2. [Auth with fastify setup](https://github.com/naldomadeira/worker-manager/tree/main/examples/with-fastify-auth)


# Authentication

[`@worker-manager/auth`](https://www.npmjs.com/package/@worker-manager/auth) protects the board
with Basic auth or a Keycloak (OIDC) login. Wrap the board plugin so the hook is scoped to the
board's routes only:

```ts
import { createAuthMiddleware, createFastifyAuthPlugin } from '@worker-manager/auth';

const auth = createAuthMiddleware(
  { strategy: 'basic', users: [{ username: 'admin', password: process.env.BOARD_PASSWORD }] },
  // or { strategy: 'keycloak', url, realm, clientId, clientSecret, requiredRoles, cookie: { secret } }
  { basePath: '/ui' }
);

serverAdapter.setBasePath('/ui');
app.register(createFastifyAuthPlugin(serverAdapter.registerPlugin(), auth), { prefix: '/ui' });
```

Every board route (page, API, assets) then needs credentials, and `GET /ui/auth/me` returns the
signed-in user.

For more info visit the main [README](https://github.com/naldomadeira/worker-manager#readme)
