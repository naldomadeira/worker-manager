import React, { useContext } from 'react';
import { PgBossApi } from '../services/PgBossApi';

/** Tests hand a mocked client in here; the app falls back to one built from the base path. */
export const PgBossApiContext = React.createContext<PgBossApi | null>(null);

let defaultApi: PgBossApi | null = null;

function getDefaultApi(): PgBossApi {
  if (!defaultApi) {
    const basePath: string = (window as { __basePath__?: string }).__basePath__ ?? '';
    defaultApi = new PgBossApi({ basePath });
  }
  return defaultApi;
}

export function usePgBossApi(): PgBossApi {
  return useContext(PgBossApiContext) ?? getDefaultApi();
}
