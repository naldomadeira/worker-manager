import type { ErrorMessage, ErrorTranslationKey, HTTPStatus } from '../../types';

/** A failure the engine wants answered with a specific status and translation key. */
export class PgBossEngineError extends Error {
  constructor(
    public readonly status: HTTPStatus,
    public readonly key: ErrorTranslationKey,
    public readonly options?: Record<string, unknown>,
    public readonly detail?: ErrorMessage
  ) {
    super(key);
    this.name = 'PgBossEngineError';
  }
}
