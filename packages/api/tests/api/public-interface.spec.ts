import * as workerManager from '@worker-manager/api';

describe('lib public interface', () => {
  it('should save the interface', () => {
    expect(workerManager).toMatchInlineSnapshot(`
      {
        "createWorkerManagerBoard": [Function],
      }
    `);
  });
});
