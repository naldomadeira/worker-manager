const fs = require('fs');
const path = require('path');

/** Throws at config load if `specifier` does not resolve to the major the project claims. */
module.exports = function assertStaticMajor(specifier, expected) {
  let dir = path.dirname(require.resolve(specifier));
  while (!fs.existsSync(path.join(dir, 'package.json'))) dir = path.dirname(dir);
  const { version } = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  if (Number(version.split('.')[0]) !== expected) {
    throw new Error(`${specifier} resolves to @fastify/static@${version}, expected ${expected}.x`);
  }
};
