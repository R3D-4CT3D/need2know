// Serves test/pages on two origins so the test tracker counts as a third party:
//   http://localhost:8080   the "website"
//   http://127.0.0.1:8081   the "tracker company" (same files, different site)
// Usage: node scripts/serve.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../test/pages/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

async function handle(req, res) {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '');
  const file = join(root, path || 'index.html');
  if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

for (const port of [8080, 8081]) createServer(handle).listen(port, '127.0.0.1');
console.log('Test site:     http://localhost:8080\nFake tracker:  http://127.0.0.1:8081/tracker.js\nCtrl+C to stop.');
