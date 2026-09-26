const { defaults: tsJest } = require('ts-jest/presets');

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    ...tsJest.transform,
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          esModuleInterop: true,
        },
      },
    ],
  },
  // Both Nest projects run under --experimental-vm-modules, where Jest refuses to require() an
  // ES module however it is transformed, and @fastify/static >= 10.1.4 pulls in the ESM-only
  // content-disposition@3. @worker-manager/fastify accepts @fastify/static 9 as well, which is
  // what an app that already has 9 ends up with, so these suites load that. Both majors are
  // covered by the @worker-manager/fastify suite.
  moduleNameMapper: { '^@fastify/static$': 'fastify-static-v9' },
  testMatch: ['<rootDir>/tests/**/*.spec.ts'],
  testTimeout: 30000,
};
