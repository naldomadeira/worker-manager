const base = require('./jest.base.js');
const latest = require('pg-boss-latest/package.json');

module.exports = {
  ...base,
  displayName: `pg-boss@${latest.version} (latest)`,
  moduleNameMapper: { '^pg-boss$': 'pg-boss-latest' },
  globals: { PGBOSS_SCHEMA: latest.pgboss.schema, PGBOSS_VERSION: latest.version },
};
