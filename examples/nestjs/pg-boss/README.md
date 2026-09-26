# NestJS + pg-boss

A NestJS 11 app with a [pg-boss](https://github.com/timgit/pg-boss) instance and Worker Manager's
pg-boss board. `src/boss.ts` creates the instance with `migrate: true`, which installs pg-boss's
schema in its own database on first start; `main.ts` starts it before Nest boots. A provider
creates the `invoices` and `notifications` queues, runs their workers, sends jobs every 3 seconds
and schedules a `notifications` job every minute. Invoices over 900 fail, and are retried once.
`WorkerManagerModule.forRoot({ engine: 'pg-boss', pgBoss: { instance } })` mounts the board
behind basic auth.

Requires Node.js 22.12 or later and pg-boss 12.24 or later. The board is experimental: see
[the pg-boss engine](https://naldomadeira.github.io/worker-manager/queue-adapters/pg-boss).

```sh
cp .env.example .env
docker compose up -d --wait
npm install
npm start
```

Open http://localhost:3013/pg-boss and sign in with `admin` / `admin` (`BOARD_USERNAME` /
`BOARD_PASSWORD` in `.env`).

Stop with Ctrl+C, then `docker compose down -v`.
