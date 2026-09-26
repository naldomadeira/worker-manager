import { PgBoss } from 'pg-boss';

export const boss = new PgBoss({
  connectionString: process.env.POSTGRES_URL ?? 'postgres://pgboss:pgboss@localhost:5451/pgboss',
  migrate: true,
});
