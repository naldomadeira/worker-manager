const { devDependencies, peerDependencies } = require('./package.json');
const base = require('./jest.base.js');
const floor = require('pg-boss-floor/package.json');

// Pinned exactly, so "the floor" cannot drift with a dependency bump; the guard fails the run if
// the pin and the declared peer range disagree.
const pinned = devDependencies['pg-boss-floor'].replace('npm:pg-boss@', '');
const declared = peerDependencies['pg-boss'].split('||')[0].trim().replace(/^\^/, '');

if (pinned !== declared || floor.version !== pinned) {
  throw new Error(
    `pg-boss-floor is pinned to ${pinned} (installed ${floor.version}) but the pg-boss peer range ` +
      `starts at ${declared}. Pin the alias to the declared floor.`
  );
}

module.exports = {
  ...base,
  displayName: `pg-boss@${pinned} (peer floor)`,
  moduleNameMapper: { '^pg-boss$': 'pg-boss-floor' },
  globals: { PGBOSS_SCHEMA: floor.pgboss.schema, PGBOSS_VERSION: floor.version },
};
