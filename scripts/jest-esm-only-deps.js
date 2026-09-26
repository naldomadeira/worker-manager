/**
 * `@fastify/static` >= 10.1.4 depends on `content-disposition@3`, which is published as ESM only.
 * Jest's CommonJS runtime cannot `require()` it, so any CJS suite that loads
 * `@worker-manager/fastify` dies on "Must use import to load ES Module" or "Unexpected token
 * 'export'". These settings compile just that package to CommonJS and leave the rest of
 * node_modules alone. `website/docs/recipes/troubleshooting.md` gives consumers the same recipe.
 */
const ESM_ONLY = ['content-disposition'];
const names = ESM_ONLY.join('|');

module.exports = {
  transform: {
    [`^.+[\\\\/]node_modules[\\\\/](?:${names})[\\\\/].+\\.js$`]: [
      'ts-jest',
      { tsconfig: { allowJs: true, module: 'commonjs' } },
    ],
  },
  transformIgnorePatterns: [`^(?!.*[\\\\/]node_modules[\\\\/](?:${names})[\\\\/]).*[\\\\/]node_modules[\\\\/]`],
};
