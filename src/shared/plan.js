// Turns settings into the browser configuration background.js applies: which content scripts
// run where, and which network rules are on. Pure functions, so they're unit tested.
import { VENDORS } from './vendors.js';

const isIp = site => /^[\d.]+$/.test(site) || site.includes(':');

// Match patterns for a site and all its subdomains. Ports don't matter in match patterns.
export const sitePatterns = site => isIp(site) || site === 'localhost'
  ? [`*://${site}/*`]
  : [`*://${site}/*`, `*://*.${site}/*`];

const sitesSetTo = (s, mode) => Object.keys(s.sites).filter(site => s.sites[site] === mode).sort();

/* ---------- content scripts ---------- */

// One file per defense, so only the ones the user enabled are injected. core.js goes first
// and shares helpers; seal.js removes them before any page script runs.
export const DEFENSE_FILES = {
  canvas: 'content/protect/canvas.js',
  audio: 'content/protect/audio.js',
  gpu: 'content/protect/gpu.js',
  hardware: 'content/protect/hardware.js',
  device: 'content/protect/device.js',
};

export function protectFiles(s) {
  const on = Object.keys(DEFENSE_FILES).filter(k => s.defenses[k]);
  return on.length ? ['content/protect/core.js', ...on.map(k => DEFENSE_FILES[k]), 'content/protect/seal.js'] : [];
}

// Scripts in the page's world. Order inside `js` matters: protection runs before hooks.js so
// it wraps the native APIs first, and hooks.js still observes every call.
export function scriptPlan(s) {
  const gpc = s.gpc ? ['content/gpc.js'] : [];
  const base = { matches: ['<all_urls>'], runAt: 'document_start', allFrames: true, world: 'MAIN' };
  const observe = [...gpc, 'content/hooks.js'];
  const protect = [...gpc, ...protectFiles(s), 'content/hooks.js'];
  if (protect.length === observe.length) return [{ ...base, id: 'wss-observe', js: observe }];

  // The default applies everywhere except the sites set the other way.
  const exceptions = sitesSetTo(s, s.protectDefault ? 'off' : 'on').flatMap(sitePatterns);
  const [byDefault, byException] = s.protectDefault ? [protect, observe] : [observe, protect];
  const plan = [{ ...base, id: s.protectDefault ? 'wss-protect' : 'wss-observe', js: byDefault, ...(exceptions.length ? { excludeMatches: exceptions } : {}) }];
  if (exceptions.length) plan.push({ ...base, id: s.protectDefault ? 'wss-observe' : 'wss-protect', js: byException, matches: exceptions });
  return plan;
}

/* ---------- declarativeNetRequest ---------- */

export const RULESETS = {
  block_replay: { kinds: ['replay'], setting: 'blockReplay' },
  block_fingerprint: { kinds: ['fingerprint'], setting: 'blockFingerprinters' },
  block_fraud: { kinds: ['fraud', 'bot'], setting: 'blockFraud' },
};

// Static rule files, written into each build by scripts/build.mjs.
export function buildRulesets(vendors = VENDORS) {
  const out = {};
  for (const [id, { kinds }] of Object.entries(RULESETS)) {
    const domains = vendors.filter(v => kinds.includes(v.kind)).flatMap(v => v.domains).sort();
    // No resourceTypes: blocks everything except visiting the vendor's own site directly.
    out[id] = [{ id: 1, priority: 1, action: { type: 'block' }, condition: { requestDomains: domains } }];
  }
  out.gpc = [{
    id: 1, priority: 200, // above every allow rule, so GPC is sent even where protection is off
    action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Sec-GPC', operation: 'set', value: '1' }] },
    condition: { resourceTypes: ['main_frame', 'sub_frame', 'script', 'xmlhttprequest', 'image', 'stylesheet', 'font', 'media', 'ping', 'object', 'websocket', 'other'] },
  }];
  return out;
}

export function rulesetPlan(s) {
  const on = { gpc: s.gpc };
  for (const [id, { setting }] of Object.entries(RULESETS)) on[id] = !!s[setting];
  const ids = Object.keys(on);
  return { enableRulesetIds: ids.filter(id => on[id]), disableRulesetIds: ids.filter(id => !on[id]) };
}

// Blocking only happens on pages where protection is on. allowAllRequests on a page's main
// frame exempts everything that page loads, iframes included. Companies the user allowed are
// never blocked anywhere.
export const DYNAMIC_RULE_BASE = 1000;
export function dynamicRules(s) {
  const rules = [];
  const allowPages = condition => rules.push({
    id: DYNAMIC_RULE_BASE + rules.length, priority: 100,
    action: { type: 'allowAllRequests' },
    condition: { resourceTypes: ['main_frame'], ...condition },
  });
  if (s.protectDefault) {
    const off = sitesSetTo(s, 'off');
    if (off.length) allowPages({ requestDomains: off });
  } else {
    const on = sitesSetTo(s, 'on');
    allowPages(on.length ? { excludedRequestDomains: on } : {});
  }
  const allowed = VENDORS.filter(v => s.allowedVendors.includes(v.name)).flatMap(v => v.domains);
  if (allowed.length) {
    rules.push({ id: DYNAMIC_RULE_BASE + rules.length, priority: 50, action: { type: 'allow' }, condition: { requestDomains: allowed } });
  }
  return rules;
}
