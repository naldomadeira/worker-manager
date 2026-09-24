import { resolveRetention } from '../MetricsRecorder';
import type { Retention } from '../store';
import { StoreHistoryProvider } from '../StoreHistoryProvider';
import type { PostgresConnection } from './connection';
import { PostgresMetricsStore } from './PostgresMetricsStore';

interface RetentionOptions {
  /** Should mirror the recorder's retention. Only used to bound the query span. */
  retention?: Partial<Retention>;
  retentionDays?: number;
}

export type PostgresMetricsHistoryProviderOptions = RetentionOptions &
  (
    | {
        /** A `pg.Pool`, a node-postgres pool config, or a connection string. */
        connection: PostgresConnection;
        /** Must match the recorder's store. See `PostgresMetricsStoreOptions`. */
        schema?: string;
        tablePrefix?: string;
        /** See `PostgresMetricsStoreOptions.migrate`. */
        migrate?: boolean;
        onError?: (error: Error) => void;
        store?: never;
      }
    | {
        /** A store shared with the recorder. Left open on `disconnect()`. */
        store: PostgresMetricsStore;
        connection?: never;
        schema?: never;
        tablePrefix?: never;
        migrate?: never;
        onError?: never;
      }
  );

/** Serves the board's history charts and storage panel from the PostgreSQL store. */
export class PostgresMetricsHistoryProvider extends StoreHistoryProvider {
  readonly store: PostgresMetricsStore;
  private readonly ownsStore: boolean;

  constructor(opts: PostgresMetricsHistoryProviderOptions) {
    const store =
      opts.store ??
      new PostgresMetricsStore({
        connection: opts.connection,
        schema: opts.schema,
        tablePrefix: opts.tablePrefix,
        migrate: opts.migrate,
        onError: opts.onError,
      });
    super(store, resolveRetention(opts));
    this.store = store;
    this.ownsStore = !opts.store;
  }

  /** Ends the pool behind a store this provider built. A store or pool handed in is left open. */
  async disconnect(): Promise<void> {
    if (this.ownsStore) {
      await this.store.close();
    }
  }
}
