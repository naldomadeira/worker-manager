# NestJS + PostgreSQL

A NestJS 11 app whose BullMQ v6 queues are stored in PostgreSQL through `createPostgresBackend`.
`@nestjs/bullmq` cannot pass a backend factory, so `src/queues.ts` creates the `invoices` and
`notifications` queues with `bullmq` directly, a provider runs their workers and adds jobs every
3 seconds, and `WorkerManagerModule.forRoot({ queues })` puts them on the board behind basic auth.

Requires `bullmq` 6.3 or later with the `pg` package: the connection is
`{ connectionString, migrate: true }`, and `migrate: true` creates BullMQ's schema on first
connect.

```sh
cp .env.example .env
docker compose up -d --wait
npm install
npm start
```

Open http://localhost:3011/queues and sign in with `admin` / `admin` (`BOARD_USERNAME` /
`BOARD_PASSWORD` in `.env`).

Stop with Ctrl+C, then `docker compose down -v`.
