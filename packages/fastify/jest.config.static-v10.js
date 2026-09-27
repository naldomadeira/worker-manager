const base = require('./jest.base.js');
require('./jest.static-major.js')('@fastify/static', 10);

module.exports = { ...base, displayName: '@fastify/static@10' };
