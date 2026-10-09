import test from 'node:test';
import assert from 'node:assert/strict';
import { adviceFor, browserTip, detectBrowser, HARDEN, BROWSERS } from '../src/shared/guides.js';
import { normalize } from '../src/shared/settings.js';

const settings = patch => normalize(patch);
const item = (id, status) => ({ id, status });

test('stopped items say how they were stopped', () => {
  const a = adviceFor(item('canvas-fp', 'neutralized'), 'chrome', { settings: settings() });
  assert.match(a.done, /noise or a generic answer/);
  assert.deepEqual(a.steps, []);
  assert.match(adviceFor(item('session-replay', 'blocked'), 'chrome', { settings: settings() }).done, /blocked/);
});

test('advice is tailored to the browser', () => {
  const ff = adviceFor(item('font-probe', 'active'), 'firefox', { settings: settings() });
  assert.ok(ff.steps.some(s => /Strict/.test(s) && /fonts/.test(s)));
  const edge = adviceFor(item('font-probe', 'active'), 'edge', { settings: settings() });
  assert.ok(!edge.steps.some(s => /Firefox/.test(s)));
  assert.match(browserTip('edge'), /Tracking prevention/);
  assert.match(browserTip('chrome'), /uBlock Origin Lite/);
});

test('points at the extension setting that would have stopped it', () => {
  const on = { siteOn: true };
  assert.match(adviceFor(item('canvas-fp', 'active'), 'chrome', { settings: settings(), siteOn: false }).steps[0], /off for this site/);
  assert.match(adviceFor(item('session-replay', 'active'), 'chrome', { settings: settings({ blockReplay: false }), ...on }).steps[0], /Block session recorders/);
  assert.match(adviceFor(item('canvas-fp', 'active'), 'chrome', { settings: settings({ defenses: { canvas: false } }), ...on }).steps[0], /Canvas noise/);
  const allowed = { id: 'session-replay', status: 'active', scripts: [{ vendor: 'Hotjar' }] };
  assert.match(adviceFor(allowed, 'chrome', { settings: settings({ allowedVendors: ['Hotjar'] }), ...on }).steps[0], /You allowed Hotjar/);
});

test('every browser has a hardening checklist', () => {
  for (const b of Object.keys(BROWSERS)) assert.ok(HARDEN[b]?.length, b);
});

test('detectBrowser reads the user agent and Brave\'s marker', async () => {
  assert.equal(await detectBrowser({ userAgent: 'Mozilla/5.0 Firefox/140.0' }), 'firefox');
  assert.equal(await detectBrowser({ userAgent: 'Chrome/150 Safari/537.36 Edg/150.0' }), 'edge');
  assert.equal(await detectBrowser({ userAgent: 'Chrome/150', brave: { isBrave: async () => true } }), 'brave');
  assert.equal(await detectBrowser({ userAgent: 'Chrome/150 Safari/537.36' }), 'chrome');
});
