# <img alt="Worker Manager" src="https://raw.githubusercontent.com/naldomadeira/worker-manager/main/packages/ui/src/static/images/logo.svg" width="35px" /> @worker-manager/express 

[Express.js](https://expressjs.com/) server adapter for Worker Manager.

<p align="center">
  <a href="https://www.npmjs.com/package/@worker-manager/express">
    <img alt="npm version" src="https://img.shields.io/npm/v/@worker-manager/express">
  </a>
  <a href="https://www.npmjs.com/package/@worker-manager/express">
    <img alt="npm downloads" src="https://img.shields.io/npm/dw/@worker-manager/express">
  </a>
  <a href="https://github.com/naldomadeira/worker-manager/blob/main/LICENSE">
    <img alt="licence" src="https://img.shields.io/github/license/naldomadeira/worker-manager">
  </a>
<p>

![Overview](https://raw.githubusercontent.com/naldomadeira/worker-manager/main/screenshots/overview.png)
![UI](https://raw.githubusercontent.com/naldomadeira/worker-manager/main/screenshots/dashboard.png)

# Usage examples
1. [Simple express setup](https://github.com/naldomadeira/worker-manager/tree/main/examples/express/basic)
2. [Basic authentication example](https://github.com/naldomadeira/worker-manager/tree/main/examples/express/custom-login)
2. [Multiple instance of the board](https://github.com/naldomadeira/worker-manager/tree/main/examples/express/multiple-boards)

# Authentication

[`@worker-manager/auth`](https://www.npmjs.com/package/@worker-manager/auth) protects the board
with Basic auth or a Keycloak (OIDC) login:

```ts
import { createAuthMiddleware } from '@worker-manager/auth';

const auth = createAuthMiddleware(
  { strategy: 'basic', users: [{ username: 'admin', password: process.env.BOARD_PASSWORD }] },
  // or { strategy: 'keycloak', url, realm, clientId, clientSecret, requiredRoles, cookie: { secret } }
  { basePath: '/ui' }
);

serverAdapter.setBasePath('/ui');
app.use('/ui', auth, serverAdapter.getRouter());
```

Every board route (page, API, assets) then needs credentials, and `GET /ui/auth/me` returns the
signed-in user.

For more info visit the main [README](https://github.com/naldomadeira/worker-manager#readme)
