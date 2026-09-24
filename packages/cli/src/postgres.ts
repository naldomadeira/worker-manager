import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import type { QueueAdapterOptions } from '@worker-manager/api/typings/app';
import type { PostgresConfig } from './config/types';
import { describeError } from './describeError';
import type { DiscoveredQueue } from './discovery';
import type { QueueHandle } from './registry';

/** Stands in for a key prefix, so a PostgreSQL queue never collides with a Redis one in the registry. */
export const postgresPrefix = (schema: string) => `postgres:${schema}`;

export interface PostgresSource {
  label: string;
  discover(queueNames: string[] | null): Promise<DiscoveredQueue[]>;
  createQueue(discovered: DiscoveredQueue): QueueHandle;
  close(): Promise<void>;
}

// Every table that names a queue leads its primary key with it, so a recursive "loose index
// scan" enumerates distinct names in one index probe per queue instead of reading every job.
const distinctQueues = (table: string) => `
  (WITH RECURSIVE names AS (
     SELECT min(queue) AS queue FROM ${table}
     UNION ALL
     SELECT (SELECT min(queue) FROM ${table} WHERE queue > names.queue)
       FROM names WHERE names.queue IS NOT NULL
   )
   SELECT queue FROM names WHERE queue IS NOT NULL)`;

const DISCOVERY_SQL = ['job', 'meta', 'scheduler', 'event']
  .map(distinctQueues)
  .join('\nUNION\n')
  .concat('\nORDER BY 1');

function describeTarget(connection: PostgresConfig['connection']): string {
  const raw =
    typeof connection.connectionString === 'string'
      ? connection.connectionString
      : `postgres://${connection.host ?? 'localhost'}:${connection.port ?? 5432}/${connection.database ?? ''}`;
  try {
    const url = new URL(raw);
    url.password = url.password ? '***' : '';
    return url.toString();
  } catch {
    return raw;
  }
}

/**
 * BullMQ v6 can store queues in PostgreSQL. The CLI talks to them through the v6 build it
 * bundles (`bullmq-v6`), independent of the v5 build it uses for Redis, and discovers queue
 * names straight from the backend's tables.
 */
export function createPostgresSource({
  config,
  readOnly,
  queueOptions,
  onWarning,
}: {
  config: PostgresConfig;
  readOnly: boolean;
  queueOptions: Record<string, Partial<QueueAdapterOptions>>;
  onWarning(message: string): void;
}): PostgresSource {
  // oxlint-disable-next-line typescript/no-require-imports
  const { Queue, createPostgresBackend } = require('bullmq-v6');
  // oxlint-disable-next-line typescript/no-require-imports
  const { Pool } = require('pg');

  const { schema: _schema, ...poolConfig } = config.connection;
  const pool = new Pool({ ...poolConfig, max: 1 });
  pool.on('error', (error: Error) =>
    onWarning(`PostgreSQL connection error: ${describeError(error)}`)
  );
  const prefix = postgresPrefix(config.schema);
  const schemaIdent = `"${config.schema}"`;

  return {
    label: describeTarget(config.connection),

    async discover(queueNames) {
      if (queueNames) {
        return queueNames.map((name) => ({ prefix, name, lib: 'bullmq-postgres' as const }));
      }

      const client = await pool.connect();
      try {
        const exists = await client.query('SELECT to_regclass($1) AS table', [
          `${schemaIdent}.job`,
        ]);
        // No BullMQ schema yet: nothing has ever created a PostgreSQL queue here.
        if (!exists.rows[0]?.table) return [];

        await client.query(`SET search_path TO ${schemaIdent}`);
        const { rows } = await client.query(DISCOVERY_SQL);

        return rows.map((row: { queue: string }) => ({
          prefix,
          name: row.queue,
          lib: 'bullmq-postgres' as const,
        }));
      } finally {
        client.release();
      }
    },

    createQueue(discovered) {
      const queue = new Queue(
        discovered.name,
        { connection: { ...config.connection, max: 2 }, skipMetasUpdate: true },
        createPostgresBackend
      );
      queue.on('error', (error: Error) =>
        onWarning(`Queue "${discovered.name}" connection error: ${describeError(error)}`)
      );
      const options: Partial<QueueAdapterOptions> = {
        ...queueOptions[discovered.name],
        readOnlyMode: readOnly || queueOptions[discovered.name]?.readOnlyMode === true,
      };

      return {
        adapter: new BullMQAdapter(queue, options),
        close: () => queue.close(),
      };
    },

    close: () => pool.end(),
  };
}
