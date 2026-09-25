import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Node 22 reads .env natively, so the playground needs no dotenv dependency.
const envFile = join(__dirname, '..', '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const env = (name: string, fallback = '') => process.env[name] ?? fallback;

export type AuthMode = 'none' | 'basic' | 'keycloak';

const postgresUrl = env('POSTGRES_URL', 'postgres://bullmq:bullmq@localhost:5440/bullmq');

export const config = {
  port: Number(env('PORT', '3100')),
  auth: env('WM_AUTH', 'basic') as AuthMode,
  basic: {
    username: env('WM_BASIC_USER', 'admin'),
    password: env('WM_BASIC_PASSWORD', 'admin'),
  },
  keycloak: {
    url: env('KEYCLOAK_URL', 'http://localhost:8090'),
    realm: env('KEYCLOAK_REALM', 'worker-manager'),
    clientId: env('KEYCLOAK_CLIENT_ID', 'worker-manager-board'),
    clientSecret: env('KEYCLOAK_CLIENT_SECRET', 'playground-secret'),
    requiredRoles: env('KEYCLOAK_REQUIRED_ROLES', 'wm-admin')
      .split(',')
      .map((role) => role.trim())
      .filter(Boolean),
    cookieSecret: env('WM_COOKIE_SECRET', 'change-me-to-a-long-random-string-please'),
  },
  redisUrl: env('REDIS_URL', 'redis://localhost:6390'),
  postgresUrl,
  traffic: env('WM_TRAFFIC', 'true') !== 'false',
  /** Both boards read-only: the pg-boss board then does not even register its mutation routes. */
  readOnly: env('WM_READONLY', 'false') === 'true',
  /** The second board, over a pg-boss schema in the same PostgreSQL. Needs POSTGRES_URL. */
  pgBoss: !!postgresUrl && env('WM_PGBOSS', 'true') !== 'false',
};
