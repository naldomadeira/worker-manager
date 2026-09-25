import type { PgBossEngine } from '@worker-manager/api/engine';
import type { Reader } from './connection';

/** What `pgBossMetricsSources` needs from an engine that its public interface does not carry. */
export interface EngineInternals {
  reader: Reader;
  schema: string;
}

const registry = new WeakMap<PgBossEngine, EngineInternals>();

export function registerEngine(engine: PgBossEngine, internals: EngineInternals): void {
  registry.set(engine, internals);
}

export function internalsOf(engine: unknown): EngineInternals | null {
  return typeof engine === 'object' && engine !== null
    ? (registry.get(engine as PgBossEngine) ?? null)
    : null;
}
