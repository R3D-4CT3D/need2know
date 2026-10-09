// End-to-end test: builds the Chrome extension, loads it into real Chromium, visits the test
// pages, and checks what the extension caught and what the pages could see. Usage: npm run test:e2e
//   CHROME_PATH=/path/to/chrome   use a specific Chromium (default: Playwright's own build;
//                                 install it with `npx playwright-core install chromium`)
//   HEADED=1                      show the browser window
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildReport } from '../src/shared/scoring.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const ext = root + 'dist/chrome';
// Own ports, so the suite can run while `npm run serve` is open on 8080/8081.
const PORTS = { WSS_SITE_PORT: '18080', WSS_TRACKER_PORT: '18081' };
const SITE = `http://localhost:${PORTS.WSS_SITE_PORT}/`;
const OTHER_SITE = `http://127.0.0.1:${PORTS.WSS_TRACKER_PORT}/`;

// Detection: page -> techniques that must be caught, plus optional exact score.
const CASES = [
  { path: 'fingerprinter.html', expect: ['canvas-fp', 'font-probe', 'audio-fp', 'webgl-gpu', 'hw-sweep', 'key-listen', 'webrtc'], score: 100 },
  { path: 'control.html', expect: ['canvas-read'], score: 2 },
  { path: 'escape.html?v=iframe', expect: ['canvas-fp'] },
  { path: 'escape.html?v=frames', expect: ['canvas-fp'] },
  { path: 'escape.html?v=srcdoc', expect: ['canvas-fp'] },
  { path: 'escape.html?v=dom-fonts', expect: ['font-probe'] },
  { path: 'escape.html?v=blob', expect: ['canvas-fp'] },
  { path: 'escape.html?v=data', expect: ['canvas-fp'] },
  { path: 'escape.html?v=fingerprintjs', expect: ['canvas-fp', 'font-probe', 'audio-fp'] },
];

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n      ${detail}` : ''}`);
}

execFileSync(process.execPath, [root + 'scripts/build.mjs', 'chrome'], { stdio: 'inherit' });
const server = spawn(process.execPath, [root + 'scripts/serve.mjs'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, ...PORTS } });
const exited = new Promise(r => server.on('exit', r));
const profile = mkdtempSync(tmpdir() + '/wss-e2e-');

try {
  // Make sure it's *our* server answering, with the FingerprintJS route, before testing anything.
  const up = async () => (await fetch(OTHER_SITE + 'vendor/fingerprintjs.js')).ok && (await fetch(SITE)).ok;
  for (let i = 0; ; i++) {
    if (await Promise.race([exited.then(() => 'exited'), new Promise(r => setTimeout(r, 100))]) === 'exited') {
      throw new Error('Test server failed to start');
    }
    if (await up().catch(() => false)) break;
    if (i > 50) throw new Error('Test server did not respond');
  }

  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROME_PATH || undefined,
    headless: !process.env.HEADED,
    // static.hotjar.com -> the local test server, so a stand-in recorder can load for real.
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP static.hotjar.com 127.0.0.1'],
  });
  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const extPage = async (path, waitFor) => {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`chrome-extension://${extId}/${path}`);
    if (waitFor) await page.waitForSelector(waitFor, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(500);
    return { page, errors };
  };

  // Scripts are registered by the background after install; wait until they are.
  const registered = () => sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map(s => s.id).sort().join(','));
  const waitForScripts = async want => {
    for (let i = 0; i < 50 && await registered() !== want; i++) await new Promise(r => setTimeout(r, 100));
  };
  await waitForScripts('wss-observe');
  const setSettings = async (settings, scripts) => {
    await sw.evaluate(s => chrome.storage.local.set({ settings: s }), settings);
    await waitForScripts(scripts);
  };

  // Visit a page, wait for it and the extension to settle, return the report and page result.
  async function visit(url) {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    await page.waitForSelector('#status[data-done], #status:not(:empty)', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500); // hooks flush every 300 ms, bridge every 500 ms, background every 250 ms
    const status = (await page.locator('#status').textContent().catch(() => '')) || '';
    const result = JSON.parse((await page.locator('#status').getAttribute('data-result').catch(() => null)) || 'null');
    const state = await sw.evaluate(async u => {
      const [tab] = await chrome.tabs.query({ url: u });
      return tab && (await chrome.storage.session.get('tab:' + tab.id))['tab:' + tab.id];
    }, url);
    await page.close();
    return { report: buildReport(state), result, status, errors };
  }
  const statusOf = (report, id) => report.items.find(i => i.id === id)?.status;

  console.log('\nDetection');
  for (const c of CASES) {
    const { report: r, status, errors } = await visit(SITE + c.path);
    const got = r.items.map(i => i.id);
    const missing = c.expect.filter(id => !got.includes(id));
    const problems = [
      missing.length && `missing: ${missing.join(', ')}`,
      c.score != null && r.score !== c.score && `score ${r.score}, expected ${c.score}`,
      ...errors.map(e => `page error: ${e}`),
      status.startsWith('error') && status,
    ].filter(Boolean);
    check(`${c.path.padEnd(30)} score ${String(r.score).padStart(3)}  ${got.join(', ') || '(nothing)'}`, !problems.length, problems.join('; '));
  }

  console.log('\nDefaults');
  const raw = await visit(SITE + 'protect.html');
  check('protection is off by default: real GPU, recorder not blocked', raw.result?.gpu && !/ Graphics/.test(raw.result.gpu) && statusOf(raw.report, 'canvas-fp') === 'active', raw.result?.gpu);
  check('GPC is on by default', raw.result?.gpc === true && raw.result?.gpcHeader === '1');

  console.log('\nPopup switch (the real flow: flip it, page reloads protected)');
  {
    const page = await ctx.newPage();
    await page.goto(SITE + 'protect.html');
    await page.waitForSelector('#status[data-done]');
    await page.waitForTimeout(1500);
    const tabId = await sw.evaluate(async u => (await chrome.tabs.query({ url: u }))[0].id, SITE + 'protect.html');
    const popup = await extPage(`popup/popup.html?tab=${tabId}`, '#shield:not([hidden])');
    const before = await popup.page.textContent('#shield-label');
    await popup.page.click('.switch');
    // The background saves, re-registers, then reloads the tab; wait for the fresh page.
    await page.waitForSelector('#status[data-done]', { timeout: 10000 });
    await page.waitForFunction(() => document.getElementById('status').dataset.done === '1' && performance.getEntriesByType('navigation')[0], null, { timeout: 10000 });
    await page.waitForTimeout(1500);
    const after = JSON.parse(await page.getAttribute('#status', 'data-result'));
    await popup.page.waitForTimeout(1200);
    const label = await popup.page.textContent('#shield-label');
    const mismatch = await popup.page.isVisible('#mismatch');
    check('switch turns protection on and the reloaded page is protected', before === 'Protection off' && / Graphics/.test(after.gpu) && after.canvas !== raw.result?.canvas, `${before} → ${after.gpu}`);
    check('popup agrees with the page (no "reload" warning)', label === 'Protection on' && !mismatch, `${label}, mismatch shown: ${mismatch}`);
    const sites = await sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings.sites);
    check('site saved as an override', sites?.localhost === 'on', JSON.stringify(sites));
    await Promise.all([page.close(), popup.page.close()]);
  }

  console.log('\nProtection (on by default)');
  await setSettings({ protectDefault: true }, 'wss-protect');
  const a1 = await visit(SITE + 'protect.html');
  const a2 = await visit(SITE + 'protect.html');
  const b = await visit(OTHER_SITE + 'protect.html');
  const A = a1.result ?? {};
  check('page measured without errors', a1.result && !a1.errors.length, a1.errors.join('; ') || a1.status);
  check('same site, same session: same canvas and audio', A.canvas === a2.result?.canvas && A.audio === a2.result?.audio, `${A.canvas}/${a2.result?.canvas}  ${A.audio}/${a2.result?.audio}`);
  check('different sites: different canvas and audio', A.canvas !== b.result?.canvas && A.audio !== b.result?.audio, `${A.canvas}/${b.result?.canvas}`);
  check('repeat reads agree (toDataURL twice, getImageData = export)', A.canvas === A.canvasAgain && A.pixelsMatchExport === true, `again ${A.canvas === A.canvasAgain}, export ${A.pixelsMatchExport}`);
  check('GPU name is generic', / Graphics/.test(A.gpu ?? ''), A.gpu);
  check('CPU cores are generic', A.cores === 4 || A.cores === 8, String(A.cores));
  check('GPC: navigator.globalPrivacyControl and Sec-GPC header', A.gpc === true && A.gpcHeader === '1', `${A.gpc} / ${A.gpcHeader}`);
  check('session recorder blocked', A.recorderLoaded === false && statusOf(a1.report, 'session-replay') === 'blocked', `${A.recorderLoaded} / ${statusOf(a1.report, 'session-replay')}`);
  // The real FingerprintJS library computes a "visitorId" meant to follow you everywhere.
  const fpId = v => v.status.match(/visitorId (\w+)/)?.[1];
  const [f1, f2, f3] = [await visit(SITE + 'escape.html?v=fingerprintjs'), await visit(SITE + 'escape.html?v=fingerprintjs'), await visit(OTHER_SITE + 'escape.html?v=fingerprintjs')];
  check('FingerprintJS visitorId: stable on one site', fpId(f1) && fpId(f1) === fpId(f2), `${fpId(f1)} / ${fpId(f2)}`);
  check('FingerprintJS visitorId: different on another site', fpId(f1) && fpId(f3) && fpId(f1) !== fpId(f3), `${fpId(f1)} / ${fpId(f3)}`);
  check('popup statuses: canvas neutralized, GPU neutralized', statusOf(a1.report, 'canvas-fp') === 'neutralized' && statusOf(a1.report, 'webgl-gpu') === 'neutralized');

  console.log('\nPer-site off (default on, localhost off)');
  await setSettings({ protectDefault: true, sites: { localhost: 'off' } }, 'wss-observe,wss-protect');
  const c1 = await visit(SITE + 'protect.html');
  const c2 = await visit(SITE + 'protect.html');
  const C = c1.result ?? {};
  check('real canvas value, stable across reloads', C.canvas && C.canvas !== A.canvas && C.canvas === c2.result?.canvas);
  console.log('      (unprotected round trip: ' + C.pixelsMatchExport + ')');
  check('real GPU name', C.gpu && !/ Graphics/.test(C.gpu), C.gpu);
  check('still detected, marked active', statusOf(c1.report, 'canvas-fp') === 'active', statusOf(c1.report, 'canvas-fp'));
  check('GPC still sent', C.gpc === true && C.gpcHeader === '1', `${C.gpc} / ${C.gpcHeader}`);
  const d = await visit(OTHER_SITE + 'protect.html');
  check('other sites still protected', d.result?.canvas === b.result?.canvas && / Graphics/.test(d.result?.gpu ?? ''));

  console.log('\nYour choices');
  await setSettings({ protectDefault: true, defenses: { canvas: false } }, 'wss-protect');
  {
    const e = await visit(SITE + 'protect.html');
    check('canvas noise off: real canvas, GPU still generic', e.result?.canvas === c1.result?.canvas && / Graphics/.test(e.result?.gpu ?? '') && statusOf(e.report, 'canvas-fp') === 'active' && statusOf(e.report, 'webgl-gpu') === 'neutralized', `${e.result?.canvas} vs ${c1.result?.canvas}`);
  }
  await setSettings({ protectDefault: true, allowedVendors: ['Hotjar'] }, 'wss-protect');
  {
    const page = await ctx.newPage();
    await page.goto(SITE + 'recorded.html');
    await page.waitForSelector('#status:not(:empty)');
    check('an allowed company loads even with blocking on', (await page.textContent('#status')) === 'recorder loaded', await page.textContent('#status'));
    await page.close();
  }

  console.log('\nMore controls');
  await setSettings({ privateMode: 'always' }, 'wss-private');
  {
    const p = await visit(SITE + 'protect.html');
    check('"always protect private windows": normal windows still get real values', p.result?.canvas === raw.result?.canvas && p.result?.gpu === raw.result?.gpu && !p.errors.length && statusOf(p.report, 'canvas-fp') === 'active', `${p.result?.gpu}; ${p.errors.join('; ')}`);
  }
  await setSettings({ protectDefault: true, pausedUntil: Date.now() + 3600000 }, 'wss-observe');
  {
    const page = await ctx.newPage();
    await page.goto(SITE + 'protect.html');
    await page.waitForSelector('#status[data-done]');
    const pausedGpu = JSON.parse(await page.getAttribute('#status', 'data-result')).gpu;
    const tabId = await sw.evaluate(async u => (await chrome.tabs.query({ url: u }))[0].id, SITE + 'protect.html');
    const popup = await extPage(`popup/popup.html?tab=${tabId}`, '#shield:not([hidden])');
    const label = await popup.page.textContent('#shield-label');
    await popup.page.click('[data-pause="0"]');
    await page.waitForTimeout(2500);
    await page.waitForSelector('#status[data-done]');
    const resumedGpu = JSON.parse(await page.getAttribute('#status', 'data-result')).gpu;
    check('paused: real values; "Resume protection" in the popup brings protection back', label === 'Protection paused' && pausedGpu === raw.result?.gpu && / Graphics/.test(resumedGpu ?? ''), `${label}: ${pausedGpu} → ${resumedGpu}`);
    await Promise.all([page.close(), popup.page.close()]);
  }
  await sw.evaluate(async () => {
    const { history = {} } = await chrome.storage.local.get('history');
    delete history.localhost;
    await chrome.storage.local.set({ history });
  });
  await setSettings({ historyExclude: ['localhost'] }, 'wss-observe');
  {
    await visit(SITE + 'fingerprinter.html');
    const hist = await sw.evaluate(async () => Object.keys((await chrome.storage.local.get('history')).history ?? {}));
    check('a never-recorded site stays out of history', !hist.includes('localhost'), JSON.stringify(hist));
  }
  {
    const { page, errors } = await extPage('options/options.html', '#defenses input');
    await page.setInputFiles('#import', { name: 'settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ settings: { protectDefault: true, badge: 'none', evil: 1 } })) });
    await page.waitForTimeout(800);
    const s = await sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
    check('import settings: applied, unknown keys dropped', s.protectDefault === true && s.badge === 'none' && !('evil' in s) && !errors.length, JSON.stringify(s));
    await page.close();
  }

  console.log('\nTyping warning');
  await setSettings({}, 'wss-observe');
  {
    const page = await ctx.newPage();
    await page.goto(SITE + 'recorded.html');
    await page.waitForSelector('#status:not(:empty)');
    await page.waitForTimeout(1500);
    const before = await page.evaluate(() => document.documentElement.lastElementChild?.style.zIndex);
    await page.click('#field');
    await page.waitForTimeout(300);
    // The notice lives in a closed shadow root: the page can see the host element, not its contents.
    const host = await page.evaluate(() => {
      const el = document.documentElement.lastElementChild;
      return { z: el?.style.zIndex, closed: el?.shadowRoot === null, text: el?.textContent };
    });
    check('recorder loaded unblocked, warning appears on focus', (await page.textContent('#status')) === 'recorder loaded' && before !== '2147483647' && host.z === '2147483647', JSON.stringify(host));
    check('warning is sealed in a closed shadow root', host.closed && host.text === '');
    await page.close();
  }

  console.log('\nPages');
  {
    const { page, errors } = await extPage('checkup/checkup.html', '.compare .res');
    const rows = await page.$$eval('.compare tr', trs => Object.fromEntries(trs.slice(1).map(tr => [tr.cells[0]?.textContent, tr.cells[4]?.textContent])));
    check('Checkup: canvas and audio change per site', rows['Canvas fingerprint']?.startsWith('Changes per site') && rows['Audio fingerprint']?.startsWith('Changes per site'), JSON.stringify(rows));
    // The real proof is Chrome's own setting, not our checkbox.
    await page.click('#ext-checks li:last-child button');
    let policy;
    for (let i = 0; i < 30; i++) {
      policy = await sw.evaluate(() => chrome.privacy.network.webRTCIPHandlingPolicy.get({}));
      if (policy.value === 'default_public_interface_only') break;
      await new Promise(r => setTimeout(r, 100));
    }
    check('Checkup "Turn on": WebRTC IP protection really applied in Chrome', policy.value === 'default_public_interface_only' && policy.levelOfControl === 'controlled_by_this_extension', JSON.stringify(policy));
    check('Checkup: GPU generalized, no page errors', rows['Graphics chip']?.startsWith('Generalized') && !errors.length, errors.join('; ') || rows['Graphics chip']);
    await page.close();
  }
  {
    const shop = await ctx.newPage();
    await shop.goto(SITE + 'shop.html');
    await shop.waitForTimeout(2500);
    const tabId = await sw.evaluate(async u => (await chrome.tabs.query({ url: u }))[0].id, SITE + 'shop.html');
    const report = await extPage(`report/report.html?tab=${tabId}`, '#hash:not(:empty)');
    const hash = await report.page.textContent('#hash');
    check('Evidence report: findings and SHA-256', /^[0-9a-f]{64}$/.test(hash) && (await report.page.$$('#rows tr')).length > 5 && !report.errors.length, report.errors.join('; ') || hash);
    const req = await extPage(`request/request.html?host=localhost&tab=${tabId}`, '#body');
    const letter = await req.page.inputValue('#body');
    const links = await req.page.$$eval('#where a', as => as.map(a => a.textContent));
    check('Deletion request: letter with evidence and the site\'s privacy links', letter.includes('Canvas fingerprinting') && letter.includes('127.0.0.1/tracker.js') && links.length === 2 && !req.errors.length, req.errors.join('; ') || JSON.stringify(links));
    await req.page.check('#sent');
    await req.page.waitForTimeout(300);
    const tracked = await req.page.textContent('#sent-when');
    check('Deletion request: "I\'ve sent it" records the reply deadline', /must reply by/.test(tracked), tracked);
    await Promise.all([shop.close(), report.page.close(), req.page.close()]);
  }
  {
    const { page, errors } = await extPage('history/history.html', '#rows tr');
    const followers = await page.$$eval('#bars li', lis => lis.map(li => li.textContent));
    const due = await page.$$eval('td.req', tds => tds.map(td => td.textContent));
    check('History: shows the reply deadline', due.some(t => /reply due/.test(t)), JSON.stringify(due));
    check('History: cross-site followers listed', followers.some(f => f.includes('hotjar.com')) && !errors.length, errors.join('; ') || JSON.stringify(followers));
    await page.close();
  }

  await ctx.close();
} finally {
  server.kill();
  rmSync(profile, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
