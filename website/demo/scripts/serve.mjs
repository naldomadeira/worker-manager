/**
 * A tiny static server for the built demo, mounted under the same base path GitHub Pages uses,
 * with the SPA fallback the board's client-side routes need. Used by the screenshot script;
 * `node scripts/serve.mjs` also runs it on its own.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASE = '/worker-manager/demo/';
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export function serveDemo(port = 0) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith(BASE)) {
      res.writeHead(302, { location: BASE }).end();
      return;
    }
    const relative = normalize(decodeURIComponent(url.pathname.slice(BASE.length))).replace(/^(\.\.[/\\])+/, '');
    let file = join(DIST, relative);
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });

  return new Promise((resolve) =>
    server.listen(port, '127.0.0.1', () => {
      const { port: actual } = server.address();
      resolve({ url: `http://127.0.0.1:${actual}${BASE}`, close: () => server.close() });
    })
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await serveDemo(Number(process.env.PORT ?? 4600));
  console.warn(`Demo on ${url}`);
}
