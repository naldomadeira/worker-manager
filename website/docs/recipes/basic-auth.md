# Add basic auth

Don't expose the dashboard on the open internet without auth. The quickest route is the built-in
middleware from `@worker-manager/auth`, which works on every Node framework. The framework-native
approaches further down remain valid alternatives when you already have a login in your app.

## Built-in middleware

```sh
npm install @worker-manager/auth
```

```ts
import { createAuthMiddleware } from '@worker-manager/auth';

const auth = createAuthMiddleware(
  {
    strategy: 'basic',
    users: [{ username: 'admin', password: process.env.BOARD_PASSWORD!, roles: ['admin'] }],
    // Optional: checked when no static user matches, e.g. against your user table.
    validate: async (username, password) => (await checkUser(username, password)) ?? false,
  },
  { basePath: '/ui' }
);

// Express
app.use('/ui', auth, serverAdapter.getRouter());
```

On Fastify, wrap the board plugin so the hook only covers the board:

```ts
import { createAuthMiddleware, createFastifyAuthPlugin } from '@worker-manager/auth';

app.register(createFastifyAuthPlugin(serverAdapter.registerPlugin(), auth), { prefix: '/ui' });
```

On NestJS, pass the same object as the module's `auth` option:

```ts
WorkerManagerModule.forRoot({
  auth: { strategy: 'basic', users: [{ username: 'admin', password: process.env.BOARD_PASSWORD! }] },
});
```

Credentials are compared in constant time (both sides hashed, then `crypto.timingSafeEqual`).
A failure answers `401` with a `WWW-Authenticate: Basic` challenge and
`{ "error": { "key": "ERRORS.UNAUTHORIZED" } }`, so the page, the API and the assets are all
covered. `GET /ui/auth/me` returns the signed-in user. For single sign-on, the same package does
[Keycloak](/recipes/keycloak-auth).

The standalone [CLI](/guide/cli#basic-auth) uses the same middleware behind `--user`/`--password`.

## Alternatives per framework

Here's the minimum per framework if you would rather use its own auth tooling.

### Express + Passport

From [`examples/with-express-auth`](https://github.com/naldomadeira/worker-manager/tree/main/examples/with-express-auth).

```js
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const { ensureLoggedIn } = require('connect-ensure-login');
const session = require('express-session');

passport.use(new LocalStrategy((username, password, cb) => {
  if (username === 'bull' && password === 'board') {
    return cb(null, { user: 'worker-manager' });
  }
  return cb(null, false);
}));

passport.serializeUser((user, cb) => cb(null, user));
passport.deserializeUser((user, cb) => cb(null, user));

app.use(session({ secret: 'keyboard cat', resave: true, saveUninitialized: true }));
app.use(passport.initialize());
app.use(passport.session());

app.post('/ui/login', passport.authenticate('local', { failureRedirect: '/ui/login?invalid=true' }),
  (req, res) => res.redirect('/ui'));

app.use('/ui', ensureLoggedIn({ redirectTo: '/ui/login' }), serverAdapter.getRouter());
```

A logged-in session reaches `/ui` without a second login, which is all "auto-login" really means for a cookie-based app. If your API uses bearer tokens instead, see [Auto-login from a token-based frontend](#auto-login-from-a-token-based-frontend).

Run it:

```sh
git clone https://github.com/naldomadeira/worker-manager
cd worker-manager/examples/with-express-auth
npm install && npm start
# http://localhost:3000/ui (login: bull / board)
```

### Fastify + @fastify/basic-auth

From [`examples/with-fastify-auth`](https://github.com/naldomadeira/worker-manager/tree/main/examples/with-fastify-auth).

```js
await app.register(require('@fastify/basic-auth'), {
  validate: (username, password, req, reply, done) => {
    if (username === 'bull' && password === 'board') return done();
    done(new Error('Unauthorized'));
  },
  authenticate: { realm: 'Worker Manager' },
});

app.after(() => {
  const serverAdapter = new FastifyAdapter();
  createWorkerManagerBoard({ queues: [new BullMQAdapter(queue)], serverAdapter });
  serverAdapter.setBasePath('/ui');
  app.register(serverAdapter.registerPlugin(), { prefix: '/ui' });

  app.addHook('onRequest', (req, reply, next) => {
    app.basicAuth(req, reply, (err) => err ? reply.code(401).send({ error: err.name }) : next());
  });
});
```

The `onRequest` hook covers every route registered after it. Scope the auth plugin inside a child context if you want it to cover only the dashboard.

### Hapi + strategy

From [`examples/with-hapi-auth`](https://github.com/naldomadeira/worker-manager/tree/main/examples/with-hapi-auth).

```js
await app.register(require('@hapi/basic'));
app.auth.strategy('simple', 'basic', {
  validate: async (_req, username, password) => ({
    isValid: username === 'bull' && password === 'board',
    credentials: { username },
  }),
});

const serverAdapter = new HapiAdapter();
createWorkerManagerBoard({ queues: [new BullMQAdapter(queue)], serverAdapter });
serverAdapter.setBasePath('/ui');

await app.register(
  { plugin: serverAdapter.registerPlugin(), options: { auth: 'simple' } },
  { routes: { prefix: '/ui' } }
);
```

The plugin options pass straight to Hapi's route config, so the auth strategy applies to every Worker Manager route.

### NestJS + guards

From [`examples/with-nestjs-fastify-auth`](https://github.com/naldomadeira/worker-manager/tree/main/examples/with-nestjs-fastify-auth).

NestJS on the Fastify platform with a standard `@UseGuards()` guard. The example uses passport-local plus `@fastify/secure-session` for session cookies.

```ts
@Controller()
export class AppController {
  @Post('login')
  @UseFilters(AuthExceptionFilter)
  @UseGuards(AuthGuard('local'))
  login(@Request() req: FastifyRequest, @Response() reply: FastifyReply) {
    req.session.set('sev-data', req.user);
    return reply.status(302).redirect('/queues');
  }
}
```

The dashboard is mounted by `@worker-manager/nestjs`, and the module's own guard checks the session before the route resolves.

## Auto-login from a token-based frontend

If your app uses a cookie session, you already have auto-login. The browser sends the session cookie on every request, including when someone opens `/ui`, so a logged-in admin lands on the dashboard through your existing middleware without logging in again. There's nothing else to do.

Bearer tokens are where it gets awkward. When a separate SPA authenticates by sending an `Authorization: Bearer` header, opening `/ui` in a new tab won't carry that header. It's just a normal browser navigation, so your token middleware turns it away. What the dashboard needs is a cookie the browser will send on its own.

So give it one. Add an admin-only endpoint that logs the user into a session and hands back the URL:

```js
// Guarded by your normal bearer-token middleware, admin only.
app.get('/api/queue-monitor', requireAdmin, (req, res) => {
  req.login(req.user, (err) => {          // sets the session cookie
    if (err) return res.status(500).end();
    res.json({ url: `${req.protocol}://${req.get('host')}/ui` });
  });
});
```

The SPA calls it with its token and opens the URL it gets back:

```js
const { url } = await api.get('/api/queue-monitor');
window.open(url, '_blank', 'noopener,noreferrer');
```

The new tab now has a session cookie, so the `ensureLoggedIn` gate from the Express example lets it through. It's the same session a normal login would create; you're just creating it on demand.

> Don't put the credentials in the URL. A link like `https://user:pass@host/ui` is an easy one-click shortcut, but those credentials end up in the address bar, the browser history, and referrer headers. Use a cookie.

## Combine with read-only mode

Auth keeps strangers out. [Read-only mode](/recipes/read-only-mode) keeps authenticated users from running destructive actions. Use both for public-facing status boards.
