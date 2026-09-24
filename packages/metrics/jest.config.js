// See jest.base.js: the cap keeps JEST_WORKER_ID inside the range of logical databases
// `tests/connection.ts` hands out. The timeout is repeated for the same reason as the cap:
// Jest reads it from the root config only, so the per-project value never applied here.
module.exports = {
  maxWorkers: 15,
  testTimeout: 30000,
  projects: ['<rootDir>/jest.config.default.js', '<rootDir>/jest.config.bullmq-v6.js'],
};
