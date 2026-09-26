import type { WorkerManagerServerAdapter } from './worker-manager.types';

type Args<M extends keyof WorkerManagerServerAdapter> = Parameters<WorkerManagerServerAdapter[M]>;

/**
 * Stands in for the server adapter while the Nest HTTP platform is not known yet.
 *
 * `Test.createTestingModule(...).compile()` instantiates every provider before
 * `createNestApplication()` hands the application its HTTP adapter, so an adapter picked from
 * the platform cannot exist at that point. The board is still created then, since services may
 * inject it, and mounts itself through this stand-in: every call is recorded and replayed onto
 * the real adapter by `attach()`, which the root module calls from `configure()`, once the
 * platform is there. Calls made after that go straight through.
 */
export class DeferredServerAdapter implements WorkerManagerServerAdapter {
  private target: WorkerManagerServerAdapter | undefined;
  private readonly calls: Array<(adapter: WorkerManagerServerAdapter) => unknown> = [];

  /** The real adapter once attached, `undefined` before. */
  get resolved(): WorkerManagerServerAdapter | undefined {
    return this.target;
  }

  attach(target: WorkerManagerServerAdapter): WorkerManagerServerAdapter {
    if (this.target) return this.target;
    for (const call of this.calls.splice(0)) call(target);
    this.target = target;
    return target;
  }

  setQueues(...args: Args<'setQueues'>): this {
    return this.record((adapter) => adapter.setQueues(...args));
  }

  setViewsPath(...args: Args<'setViewsPath'>): this {
    return this.record((adapter) => adapter.setViewsPath(...args));
  }

  setStaticPath(...args: Args<'setStaticPath'>): this {
    return this.record((adapter) => adapter.setStaticPath(...args));
  }

  setEntryRoute(...args: Args<'setEntryRoute'>): this {
    return this.record((adapter) => adapter.setEntryRoute(...args));
  }

  setErrorHandler(...args: Args<'setErrorHandler'>): this {
    return this.record((adapter) => adapter.setErrorHandler(...args));
  }

  setApiRoutes(...args: Args<'setApiRoutes'>): this {
    return this.record((adapter) => adapter.setApiRoutes(...args));
  }

  setUIConfig(...args: Args<'setUIConfig'>): this {
    return this.record((adapter) => adapter.setUIConfig(...args));
  }

  setBasePath(...args: Args<'setBasePath'>): this {
    return this.record((adapter) => adapter.setBasePath(...args));
  }

  private record(call: (adapter: WorkerManagerServerAdapter) => unknown): this {
    if (this.target) call(this.target);
    else this.calls.push(call);
    return this;
  }
}

export const isDeferredAdapter = (adapter: unknown): adapter is DeferredServerAdapter =>
  adapter instanceof DeferredServerAdapter;
