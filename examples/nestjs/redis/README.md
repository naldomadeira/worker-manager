# NestJS + Redis

A NestJS 11 app using `@nestjs/bullmq` (BullMQ v5 on Redis). `WorkerManagerModule.forRoot()` mounts
the board at `/queues` behind basic auth, and `WorkerManagerModule.forFeature()` registers the
`emails` and `reports` queues. A processor works each queue and a producer adds jobs every 3 seconds.

```sh
cp .env.example .env
docker compose up -d --wait
npm install
npm start
```

Open http://localhost:3010/queues and sign in with `admin` / `admin` (`BOARD_USERNAME` /
`BOARD_PASSWORD` in `.env`).

Stop with Ctrl+C, then `docker compose down -v`.
