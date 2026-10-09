// Serves test/pages on two origins so the test tracker counts as a third party:
//   http://localhost:8080   the "website"
//   http://127.0.0.1:8081   the "tracker company" (same files, different site)
// Usage: node scripts/serve.mjs
//   WSS_SITE_PORT / WSS_TRACKER_PORT choose other ports (the e2e test uses 18080/18081, so it can
//   run while you have this server open). Test pages are written with 8080/8081; the server
//   rewrites those to the chosen ports.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../test/pages/', import.meta.url));
const SITE_PORT = Number(process.env.WSS_SITE_PORT) || 8080;
const TRACKER_PORT = Number(process.env.WSS_TRACKER_PORT) || 8081;
const retarget = body => SITE_PORT === 8080 && TRACKER_PORT === 8081 ? body
  : Buffer.from(body.toString('utf8').replaceAll(':8081', `:${TRACKER_PORT}`).replaceAll('localhost:8080', `localhost:${SITE_PORT}`));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
// The real, open-source FingerprintJS library (a dev dependency), used as a live test target.
const ALIASES = {
  'vendor/fingerprintjs.js': fileURLToPath(new URL('../node_modules/@fingerprintjs/fingerprintjs/dist/fp.umd.min.js', import.meta.url)),
};

async function handle(req, res) {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '');
  if (path === 'headers') { // echoes request headers, to check what the browser actually sent
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(req.headers));
    return;
  }
  if (ALIASES[path]) {
    readFile(ALIASES[path])
      .then(body => res.writeHead(200, { 'content-type': TYPES['.js'], 'cache-control': 'no-store' }).end(body))
      .catch(() => res.writeHead(404).end('Run npm install first'));
    return;
  }
  const file = join(root, path || 'index.html');
  if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) { res.writeHead(403).end(); return; }
  try {
    const raw = await readFile(file);
    const body = /\.(html|js)$/.test(file) ? retarget(raw) : raw;
    const headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' };
    // ?csp=strict serves a page whose CSP forbids blob: workers, like many large sites.
    if (new URL(req.url, 'http://x').searchParams.get('csp') === 'strict') headers['content-security-policy'] = "worker-src 'self'";
    res.writeHead(200, headers).end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

for (const port of [SITE_PORT, TRACKER_PORT]) {
  createServer(handle).on('error', e => {
    console.error(`Can't listen on port ${port}: ${e.code}. Is another test server still running?`);
    process.exit(1);
  }).listen(port, '127.0.0.1');
}
console.log(`Test site:     http://localhost:${SITE_PORT}\nFake tracker:  http://127.0.0.1:${TRACKER_PORT}/tracker.js\nCtrl+C to stop.`);
