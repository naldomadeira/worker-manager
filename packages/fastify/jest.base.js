const pkg = require('./package.json');
const { defaults: tsJest } = require('ts-jest/presets');
const esmOnlyDeps = require('../../scripts/jest-esm-only-deps');

module.exports = {
  displayName: pkg.name,
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    ...tsJest.transform,
    ...esmOnlyDeps.transform,
  },
  transformIgnorePatterns: esmOnlyDeps.transformIgnorePatterns,
  testMatch: ['<rootDir>/tests/**/*.spec.ts'],
  testTimeout: 30000,
};
