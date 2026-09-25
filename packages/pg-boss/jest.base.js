// pg-boss ships ESM only, and the specs import it to install a schema and seed jobs, so this is an
// ESM project behind NODE_OPTIONS=--experimental-vm-modules. Floor and latest are two separate
// `jest` invocations (scripts/test.mjs) rather than `projects`, for the reason the NestJS 12
// config documents: a worker caches whether a path is ESM, and both runs load the same files.
module.exports = {
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          module: 'esnext',
          target: 'es2022',
          esModuleInterop: true,
          isolatedModules: true,
        },
      },
    ],
  },
  testMatch: ['<rootDir>/tests/**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  testTimeout: 30000,
};
