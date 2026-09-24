import * as bullBoard from '@worker-manager/api';

describe('lib public interface', () => {
  it('should save the interface', () => {
    expect(bullBoard).toMatchInlineSnapshot(`
      {
        "createBullBoard": [Function],
      }
    `);
  });
});
