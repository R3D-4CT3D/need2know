// Measures fingerprinting on real websites with the extension itself, then checks whether
// protection breaks them. Results go to data/crawl-<date>.json; scripts/crawl-report.mjs turns
// them into docs/findings.md and the stats the extension shows.
//
// Usage: node scripts/crawl.mjs [--sites 100] [--concurrency 4] [--candidates 250]
//   CHROME_PATH=/path/to/chrome   Chromium to use (default: Playwright's)
//
// Method
//   - Sites: the Tranco research list (tranco-list.eu), in rank order, keeping the first N
//     domains whose homepage loads an actual web page (the list also contains CDNs and APIs).
//   - Pass 1, measurement: protection off, detection on. Load the homepage, wait, scroll to the
//     bottom like a reader would, wait again, read the extension's report.
//   - Pass 2, breakage: the same sites with protection on everywhere; compare with pass 1.
//   - Homepages only, no logins, no typing, at most `concurrency` pages at once.
//   - A normal Chrome user agent instead of "HeadlessChrome", as is standard in web
//     measurement research, so sites serve what real visitors get.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildReport } from '../src/shared/scoring.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const ext = root + 'dist/chrome';
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : fallback; };
const WANT = arg('sites', 100);
const CANDIDATES = arg('candidates', 250);
const CONCURRENCY = arg('concurrency', 4);
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Bot-protection interstitials (Cloudflare, DataDome, Akamai...), not the site itself.
const CHALLENGE = /just a moment|attention required|access denied|are you a robot|verify you are human|captcha|request blocked/i;

/* ---------- the site list ---------- */
const listId = (await (await fetch('https://tranco-list.eu/top-1m-id')).text()).trim();
const csv = await (await fetch(`https://tranco-list.eu/download/${listId}/${CANDIDATES}`)).text();
const candidates = csv.trim().split('\n').map(line => { const [rank, domain] = line.trim().split(','); return { rank: Number(rank), domain }; });
console.log(`Tranco list ${listId}: ${candidates.length} candidates, want ${WANT} working sites`);

/* ---------- browser with the extension ---------- */
execFileSync(process.execPath, [root + 'scripts/build.mjs', 'chrome'], { stdio: 'inherit' });
const profile = mkdtempSync(tmpdir() + '/wss-crawl-');
const launch = userAgent => chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROME_PATH || undefined,
  headless: true,
  userAgent,
  viewport: { width: 1366, height: 900 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
let ctx = await launch();
const probe = await ctx.newPage();
const ua = (await probe.evaluate(() => navigator.userAgent)).replace('HeadlessChrome', 'Chrome');
const browserVersion = ua.match(/Chrome\/([\d.]+)/)?.[1];
await ctx.close();
ctx = await launch(ua);
let [sw] = ctx.serviceWorkers();
sw ??= await ctx.waitForEvent('serviceworker');
const extensionVersion = await sw.evaluate(() => chrome.runtime.getManifest().version);

async function setSettings(settings, want) {
  await sw.evaluate(s => chrome.storage.local.set({ settings: s }), settings);
  for (let i = 0; i < 50; i++) {
    const ids = await sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map(s => s.id).sort().join(','));
    if (ids === want) return;
    await sleep(100);
  }
  throw new Error(`scripts never became ${want}`);
}

/* ---------- one visit ---------- */
async function visit(domain) {
  const page = await ctx.newPage();
  const errors = new Set();
  page.on('pageerror', e => errors.add(String(e.message).slice(0, 200)));
  const result = { domain, ok: false };
  try {
    const response = await page.goto(`https://${domain}/`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
    await sleep(3000);
    await page.evaluate(async () => {
      for (let i = 0; i < 5; i++) { scrollBy(0, innerHeight); await new Promise(r => setTimeout(r, 400)); }
    }).catch(() => {});
    await sleep(2500);
    const info = await page.evaluate(() => ({
      title: document.title,
      elements: document.getElementsByTagName('*').length,
      text: (document.body?.innerText || '').length,
    }));
    const finalUrl = page.url();
    const state = await sw.evaluate(async u => {
      const tab = (await chrome.tabs.query({})).find(t => t.url === u);
      return tab && (await chrome.storage.session.get('tab:' + tab.id))['tab:' + tab.id];
    }, finalUrl);
    const html = (response?.headers()['content-type'] || '').includes('html');
    result.challenge = CHALLENGE.test(info.title) || (info.elements < 15 && info.text < 200);
    result.ok = !result.challenge && !!response && response.status() < 400 && html && (info.text > 200 || info.elements > 100);
    result.status = response?.status() ?? null;
    result.url = finalUrl;
    result.title = info.title.slice(0, 120);
    result.elements = info.elements;
    if (state) {
      const r = buildReport(state);
      result.score = r.score;
      result.grade = r.grade;
      result.techniques = r.items.map(i => ({ id: i.id, status: i.status, count: i.count, thirdParty: i.scripts.some(s => s.thirdParty) }));
      result.vendors = [...new Set(r.items.flatMap(i => i.scripts.map(s => s.vendor)).filter(Boolean))];
      result.thirdPartySites = r.thirdPartySites.length;
    }
  } catch (e) {
    result.error = String(e.message).split('\n')[0].slice(0, 200);
  } finally {
    result.pageErrors = [...errors];
    await page.close().catch(() => {});
  }
  return result;
}

async function pool(items, worker, label) {
  const out = new Array(items.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i], i);
      if (++done % 10 === 0) console.log(`  ${label}: ${done}/${items.length}`);
    }
  }));
  return out;
}

/* ---------- pass 1: measurement, protection off ---------- */
await setSettings({ protectDefault: false, gpc: false }, 'wss-observe');
const measured = [];
for (let start = 0; start < candidates.length && measured.filter(s => s.ok).length < WANT; start += CONCURRENCY * 5) {
  const batch = candidates.slice(start, start + CONCURRENCY * 5);
  const results = await pool(batch, async c => ({ rank: c.rank, ...(await visit(c.domain)) }), 'measure');
  measured.push(...results);
  console.log(`measured ${measured.length} candidates, ${measured.filter(s => s.ok).length} working sites`);
}
const sites = measured.filter(s => s.ok).slice(0, WANT);

/* ---------- pass 2: breakage, protection on ---------- */
await setSettings({ protectDefault: true, gpc: false }, 'wss-protect');
const protectedRuns = await pool(sites, s => visit(s.domain), 'protect');
sites.forEach((s, i) => {
  const p = protectedRuns[i];
  const newErrors = p.pageErrors.filter(e => !s.pageErrors.includes(e));
  const reasons = [];
  if (p.challenge) s.protectedChallenge = true; // a bot check, reported separately: see docs/findings.md
  else if (!p.ok) reasons.push(p.error ? `failed to load: ${p.error}` : 'no longer looked like a page');
  if (newErrors.length >= 2) reasons.push(`${newErrors.length} new page errors`);
  if (p.ok && s.elements && p.elements < s.elements * 0.6) reasons.push(`${Math.round((1 - p.elements / s.elements) * 100)}% fewer page elements`);
  s.protected = {
    ok: p.ok, title: p.title, score: p.score, elements: p.elements, newErrors: newErrors.slice(0, 5), possibleBreakage: reasons,
    techniques: (p.techniques ?? []).map(({ id, status }) => ({ id, status })),
  };
});

await ctx.close();
rmSync(profile, { recursive: true, force: true });

const date = new Date().toISOString().slice(0, 10);
const out = {
  meta: {
    date, tranco: listId, candidatesTried: measured.length, sites: sites.length,
    extensionVersion, browser: `Chromium ${browserVersion}`, concurrency: CONCURRENCY,
    method: 'Homepage, wait for load + 3 s, scroll to bottom, wait 2.5 s. Pass 1 detection only; pass 2 with protection on everywhere.',
  },
  sites,
  skipped: measured.filter(s => !s.ok).map(({ rank, domain, status, error }) => ({ rank, domain, status, error })),
};
await mkdir(root + 'data', { recursive: true });
await writeFile(`${root}data/crawl-${date}.json`, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote data/crawl-${date}.json: ${sites.length} sites, ${out.skipped.length} skipped`);
