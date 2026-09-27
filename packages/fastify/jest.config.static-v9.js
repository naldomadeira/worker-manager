const base = require('./jest.base.js');
require('./jest.static-major.js')('fastify-static-v9', 9);

module.exports = {
  ...base,
  displayName: '@fastify/static@9',
  moduleNameMapper: { '^@fastify/static$': 'fastify-static-v9' },
};
