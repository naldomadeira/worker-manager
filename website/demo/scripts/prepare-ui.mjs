import { copyFileSync, cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const demoRoot = resolve(__dirname, '..');
const repoRoot = resolve(demoRoot, '..', '..');
const uiDist = resolve(repoRoot, 'packages/ui/dist');
const uiDistStatic = resolve(uiDist, 'static');
const demoPublicStatic = resolve(demoRoot, 'public/static');

if (!existsSync(uiDistStatic)) {
  console.warn('[demo] @worker-manager/ui dist not found, building...');
  execSync('yarn workspace @worker-manager/ui build', {
    cwd: repoRoot,
    stdio: 'inherit',
  });
}

if (!existsSync(uiDistStatic)) {
  throw new Error(`UI build did not produce ${uiDistStatic}`);
}

if (existsSync(demoPublicStatic)) {
  rmSync(demoPublicStatic, { recursive: true });
}
cpSync(uiDistStatic, demoPublicStatic, { recursive: true });
cpSync(join(uiDist, 'index.ejs'), 'index.ejs');
console.warn(`[demo] Copied UI static assets into ${demoPublicStatic}`);

// The pg-boss board is a second page, one level down at pg-boss/. Its <base> points there, so
// the API calls and the router resolve under it, but the bundle is the same one: its template
// loads the shared assets by absolute path instead of relative to <base>.
const template = readFileSync(join(uiDist, 'index.ejs'), 'utf8');
const pgBossTemplate = template.replace(
  /(href|src)="static\//g,
  '$1="/worker-manager/demo/static/'
);
writeFileSync(resolve(demoRoot, 'index.pg-boss.ejs'), pgBossTemplate);

// i18next fetches the locales relative to <base>, so they are the one asset the pg-boss page
// needs a copy of under its own path.
const pgBossLocales = resolve(demoRoot, 'public/pg-boss/static/locales');
if (existsSync(resolve(demoRoot, 'public/pg-boss'))) {
  rmSync(resolve(demoRoot, 'public/pg-boss'), { recursive: true });
}
cpSync(join(uiDistStatic, 'locales'), pgBossLocales, { recursive: true });
console.warn(`[demo] Wrote index.pg-boss.ejs and copied the locales into ${pgBossLocales}`);

// Bundle the project logo and favicon inside the demo so it renders even when
// served standalone (outside the docs site). See index.html.template for refs.
const logoSrc = resolve(repoRoot, 'packages/ui/src/static/images/logo.svg');
const logoDest = resolve(demoRoot, 'public/logo.svg');
if (existsSync(logoSrc)) {
  copyFileSync(logoSrc, logoDest);
  console.warn(`[demo] Copied project logo to ${logoDest}`);
}

const faviconSrc = resolve(repoRoot, 'packages/ui/src/static/favicon.ico');
const faviconDest = resolve(demoRoot, 'public/favicon.ico');
if (existsSync(faviconSrc)) {
  copyFileSync(faviconSrc, faviconDest);
  console.warn(`[demo] Copied favicon to ${faviconDest}`);
}
