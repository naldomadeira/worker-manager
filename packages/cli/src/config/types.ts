import type { QueueAdapterOptions, UIConfig } from '@worker-manager/api/typings/app';
import type { KeycloakAuthOptions } from '@worker-manager/auth';
import type { Retention } from '@worker-manager/metrics';
import type { RedisOptions } from 'ioredis';
import type { ConnectionConfig } from './connection';

export interface FileHistoryConfig {
  enabled?: boolean;
  /** Write snapshots from this process. Defaults to true unless the board is read-only. */
  record?: boolean;
  /**
   * Redis key namespace for the recorded history. Defaults to `worker-manager:metrics`. Redis
   * only: a PostgreSQL-only board keeps its history in `worker_manager_metrics_*` tables in the
   * BullMQ schema.
   */
  prefix?: string;
  retentionDays?: number;
  retention?: Partial<Retention>;
  latency?: boolean;
  snapshotIntervalMs?: number;
}

export interface HistoryConfig {
  record: boolean;
  prefix?: string;
  retentionDays?: number;
  retention?: Partial<Retention>;
  latency: boolean;
  snapshotIntervalMs?: number;
}

export interface FileConfig {
  redis?: string | RedisOptions;
  port?: number;
  host?: string;
  prefix?: string | string[];
  queues?: string[] | Record<string, Partial<QueueAdapterOptions>>;
  scanInterval?: number;
  basePath?: string;
  readOnly?: boolean;
  user?: string;
  password?: string;
  /** Keycloak (OIDC) login instead of Basic auth. */
  keycloak?: Omit<KeycloakAuthOptions, 'strategy'>;
  /**
   * PostgreSQL connection for BullMQ v6 queues backed by PostgreSQL: a connection string, or
   * a node-postgres pool config with an optional `schema` (default `bullmq`).
   */
  postgres?: string | PostgresFileConfig;
  open?: boolean;
  browser?: string;
  uiConfig?: UIConfig;
  noRetry?: boolean;
  history?: boolean | FileHistoryConfig;
}

export interface PostgresFileConfig {
  connectionString?: string;
  schema?: string;
  [option: string]: unknown;
}

export interface PostgresConfig {
  /** Passed to BullMQ's PostgreSQL backend as `connection`: a pool config plus `schema`. */
  connection: Record<string, unknown>;
  schema: string;
  /** No Redis source was configured, so the board serves PostgreSQL queues only. */
  only: boolean;
}

export interface CliConfig {
  connection: ConnectionConfig;
  port: number;
  host: string;
  prefixes: string[];
  queueNames: string[] | null;
  scanInterval: number;
  basePath: string;
  readOnly: boolean;
  auth: { user: string; password: string } | null;
  keycloak: KeycloakAuthOptions | null;
  postgres: PostgresConfig | null;
  open: boolean;
  browser?: string;
  uiConfig: UIConfig;
  queueOptions: Record<string, Partial<QueueAdapterOptions>>;
  noRetry: boolean;
  history: HistoryConfig | null;
}
