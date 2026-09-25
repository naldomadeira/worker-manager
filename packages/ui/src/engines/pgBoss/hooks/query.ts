import type { ErrorResponseBody } from '@worker-manager/api/typings/app';
import i18n from 'i18next';
import { useSettingsStore } from '../../../hooks/useSettings';
import { translateMessage } from '../../../utils/translateMessage';

/** The settings' polling interval as TanStack wants it: milliseconds, or off. */
export function usePollingInterval(): number | false {
  const pollingInterval = useSettingsStore((state) => state.pollingInterval);
  return pollingInterval > 0 ? pollingInterval * 1000 : false;
}

export function isErrorBody(value: unknown): value is ErrorResponseBody {
  return !!value && typeof value === 'object' && 'error' in value;
}

/**
 * The client resolves an error body instead of throwing, so a failed read would otherwise arrive
 * as data. Raising it here is what lets a page show its load error.
 */
export function unwrap<T>(response: T | ErrorResponseBody): T {
  if (isErrorBody(response)) {
    throw new PgBossLoadError(response);
  }
  if (response == null) {
    throw new Error(i18n.t('DASHBOARD.LOAD_ERROR'));
  }
  return response;
}

/** A read the server refused, with the refusal kept so a page can branch on its key. */
export class PgBossLoadError extends Error {
  constructor(public readonly body: ErrorResponseBody) {
    super(translateMessage(body.error));
    this.name = 'PgBossLoadError';
  }
}
