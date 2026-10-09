// Keeps one report per tab, paints the toolbar badge, remembers which sites fingerprinted you,
// and turns settings into browser configuration (content scripts and network rules).
// Chromium runs this as a service worker and Firefox as an event page; both can be shut down
// when idle, so tab state lives in storage.session rather than only in memory.
import { api } from './shared/api.js';
import { buildReport, GRADES } from './shared/scoring.js';
import { hostOf, siteOf } from './shared/domain.js';
import { loadSettings, saveSettings, withSite, isPaused } from './shared/settings.js';
import { VENDORS } from './shared/vendors.js';
import { allowsBlobWorkers } from './shared/csp.js';
import { scriptPlan, rulesetPlan, dynamicRules, sessionRules, DYNAMIC_RULE_BASE, SESSION_RULE_BASE } from './shared/plan.js';

const HISTORY_LIMIT = 500;
const tabs = new Map();    // tabId -> { url, doc, incognito, frames: { frameId: {...} } }
const pending = new Map(); // tabId -> timer
// Settings are read often (every page, every badge), so keep a copy in memory.
let current = loadSettings(api);

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
  await updateSessionRules(settings);
}

// Session rules name tabs, so they're rebuilt whenever a private tab opens or closes.
// Browsers clear them on restart, and the background rebuilds them on startup.
const privateTabs = new Set();
async function updateSessionRules(settings) {
  const old = await api.declarativeNetRequest.getSessionRules();
  await api.declarativeNetRequest.updateSessionRules({
    removeRuleIds: old.filter(r => r.id >= SESSION_RULE_BASE).map(r => r.id),
    addRules: sessionRules(settings, [...privateTabs]),
  });
}
api.tabs.query({}).then(all => {
  for (const t of all) if (t.incognito) privateTabs.add(t.id);
  return current.then(updateSessionRules);
}).catch(() => {});
api.tabs.onCreated.addListener(t => {
  if (!t.incognito) return;
  privateTabs.add(t.id);
  current.then(s => s.privateMode === 'always' && updateSessionRules(s)).catch(() => {});
});

// Pausing: an alarm turns protection back on; "until restart" is cleared at startup.
async function updatePause(settings) {
  await api.alarms.clear('resume');
  if (settings.pausedUntil > Date.now()) api.alarms.create('resume', { when: settings.pausedUntil });
}
api.alarms.onAlarm.addListener(a => { if (a.name === 'resume') saveSettings(api, { pausedUntil: 0 }); });

// Keep WebRTC on the default public interface: video calls work, but a page can't discover
// your other network addresses, such as your real IP behind a VPN.
async function updateWebRTC(settings) {
  const policy = api.privacy?.network?.webRTCIPHandlingPolicy;
  if (!policy) return;
  if (settings.webrtc) await policy.set({ value: 'default_public_interface_only' });
  else await policy.clear({});
}

let applying = Promise.resolve();
function applySettings() {
  applying = applying.then(async () => {
    const settings = await (current = loadSettings(api));
    await Promise.all([
      pruneHistory(settings),
      registerScripts(settings),
      updateNetworkRules(settings),
      updateWebRTC(settings).catch(() => {}),
      updatePause(settings).catch(() => {}),
    ]);
  }).catch(e => console.error('What Sites See: applying settings failed', e));
  return applying;
}

api.runtime.onInstalled.addListener(({ reason }) => {
  applySettings();
  // First install: open the Checkup so people see what's on and what's left to do.
  if (reason === 'install') api.tabs.create({ url: api.runtime.getURL('checkup/checkup.html') });
});
// On browser start: end an "until restart" pause, and rebuild what browsers don't keep
// (session rules always; registered scripts in browsers that don't persist them).
api.runtime.onStartup.addListener(async () => {
  const settings = await current;
  if (settings.pausedUntil === -1 || (settings.pausedUntil && !isPaused(settings))) {
    await saveSettings(api, { pausedUntil: 0 }); // storage.onChanged re-applies everything
    return;
  }
  const registered = await api.scripting.getRegisteredContentScripts().catch(() => []);
  if (!registered.length) applySettings();
  else updateSessionRules(settings).catch(() => {});
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

/* ---------- page CSP, for Web Worker coverage ---------- */
// Whether each frame's Content-Security-Policy allows blob: workers, from its response headers.
// Read-only: nothing is blocked or modified here.
const frameCsp = new Map(); // "tabId:frameId" -> boolean
api.webRequest?.onHeadersReceived.addListener(d => {
  if (d.tabId < 0) return;
  frameCsp.set(`${d.tabId}:${d.frameId}`, allowsBlobWorkers(d.responseHeaders ?? []));
}, { urls: ['<all_urls>'], types: ['main_frame', 'sub_frame'] }, ['responseHeaders']);

// Requests this extension's network rules blocked. A blocked <script> fires an error event the
// bridge sees, but a blocked fetch, XHR or beacon doesn't, so read it here instead.
const BLOCKED = /ERR_BLOCKED_BY_CLIENT|NS_ERROR_ABORT|blocked/i;
api.webRequest?.onErrorOccurred.addListener(d => {
  if (d.tabId < 0 || d.type === 'main_frame' || !BLOCKED.test(d.error)) return;
  const st = tabs.get(d.tabId);
  if (!st) return;
  let host;
  try { host = new URL(d.url).hostname; } catch { return; }
  st.blocked ??= [];
  if (!st.blocked.includes(host) && st.blocked.length < 300) { st.blocked.push(host); schedule(d.tabId); }
}, { urls: ['<all_urls>'] });

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
  // Private windows get their own seeds, so a site can't match a private visit to a normal one.
  const mode = sender.tab?.incognito ? 'private' : 'normal';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${secret}|${mode}|${siteOf(hostOf(topUrl))}`));
  return new DataView(digest).getUint32(0);
}

/* ---------- messages from content scripts ---------- */

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object' || sender.id !== api.runtime.id) return;
  if (msg.type === 'seed') {
    seedFor(sender).then(sendResponse, () => sendResponse(null));
    return true; // keep the channel open for the async reply
  }
  if (msg.type === 'frame-info') {
    const key = `${sender.tab?.id}:${sender.frameId}`;
    sendResponse({ blobWorkers: frameCsp.get(key) ?? null });
    return;
  }
  if (msg.type === 'pause') {
    // From the popup: 0 resumes, -1 pauses until restart, otherwise a duration in minutes.
    const until = msg.minutes === 0 ? 0 : msg.minutes === -1 ? -1 : Date.now() + Number(msg.minutes) * 60000;
    saveSettings(api, { pausedUntil: until })
      .then(() => applySettings())
      .then(() => Number.isInteger(msg.tabId) && api.tabs.reload(msg.tabId))
      .then(() => sendResponse(true), () => sendResponse(false));
    return true;
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
  for (const key of frameCsp.keys()) if (key.startsWith(tabId + ':')) frameCsp.delete(key);
  if (privateTabs.delete(tabId)) current.then(updateSessionRules).catch(() => {});
  api.storage.session.remove('tab:' + tabId).catch(() => {});
});

const strings = (a, max = 300) => Array.isArray(a) ? a.filter(x => typeof x === 'string').slice(0, max) : [];

function receive(msg, sender, tabId, settings) {
  if (msg.type === 'page') {
    if (sender.frameId !== 0) return;
    // Which defenses this page loaded with, so the report doesn't claim more than it got.
    const defenses = Object.keys(settings.defenses).filter(k => settings.defenses[k]);
    tabs.set(tabId, { url: String(msg.url), doc: msg.doc, incognito: !!sender.tab.incognito, defenses, frames: {}, blocked: [] });
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
  if (settings.historyExclude.includes(siteOf(report.host))) return;
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
