/**
 * Regenerates the documentation screenshots from the built demo.
 *
 *   yarn workspace @worker-manager/demo build
 *   yarn workspace @worker-manager/demo screenshots [--only name1,name2]
 *
 * Every shot gets a fresh browser context, so the MSW fixtures, the persisted settings and the
 * theme start from the same state each time. Motion is reduced and CSS animations are disabled,
 * so the frames are the settled UI rather than whatever an animation was doing at capture time.
 * A shot whose element cannot be found fails the run instead of writing a misleading image.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveDemo } from './serve.mjs';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = `${REPO}website/docs/public/screenshots/`;
const LEGACY_OUT = `${REPO}screenshots/`;

const DESKTOP = { width: 1440, height: 900 };
const TIMEOUT = 10_000;

/** The override documented in website/docs/recipes/whitelabel-theming.md. */
const VIOLET_THEME = {
  light: { primary: '#6d28d9', radius: '0.75rem' },
  dark: { primary: '#a78bfa' },
};

const NO_MOTION_CSS = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
  }
`;

const q = (name) => `queue/${encodeURIComponent(name)}`;

// ---- helpers shared by the shots ----------------------------------------------------------

async function settle(page, ms = 800) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(ms);
}

async function openJob(page, queueName, status, pill) {
  await page.goto(`${q(queueName)}?status=${status}`);
  const card = page.locator('[data-status]', { hasText: pill }).first();
  await card.waitFor({ timeout: TIMEOUT });
  await card.getByRole('link').first().click();
  await waitForJobPage(page);
}

async function waitForJobPage(page) {
  await page.waitForURL(/\/queue\/[^/]+\/[^/?]+/, { timeout: TIMEOUT });
  // The queue page stays mounted while the route transition runs, so wait until the only job
  // card left is the one the job page renders.
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-status]').length === 1 &&
      !!document.querySelector('[role=tab]'),
    null,
    { timeout: TIMEOUT }
  );
}

async function openFlow(page, queueName, jobName) {
  await page.goto(`${q(queueName)}?status=waiting-children`);
  await page
    .getByRole('link', { name: new RegExp(`${jobName}$`) })
    .first()
    .click();
  await waitForJobPage(page);
  const flow = flowCard(page);
  await flow.getByRole('button', { name: 'Fit the whole flow' }).waitFor({ timeout: TIMEOUT });
  await flow.scrollIntoViewIfNeeded();
  await flow.getByRole('button', { name: 'Fit the whole flow' }).click();
  return flow;
}

const flowCard = (page) =>
  page.locator('[data-slot=card]', { has: page.getByRole('heading', { name: 'Job flow' }) });

const chartCard = (page) =>
  page
    .locator('[data-slot=card]', { has: page.getByRole('tablist').filter({ hasText: 'Latency' }) })
    .first();

const dialog = (page) => page.getByRole('dialog').last();

async function openQueueInfo(page, queueName, section) {
  await page.goto(q(queueName));
  await page.getByRole('button', { name: 'Queue info' }).click();
  const info = dialog(page);
  await info.getByRole('heading', { name: 'Queue info' }).waitFor({ timeout: TIMEOUT });
  if (section) {
    await info.getByRole('button', { name: 'Overview' }).click();
    await info.getByRole('button', { name: section }).click();
  }
  return info;
}

/** The part of the page above the given locator's bottom edge, full width. */
async function clipAbove(page, locator, padding = 10) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('clip target has no bounding box');
  return { x: 0, y: 0, width: DESKTOP.width, height: Math.ceil(box.y + box.height + padding) };
}

// ---- the shots ------------------------------------------------------------------------------
//
// `path` is loaded first. `run` puts the page in the state the doc caption describes and returns
// what to capture: nothing for the viewport, a locator for an element, or `{ clip }`.

const shots = [
  { name: 'dashboard-overview', path: '', copyTo: 'overview.png' },
  { name: 'dashboard-overview-dark', path: '', theme: 'dark' },
  {
    name: 'grouped-overview',
    path: '',
    async run(page) {
      await page.getByText('Grouped', { exact: true }).click();
      await page.getByRole('main').getByText('3 · 1 paused').waitFor({ timeout: TIMEOUT });
    },
  },
  { name: 'sidebar-collapsed', path: '', settings: { sidebarCollapsed: true } },
  { name: 'mobile-overview', path: '', viewport: { width: 390, height: 844 }, scale: 2 },
  {
    name: 'queue-workers-overview',
    path: '',
    async run(page) {
      await page.getByText('No workers').first().waitFor({ timeout: TIMEOUT });
    },
  },
  {
    name: 'environment-badge',
    path: q('billing:charges'),
    async run(page) {
      return { clip: await clipAbove(page, page.locator('header[data-env-badge]'), 0) };
    },
  },
  {
    name: 'queue-detail-info-icon',
    path: q('billing:charges'),
    copyTo: 'dashboard.png',
    async run(page) {
      await page.getByRole('button', { name: 'Queue info' }).waitFor({ timeout: TIMEOUT });
    },
  },
  { name: 'queue-page-dark', path: q('billing:charges'), theme: 'dark' },
  {
    name: 'queue-metrics',
    path: q('billing:charges'),
    async run(page) {
      return chartCard(page);
    },
  },
  {
    name: 'historical-metrics-range',
    path: q('billing:charges'),
    async run(page) {
      const chart = chartCard(page);
      await chart.getByRole('button', { name: '30d' }).click();
      await settle(page);
      return chart;
    },
  },
  {
    name: 'job-latency-queue',
    path: q('notifications:push'),
    async run(page) {
      // Latency is recorded hourly, so the 60m range has nothing to draw.
      const chart = chartCard(page);
      await chart.getByRole('tab', { name: 'Latency' }).click();
      await chart.getByRole('button', { name: '7d' }).click();
      await chart.getByText('Oldest job waiting').waitFor({ timeout: TIMEOUT });
      await settle(page);
    },
  },
  {
    name: 'queue-rate-limited-badge',
    path: q('notifications:push'),
    async run(page) {
      await page
        .getByText(/rate limited/i)
        .first()
        .waitFor({ timeout: TIMEOUT });
      return {
        clip: await clipAbove(
          page,
          page.getByRole('link', { name: /^Latest/ }).locator('xpath=ancestor::ul[1]')
        ),
      };
    },
  },
  {
    name: 'queue-rate-limit-modal',
    path: q('notifications:push'),
    async run(page) {
      await page.getByRole('button', { name: 'Queue actions' }).click();
      await page.getByRole('menuitem', { name: /rate limit/i }).click();
      await dialog(page)
        .getByRole('button', { name: /save|apply/i })
        .first()
        .waitFor({ timeout: TIMEOUT });
    },
  },
  {
    name: 'queue-workers-queue-page',
    path: q('reports:export'),
    async run(page) {
      await page.getByText('No workers').first().waitFor({ timeout: TIMEOUT });
      return {
        clip: await clipAbove(
          page,
          page.getByRole('link', { name: /^Latest/ }).locator('xpath=ancestor::ul[1]')
        ),
      };
    },
  },
  {
    name: 'queue-info-modal',
    path: '',
    async run(page) {
      await openQueueInfo(page, 'notifications:push');
    },
  },
  {
    name: 'queue-workers-modal',
    path: '',
    async run(page) {
      const info = await openQueueInfo(page, 'notifications:push', 'Connected workers');
      await info
        .getByText(/10\.0\./)
        .first()
        .waitFor({ timeout: TIMEOUT });
    },
  },
  {
    name: 'queue-default-job-options',
    path: '',
    async run(page) {
      const info = await openQueueInfo(page, 'billing:charges', 'Default job options');
      await info.getByText('exponential').first().waitFor({ timeout: TIMEOUT });
    },
  },
  {
    name: 'add-job-schema',
    path: q('emails:welcome'),
    async run(page) {
      await page.getByRole('button', { name: 'Add job' }).click();
      await dialog(page).getByText('welcome-v2').first().waitFor({ timeout: TIMEOUT });
    },
  },
  {
    name: 'job-stalled-pills',
    path: '',
    async run(page) {
      await openJob(page, 'billing:charges', 'completed', 'stalled');
    },
  },
  {
    name: 'job-will-fail',
    path: '',
    async run(page) {
      await openJob(page, 'billing:charges', 'waiting', 'will fail');
    },
  },
  {
    name: 'job-deduplicated',
    path: '',
    async run(page) {
      await openJob(page, 'billing:charges', 'delayed', 'dedup');
    },
  },
  {
    name: 'job-reschedule',
    path: '',
    async run(page) {
      await openJob(page, 'billing:charges', 'delayed', 'dedup');
      await page.getByRole('button', { name: 'Reschedule' }).first().click();
      const reschedule = dialog(page);
      await reschedule.getByText('Run at').waitFor({ timeout: TIMEOUT });
      // Take focus off the date input so its first segment is not shown selected.
      await reschedule
        .locator('input')
        .first()
        .evaluate((input) => input.blur());
    },
  },
  {
    name: 'job-logs',
    path: '',
    async run(page) {
      await page.goto(`${q('reports:export')}?status=active`);
      await page.locator('[data-status]').first().getByRole('link').first().click();
      await waitForJobPage(page);
      await page.getByRole('tab', { name: 'Logs' }).click();
      await page.getByText('Starting batch 1 of 50').first().waitFor({ timeout: TIMEOUT });
    },
  },
  {
    name: 'flow-tree',
    path: '',
    async run(page) {
      return openFlow(page, 'reports:nightly', 'nightly-rollup');
    },
  },
  {
    name: 'flow-ignored-children',
    path: '',
    async run(page) {
      const flow = await openFlow(page, 'billing:refunds', 'batch-refund');
      await flow.getByText('1 ignored').first().waitFor({ timeout: TIMEOUT });
      return flow;
    },
  },
  {
    name: 'schedulers-page',
    path: 'job-schedulers',
    async run(page) {
      await page.getByText('daily-digest').first().waitFor({ timeout: TIMEOUT });
    },
  },
  {
    name: 'schedulers-timeline',
    path: 'job-schedulers',
    settings: { schedulersView: 'timeline', schedulersTimelineZoom: 'day' },
    async run(page) {
      await page.getByRole('region', { name: 'Scheduler timeline' }).waitFor({ timeout: TIMEOUT });
      return page.locator('[data-slot=card]').first();
    },
  },
  {
    name: 'historical-metrics-page',
    path: 'metrics-history',
    async run(page) {
      await page.getByRole('heading', { name: 'By queue' }).waitFor({ timeout: TIMEOUT });
    },
  },
  {
    name: 'metrics-activity',
    path: 'metrics-history',
    async run(page) {
      await page.getByRole('button', { name: '90d' }).click();
      const card = page.getByTestId('daily-activity');
      await card.getByRole('heading', { name: 'Daily activity' }).waitFor({ timeout: TIMEOUT });
      await settle(page);
      return card;
    },
  },
  {
    name: 'historical-metrics-menu',
    path: 'metrics-history',
    async run(page) {
      await page.getByRole('button', { name: 'Metrics history actions' }).click();
      await page.getByRole('menuitem', { name: 'Storage' }).waitFor({ timeout: TIMEOUT });
    },
  },
  {
    name: 'historical-metrics-storage',
    path: 'metrics-history',
    async run(page) {
      await page.getByRole('button', { name: 'Metrics history actions' }).click();
      await page.getByRole('menuitem', { name: 'Storage' }).click();
      await dialog(page).getByRole('table').waitFor({ timeout: TIMEOUT });
    },
  },
  {
    name: 'historical-metrics-storage-confirm',
    path: 'metrics-history',
    async run(page) {
      await page.getByRole('button', { name: 'Metrics history actions' }).click();
      await page.getByRole('menuitem', { name: 'Storage' }).click();
      await dialog(page).getByRole('button', { name: 'Clear all history' }).click();
      await page
        .getByRole('alertdialog')
        .or(page.getByRole('dialog', { name: /Delete recorded metrics history/ }))
        .first()
        .waitFor({ timeout: TIMEOUT });
    },
  },
  {
    name: 'settings-sections',
    path: '',
    async run(page) {
      await page.getByRole('button', { name: 'Settings' }).click();
      await dialog(page).waitFor({ timeout: TIMEOUT });
    },
  },
  // The completed tab brings the pagination and the bulk actions, so the selected tab, the
  // current page and the primary button all show the override.
  {
    name: 'whitelabel-violet-light',
    path: `${q('billing:charges')}?status=completed`,
    uiTheme: VIOLET_THEME,
  },
  {
    name: 'whitelabel-violet-dark',
    path: `${q('billing:charges')}?status=completed`,
    uiTheme: VIOLET_THEME,
    theme: 'dark',
  },
];

// ---- runner ---------------------------------------------------------------------------------

function parseOnly(argv) {
  const index = argv.indexOf('--only');
  if (index === -1) return null;
  const names = (argv[index + 1] ?? '').split(',').filter(Boolean);
  const unknown = names.filter((name) => !shots.some((shot) => shot.name === name));
  if (unknown.length) throw new Error(`Unknown screenshot(s): ${unknown.join(', ')}`);
  return new Set(names);
}

/** Adds `theme` to the uiConfig the built page carries, as `uiConfig.theme` would on a server. */
async function injectUiTheme(context, uiTheme) {
  await context.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    const response = await route.fetch();
    const html = await response.text();
    const patched = html.replace(
      /(<script id="__UI_CONFIG__" type="application\/json">)([\s\S]*?)(<\/script>)/,
      (_, open, json, close) => {
        const config = JSON.parse(json.replace(/&quot;/g, '"'));
        return `${open}${JSON.stringify({ ...config, theme: uiTheme })}${close}`;
      }
    );
    if (patched === html) throw new Error('uiConfig script not found in the demo page');
    await route.fulfill({ response, body: patched });
  });
}

async function capture(browser, baseUrl, shot) {
  const theme = shot.theme ?? 'light';
  const context = await browser.newContext({
    baseURL: baseUrl,
    viewport: shot.viewport ?? DESKTOP,
    deviceScaleFactor: shot.scale ?? 1,
    isMobile: !!shot.viewport,
    hasTouch: !!shot.viewport,
    colorScheme: theme,
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'UTC',
  });
  const settings = { language: 'en-US', theme, ...shot.settings };
  await context.addInitScript(
    (value) => {
      localStorage.setItem('board-settings', value);
    },
    JSON.stringify({ state: settings, version: 2 })
  );
  await context.addInitScript((css) => {
    const add = () => {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);
    };
    if (document.head) add();
    else document.addEventListener('DOMContentLoaded', add);
  }, NO_MOTION_CSS);
  if (shot.uiTheme) await injectUiTheme(context, shot.uiTheme);

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  try {
    await page.goto(shot.path);
    await page.locator('.wm-splash').waitFor({ state: 'detached', timeout: TIMEOUT });
    await page.getByRole('main').waitFor({ timeout: TIMEOUT });
    await settle(page);

    const target = (await shot.run?.(page)) ?? null;
    await settle(page);
    await page.mouse.move(0, 0);
    // Dialogs focus their first control on open, which would paint a focus ring in the shot.
    await page.evaluate(() => document.activeElement?.blur?.());
    await page
      .locator('[data-sonner-toast]')
      .waitFor({ state: 'detached', timeout: TIMEOUT })
      .catch(() => {});

    const file = `${OUT}${shot.name}.png`;
    if (target && typeof target.screenshot === 'function') {
      await target.screenshot({ path: file, timeout: TIMEOUT });
    } else {
      await page.screenshot({ path: file, ...(target?.clip ? { clip: target.clip } : {}) });
    }
    if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
    if (shot.copyTo) copyFileSync(file, `${LEGACY_OUT}${shot.copyTo}`);
    return file;
  } finally {
    await context.close();
  }
}

const only = parseOnly(process.argv.slice(2));
mkdirSync(OUT, { recursive: true });
mkdirSync(LEGACY_OUT, { recursive: true });

const server = await serveDemo(0);
const browser = await chromium.launch({
  args: ['--lang=en-US'],
  env: { ...process.env, LANG: 'en_US.UTF-8', LANGUAGE: 'en_US', LC_ALL: 'en_US.UTF-8' },
});
const failures = [];

try {
  for (const shot of shots) {
    if (only && !only.has(shot.name)) continue;
    try {
      const file = await capture(browser, server.url, shot);
      console.warn(`ok    ${shot.name}  ${file.replace(REPO, '')}`);
    } catch (error) {
      failures.push(shot.name);
      console.error(`FAIL  ${shot.name}: ${error.message.split('\n')[0]}`);
    }
  }
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error(`\n${failures.length} screenshot(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
