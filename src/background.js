// Keeps one report per tab, paints the toolbar badge, remembers which sites fingerprinted you,
// and turns settings into browser configuration (content scripts and network rules).
// Chromium runs this as a service worker and Firefox as an event page; both can be shut down
// when idle, so tab state lives in storage.session rather than only in memory.
import { api } from './shared/api.js';
import { buildReport, GRADES } from './shared/scoring.js';
import { hostOf, siteOf } from './shared/domain.js';
import { loadSettings, saveSettings, withSite } from './shared/settings.js';
import { VENDORS } from './shared/vendors.js';
import { scriptPlan, rulesetPlan, dynamicRules, DYNAMIC_RULE_BASE } from './shared/plan.js';

const HISTORY_LIMIT = 500;
const tabs = new Map();    // tabId -> { url, doc, incognito, frames: { frameId: {...} } }
const pending = new Map(); // tabId -> timer

const ready = api.storage.session.get(null).then(all => {
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith('tab:')) tabs.set(Number(key.slice(4)), value);
  }
}).catch(() => {});

/* ---------- applying settings ---------- */

// Chromium can run page scripts inside blob: and data: frames; Firefox doesn't support the
// option, so registration is retried without it.
async function registerScripts(settings) {
  await api.scripting.unregisterContentScripts().catch(() => {});
  const plan = scriptPlan(settings);
  try {
    await api.scripting.registerContentScripts(plan.map(s => ({ ...s, matchOriginAsFallback: true })));
  } catch {
    await api.scripting.registerContentScripts(plan);
  }
}

async function updateNetworkRules(settings) {
  await api.declarativeNetRequest.updateEnabledRulesets(rulesetPlan(settings));
  const old = await api.declarativeNetRequest.getDynamicRules();
  await api.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: old.filter(r => r.id >= DYNAMIC_RULE_BASE).map(r => r.id),
    addRules: dynamicRules(settings),
  });
}

// Keep WebRTC on the default public interface: video calls work, but a page can't discover
// your other network addresses, such as your real IP behind a VPN.
async function updateWebRTC(settings) {
  const policy = api.privacy?.network?.webRTCIPHandlingPolicy;
  if (!policy) return;
  if (settings.webrtc) await policy.set({ value: 'default_public_interface_only' });
  else await policy.clear({});
}

// Settings are read often (every page, every badge), so keep a copy in memory.
let current = loadSettings(api);
let applying = Promise.resolve();
function applySettings() {
  applying = applying.then(async () => {
    const settings = await (current = loadSettings(api));
    await Promise.all([
      pruneHistory(settings),
      registerScripts(settings),
      updateNetworkRules(settings),
      updateWebRTC(settings).catch(() => {}),
    ]);
  }).catch(e => console.error('What Sites See: applying settings failed', e));
  return applying;
}

api.runtime.onInstalled.addListener(({ reason }) => {
  applySettings();
  // First install: open the Checkup so people see what's on and what's left to do.
  if (reason === 'install') api.tabs.create({ url: api.runtime.getURL('checkup/checkup.html') });
});
// Chrome keeps registered scripts across restarts; re-register only if they're missing.
api.runtime.onStartup.addListener(async () => {
  const registered = await api.scripting.getRegisteredContentScripts().catch(() => []);
  if (!registered.length) applySettings();
});
api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) applySettings();
});

async function setSite(site, on, tabId) {
  const settings = await current;
  await saveSettings(api, { sites: withSite(settings, site, on) });
  await applySettings();
  if (Number.isInteger(tabId)) await api.tabs.reload(tabId);
}

/* ---------- per-site noise seeds ---------- */
// One random secret per browser session; each site's seed is a hash of the secret and the
// top-level site. Same site → same seed for the whole session; different sites can't be linked.
let secret = null;
async function seedFor(sender) {
  if (!secret) {
    ({ secret } = await api.storage.session.get('secret'));
    if (!secret) {
      secret = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
      await api.storage.session.set({ secret });
    }
  }
  const topUrl = sender.frameId === 0 ? sender.url : (sender.tab?.url || sender.url);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret + '|' + siteOf(hostOf(topUrl))));
  return new DataView(digest).getUint32(0);
}

/* ---------- messages from content scripts ---------- */

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object' || sender.id !== api.runtime.id) return;
  if (msg.type === 'seed') {
    seedFor(sender).then(sendResponse, () => sendResponse(null));
    return true; // keep the channel open for the async reply
  }
  if (msg.type === 'set-site' && typeof msg.site === 'string') {
    // From the popup. Reloading only after the new scripts and rules are registered avoids a
    // race where the page reloads with the old configuration.
    setSite(msg.site, msg.on === true, msg.tabId).then(() => sendResponse(true), () => sendResponse(false));
    return true;
  }
  const tabId = sender.tab?.id;
  if (tabId == null || tabId < 0) return;
  if (msg.type === 'block-recorders') {
    // From the typing warning: protect this site with recorder blocking, then reload.
    const site = siteOf(hostOf(sender.tab.url));
    const recorders = new Set(VENDORS.filter(v => v.kind === 'replay').map(v => v.name));
    current.then(s => saveSettings(api, { blockReplay: true, sites: { ...s.sites, [site]: 'on' }, allowedVendors: s.allowedVendors.filter(n => !recorders.has(n)) }))
      .then(() => applySettings())
      .then(() => api.tabs.reload(tabId))
      .catch(() => {});
    return;
  }
  Promise.all([ready, current]).then(([, settings]) => receive(msg, sender, tabId, settings));
});

api.tabs.onRemoved.addListener(tabId => {
  tabs.delete(tabId);
  api.storage.session.remove('tab:' + tabId).catch(() => {});
});

const strings = (a, max = 300) => Array.isArray(a) ? a.filter(x => typeof x === 'string').slice(0, max) : [];

function receive(msg, sender, tabId, settings) {
  if (msg.type === 'page') {
    if (sender.frameId !== 0) return;
    // Which defenses this page loaded with, so the report doesn't claim more than it got.
    const defenses = Object.keys(settings.defenses).filter(k => settings.defenses[k]);
    tabs.set(tabId, { url: String(msg.url), doc: msg.doc, incognito: !!sender.tab.incognito, defenses, frames: {} });
  } else if (msg.type === 'snap') {
    const st = tabs.get(tabId);
    if (!st) return;
    if (sender.frameId === 0 && msg.doc !== st.doc) return; // late message from the previous page
    const links = sender.frameId === 0 && msg.links && typeof msg.links === 'object' ? msg.links : {};
    st.frames[sender.frameId] = {
      url: String(msg.url),
      snap: msg.snap && typeof msg.snap === 'object' ? msg.snap : {},
      hosts: strings(msg.hosts),
      failed: strings(msg.failed),
      protect: msg.protect === true,
      links: { privacy: typeof links.privacy === 'string' ? links.privacy : null, choices: typeof links.choices === 'string' ? links.choices : null },
    };
  } else {
    return;
  }
  schedule(tabId);
}

// Throttle rather than debounce, so a chatty page still gets regular updates.
function schedule(tabId) {
  if (pending.has(tabId)) return;
  pending.set(tabId, setTimeout(() => {
    pending.delete(tabId);
    publish(tabId).catch(() => {}); // the tab may have closed in the meantime
  }, 250));
}

async function publish(tabId) {
  const st = tabs.get(tabId);
  if (!st) return;
  const report = buildReport(st);
  const settings = await current;
  await api.storage.session.set({ ['tab:' + tabId]: st });
  remember(st, report, settings);
  warnAboutRecorders(tabId, st, report, settings);
  await paintBadge(tabId, report, settings);
}

// Tell the page's frames once per page when an unblocked session recorder is running, so
// they can warn the user before they type.
function warnAboutRecorders(tabId, st, report, settings) {
  const replay = report.items.find(i => i.id === 'session-replay' && i.status === 'active');
  if (!replay || st.warned || !settings.typingWarning) return;
  st.warned = true;
  const vendors = [...new Set(replay.scripts.map(s => s.vendor).filter(Boolean))];
  api.tabs.sendMessage(tabId, { type: 'recorder', vendors }).catch(() => {});
}

async function paintBadge(tabId, r, settings) {
  const g = GRADES[r.grade];
  await api.action.setBadgeText({ tabId, text: r.score && settings.badge !== 'none' ? String(r.score) : '' });
  await api.action.setBadgeBackgroundColor({ tabId, color: g.badge });
  if (api.action.setBadgeTextColor) await api.action.setBadgeTextColor({ tabId, color: '#ffffff' });
  const stopped = r.items.filter(i => i.status !== 'active').length;
  await api.action.setTitle({
    tabId,
    title: r.score
      ? `What Sites See: ${g.label} (${r.score}/100)${stopped ? `, ${stopped} stopped` : ''}`
      : 'What Sites See: nothing caught yet',
  });
}

/* ---------- history ---------- */
// A plain object keyed by hostname. Writes are chained so two tabs updating at once can't
// overwrite each other's read-modify-write.
let historyChain = Promise.resolve();
function remember(st, report, settings) {
  if (!settings.history || st.incognito || report.score === 0 || !/^https?:/.test(st.url)) return;
  historyChain = historyChain.then(async () => {
    const { history = {} } = await api.storage.local.get('history');
    const prev = history[report.host];
    const now = Date.now();
    const union = (a = [], b = [], max = 60) => [...new Set([...a, ...b])].slice(0, max);
    // Keep the worst behavior ever seen: a site that fingerprinted you once still did it.
    history[report.host] = {
      host: report.host,
      score: report.score,
      maxScore: Math.max(prev?.maxScore ?? 0, report.score),
      caught: union(prev?.caught, report.items.map(i => i.id)),
      vendors: union(prev?.vendors, report.items.flatMap(i => i.scripts.map(s => s.vendor)).filter(Boolean)),
      thirdParty: union(prev?.thirdParty, report.thirdPartySites),
      scripts: union(prev?.scripts, report.items.flatMap(i => i.scripts.filter(s => s.thirdParty && s.file).map(s => `${s.host}/${s.file}`)), 30),
      links: { ...prev?.links, ...Object.fromEntries(Object.entries(report.links).filter(([, v]) => v)) },
      visits: (prev?.visits ?? 0) + (prev?.lastDoc === st.doc ? 0 : 1),
      lastDoc: st.doc,
      firstSeen: prev?.firstSeen ?? now,
      lastSeen: now,
    };
    expire(history, settings.historyDays);
    const hosts = Object.keys(history);
    if (hosts.length > HISTORY_LIMIT) {
      hosts.sort((a, b) => history[a].lastSeen - history[b].lastSeen)
        .slice(0, hosts.length - HISTORY_LIMIT)
        .forEach(h => delete history[h]);
    }
    await api.storage.local.set({ history });
  }).catch(() => {});
}

// Forget sites not seen within the user's chosen retention period (0 = keep forever).
function expire(history, days) {
  if (!days) return false;
  const cutoff = Date.now() - days * 86400000;
  let changed = false;
  for (const [host, entry] of Object.entries(history)) {
    if (entry.lastSeen < cutoff) { delete history[host]; changed = true; }
  }
  return changed;
}

function pruneHistory(settings) {
  historyChain = historyChain.then(async () => {
    // Turning history off only stops recording; deleting is a separate, explicit action.
    const { history = {} } = await api.storage.local.get('history');
    if (expire(history, settings.historyDays)) await api.storage.local.set({ history });
  }).catch(() => {});
  return historyChain;
}
