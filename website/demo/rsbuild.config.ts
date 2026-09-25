import { defineConfig } from '@rsbuild/core';
import { pluginNodePolyfill } from '@rsbuild/plugin-node-polyfill';

const DEMO_BASE = '/worker-manager/demo/';
const PGBOSS_BASE = `${DEMO_BASE}pg-boss/`;
/** The pg-boss board is its own page, served from `pg-boss/index.html` under the demo. */
const PGBOSS_ENTRY = 'pg-boss/index';

// The same header menu on both boards, so a visitor can hop between the two engines.
const miscLinks = [
  { text: 'BullMQ board', url: DEMO_BASE },
  { text: 'pg-boss board (experimental)', url: PGBOSS_BASE },
];

const sharedUiConfig = {
  boardLogo: { path: `${DEMO_BASE}logo.svg`, width: 32, height: 32 },
  environment: { label: 'Demo', color: '#f59f00', textColor: '#000' },
  pollingInterval: { showSetting: true },
  sortQueues: true,
  miscLinks,
  hideDocsLink: false,
};

// Served statically here rather than by the entry route, so the flags `mountBoard` derives
// (`engine` and the history provider's) have to be repeated. They must match the boards wired up
// in src/mocks/handlers.ts.
const bullmqUiConfig = {
  ...sharedUiConfig,
  boardTitle: 'Worker Manager Demo',
  showMetrics: true,
  engine: 'bullmq',
  hasHistoryProvider: true,
  hasHistoryUsage: true,
  hasLatencyHistory: true,
  canPurgeHistory: true,
};

const pgBossUiConfig = {
  ...sharedUiConfig,
  boardTitle: 'Worker Manager Demo',
  engine: 'pg-boss',
  hasHistoryProvider: false,
  hasHistoryUsage: false,
  hasLatencyHistory: false,
  canPurgeHistory: false,
};

export default defineConfig({
  plugins: [pluginNodePolyfill()],
  source: {
    entry: { index: './src/main.ts', [PGBOSS_ENTRY]: './src/main.ts' },
  },
  html: {
    // The pg-boss page sits one level down, so its template points at the shared static
    // assets by absolute path (see scripts/prepare-ui.mjs).
    template: ({ entryName }) =>
      entryName === PGBOSS_ENTRY ? './index.pg-boss.ejs' : './index.ejs',
    templateParameters: (_defaults, { entryName }) => {
      const pgBoss = entryName === PGBOSS_ENTRY;
      return {
        basePath: pgBoss ? PGBOSS_BASE : DEMO_BASE,
        title: pgBoss ? 'Worker Manager Demo' : 'Worker Manager Demo',
        favIconDefault: `${DEMO_BASE}favicon.ico`,
        favIconAlternative: `${DEMO_BASE}static/favicon-32x32.png`,
        uiConfig: JSON.stringify(pgBoss ? pgBossUiConfig : bullmqUiConfig),
      };
    },
  },
  resolve: {
    alias: {
      bullmq: false,
    },
  },
  output: {
    cleanDistPath: true,
  },
  server: {
    port: 5174,
    base: DEMO_BASE,
  },
  dev: {
    writeToDisk: true,
  },
});
