// `@fastify/static` is declared as `^9.0.0 || ^10.0.0`, so both majors run: the plain dependency
// (latest 10.x) and the `fastify-static-v9` alias.
module.exports = {
  projects: ['<rootDir>/jest.config.static-v10.js', '<rootDir>/jest.config.static-v9.js'],
};
