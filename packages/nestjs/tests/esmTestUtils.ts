import { fileURLToPath } from 'node:url';

export * from '@worker-manager/test-utils/src/serverAdapterContract';
export * from '@worker-manager/test-utils/src/redisFixtures';

export const uiFixtureBasePath = fileURLToPath(
  new URL('../../test-utils/src/uiFixture', import.meta.url)
);
