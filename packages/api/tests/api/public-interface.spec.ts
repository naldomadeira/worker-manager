import * as workerManager from '@worker-manager/api';

describe('lib public interface', () => {
  it('should save the interface', () => {
    expect(workerManager).toMatchInlineSnapshot(`
      {
        "createWorkerManagerBoard": [Function],
      }
    `);
  });

  it('exposes the base adapter at runtime through its subpath export', () => {
    const { BaseAdapter } = require('@worker-manager/api/baseAdapter');

    expect(typeof BaseAdapter).toBe('function');
    expect(BaseAdapter.name).toBe('BaseAdapter');
    expect(typeof BaseAdapter.prototype.setFormatter).toBe('function');
    expect(typeof BaseAdapter.prototype.isVisible).toBe('function');
  });
});
