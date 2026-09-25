# NestJS + Keycloak

A NestJS 11 app using `@nestjs/bullmq` on Redis, with the board behind Keycloak. The auth options
come from `@nestjs/config` through `WorkerManagerModule.forRootAsync()`, reading the `KEYCLOAK_*`
variables. `docker compose` starts Redis and a Keycloak 26 that imports the realm in `keycloak/`:
a confidential client `worker-manager-board` with a redirect URI for port 3012, and two users.

```sh
cp .env.example .env
docker compose up -d --wait
npm install
npm start
```

Open http://localhost:3012/queues and sign in:

| User | Password | Result |
|---|---|---|
| `admin` | `admin` | has the `wm-admin` role, sees the board |
| `viewer` | `viewer` | signed in without the role, gets `403` |

API clients can send `Authorization: Bearer <access token>` instead of the session cookie. The
Keycloak admin console is at http://localhost:8110 (`admin` / `admin`).

Stop with Ctrl+C, then `docker compose down -v`.
