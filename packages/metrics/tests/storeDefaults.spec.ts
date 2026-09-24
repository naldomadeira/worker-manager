import { LatencyStore } from '../src';

// 1.0 constructed the public LatencyStore with `{ redis, retention }`; 1.1.0 briefly required
// `keys` as well. Keep the old call compiling and writing to the default namespace.
describe('LatencyStore defaults', () => {
  it('accepts the 1.0 constructor options and uses the default namespace', () => {
    const store = new LatencyStore({
      redis: {} as any,
      retention: { minutes: 1, hours: 1, days: 1 },
    });
    expect((store as any).keys.namespace).toBe('worker-manager:metrics');
  });
});
