// Builds one unpacked extension per browser engine from the same src/ folder.
//   dist/chrome   Chrome, Edge, Brave, Opera, Vivaldi (all Chromium)
//   dist/firefox  Firefox 128+
// Usage: node scripts/build.mjs [chrome|firefox ...]
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = root + 'src/';
const pkg = JSON.parse(await readFile(root + 'package.json', 'utf8'));
const base = JSON.parse(await readFile(src + 'manifest.json', 'utf8'));
base.version = pkg.version; // package.json is the single source of truth for the version

const TARGETS = {
  chrome: m => m,

  firefox: m => {
    const out = structuredClone(m);
    // Firefox has no extension service workers; it runs the same file as a non-persistent
    // event page. Chrome 121+ would accept both keys, but older Firefox rejects service_worker.
    out.background = { scripts: [m.background.service_worker], type: 'module' };
    delete out.minimum_chrome_version;
    out.browser_specific_settings = {
      gecko: {
        id: 'what-sites-see@need2know',
        strict_min_version: '128.0', // first version with world: "MAIN" content scripts
        data_collection_permissions: { required: ['none'] },
      },
    };
    return out;
  },
};

const wanted = process.argv.slice(2);
for (const name of wanted.length ? wanted : Object.keys(TARGETS)) {
  if (!TARGETS[name]) throw new Error(`Unknown target "${name}". Use: ${Object.keys(TARGETS).join(', ')}`);
  const out = `${root}dist/${name}/`;
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await cp(src, out, { recursive: true, filter: f => !f.endsWith('manifest.json') });
  await writeFile(out + 'manifest.json', JSON.stringify(TARGETS[name](base), null, 2) + '\n');
  console.log(`built dist/${name}`);
}
