import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptPlan, rulesetPlan, dynamicRules, buildRulesets, sitePatterns, protectFiles } from '../src/shared/plan.js';
import { normalize, siteMode, withSite, DEFAULTS } from '../src/shared/settings.js';

const settings = patch => normalize(patch);
const byId = plan => Object.fromEntries(plan.map(p => [p.id, p]));

test('protection is off by default: every page is observed, none protected', () => {
  assert.equal(DEFAULTS.protectDefault, false);
  const plan = scriptPlan(settings({}));
  assert.deepEqual(plan.map(p => p.id), ['wss-observe']);
  assert.ok(!plan[0].js.some(f => f.includes('protect')));
  assert.ok(plan[0].js.includes('content/hooks.js'));
});

test('default off, one site on: only that site is protected', () => {
  const { 'wss-observe': observe, 'wss-protect': protect } = byId(scriptPlan(settings({ sites: { 'bank.com': 'on' } })));
  assert.deepEqual(protect.matches, ['*://bank.com/*', '*://*.bank.com/*']);
  assert.deepEqual(observe.excludeMatches, protect.matches);
});

test('default on, one site off: everyone else is protected', () => {
  const { 'wss-observe': observe, 'wss-protect': protect } = byId(scriptPlan(settings({ protectDefault: true, sites: { 'bank.com': 'off' } })));
  assert.deepEqual(protect.matches, ['<all_urls>']);
  assert.deepEqual(protect.excludeMatches, ['*://bank.com/*', '*://*.bank.com/*']);
  assert.deepEqual(observe.matches, protect.excludeMatches);
});

test('protection runs before hooks.js: core first, enabled defenses, then seal', () => {
  const [main] = scriptPlan(settings({ protectDefault: true }));
  assert.deepEqual(main.js, ['content/gpc.js', 'content/protect/core.js', 'content/protect/canvas.js', 'content/protect/audio.js',
    'content/protect/gpu.js', 'content/protect/hardware.js', 'content/protect/device.js', 'content/protect/seal.js', 'content/hooks.js']);
  assert.equal(main.world, 'MAIN');
  assert.equal(main.runAt, 'document_start');
});

test('only enabled defenses are injected', () => {
  const files = protectFiles(settings({ defenses: { canvas: false, audio: false, device: false } }));
  assert.deepEqual(files, ['content/protect/core.js', 'content/protect/gpu.js', 'content/protect/hardware.js', 'content/protect/seal.js']);
  const none = { canvas: false, audio: false, gpu: false, hardware: false, device: false };
  assert.deepEqual(protectFiles(settings({ defenses: none })), []);
  assert.deepEqual(scriptPlan(settings({ protectDefault: true, defenses: none })).map(p => p.id), ['wss-observe']);
});

test('IP addresses and localhost get a single exact pattern', () => {
  assert.deepEqual(sitePatterns('127.0.0.1'), ['*://127.0.0.1/*']);
  assert.deepEqual(sitePatterns('localhost'), ['*://localhost/*']);
});

test('blocking only happens where protection is on', () => {
  const offByDefault = dynamicRules(settings({}));
  assert.equal(offByDefault[0].action.type, 'allowAllRequests');
  assert.deepEqual(offByDefault[0].condition, { resourceTypes: ['main_frame'] }, 'every page exempt');
  const oneOn = dynamicRules(settings({ sites: { 'news.com': 'on' } }));
  assert.deepEqual(oneOn[0].condition.excludedRequestDomains, ['news.com']);
  const onByDefault = dynamicRules(settings({ protectDefault: true, sites: { 'bank.com': 'off' } }));
  assert.deepEqual(onByDefault[0].condition.requestDomains, ['bank.com']);
  assert.deepEqual(dynamicRules(settings({ protectDefault: true })), [], 'nothing exempt');
});

test('allowed companies are never blocked', () => {
  const rules = dynamicRules(settings({ protectDefault: true, allowedVendors: ['Hotjar'] }));
  assert.equal(rules[0].action.type, 'allow');
  assert.deepEqual(rules[0].condition.requestDomains, ['hotjar.com', 'hotjar.io']);
  assert.ok(rules[0].priority > buildRulesets().block_replay[0].priority);
});

test('rulesets follow settings; fraud blocking is off by default; GPC outranks every allow rule', () => {
  const plan = rulesetPlan(settings({}));
  assert.deepEqual(plan.enableRulesetIds.sort(), ['block_fingerprint', 'block_replay', 'gpc']);
  assert.deepEqual(plan.disableRulesetIds, ['block_fraud']);
  const sets = buildRulesets();
  for (const r of dynamicRules(settings({ allowedVendors: ['Hotjar'] }))) assert.ok(sets.gpc[0].priority > r.priority);
});

test('generated blocklists come from the vendor list', () => {
  const sets = buildRulesets();
  assert.ok(sets.block_replay[0].condition.requestDomains.includes('hotjar.com'));
  assert.ok(sets.block_fingerprint[0].condition.requestDomains.includes('fpjs.io'));
  assert.ok(sets.block_fraud[0].condition.requestDomains.includes('datadome.co'));
  assert.ok(!sets.block_replay[0].condition.resourceTypes, 'never blocks visiting the vendor site itself');
});

test('site modes and overrides', () => {
  const s = settings({ sites: { 'news.com': 'on' } });
  assert.deepEqual(siteMode(s, 'news.com'), { on: true, custom: 'on' });
  assert.deepEqual(siteMode(s, 'other.com'), { on: false, custom: null });
  assert.deepEqual(withSite(s, 'news.com', false), {}, 'matching the default removes the override');
  assert.deepEqual(withSite(s, 'bank.com', true), { 'news.com': 'on', 'bank.com': 'on' });
});

test('old allowlist settings migrate to per-site "off"', () => {
  const s = normalize({ protect: true, allowlist: ['bank.com'] });
  assert.deepEqual(s.sites, { 'bank.com': 'off' });
  assert.ok(!('allowlist' in s) && !('protect' in s));
  assert.equal(s.defenses.canvas, true);
});
