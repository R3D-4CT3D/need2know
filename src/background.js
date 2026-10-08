// Keeps one report per tab, paints the toolbar badge, and remembers which sites fingerprinted you.
// Chromium runs this as a service worker and Firefox as an event page; both can be shut down
// when idle, so tab state lives in storage.session rather than only in memory.
import { api } from './shared/api.js';
import { buildReport, GRADES } from './shared/scoring.js';

const HISTORY_LIMIT = 500;
const tabs = new Map();    // tabId -> { url, doc, incognito, frames: { frameId: { url, snap, hosts } } }
const pending = new Map(); // tabId -> timer

const ready = api.storage.session.get(null).then(all => {
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith('tab:')) tabs.set(Number(key.slice(4)), value);
  }
}).catch(() => {});

api.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab?.id;
  if (tabId == null || tabId < 0 || !msg || typeof msg !== 'object') return;
  ready.then(() => receive(msg, sender, tabId));
});

api.tabs.onRemoved.addListener(tabId => {
  tabs.delete(tabId);
  api.storage.session.remove('tab:' + tabId).catch(() => {});
});

function receive(msg, sender, tabId) {
  if (msg.type === 'page') {
    if (sender.frameId !== 0) return;
    tabs.set(tabId, { url: String(msg.url), doc: msg.doc, incognito: !!sender.tab.incognito, frames: {} });
  } else if (msg.type === 'snap') {
    const st = tabs.get(tabId);
    if (!st) return;
    if (sender.frameId === 0 && msg.doc !== st.doc) return; // late message from the previous page
    st.frames[sender.frameId] = {
      url: String(msg.url),
      snap: msg.snap && typeof msg.snap === 'object' ? msg.snap : {},
      hosts: Array.isArray(msg.hosts) ? msg.hosts : [],
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
  await api.storage.session.set({ ['tab:' + tabId]: st });
  remember(st, report);
  await paintBadge(tabId, report);
}

async function paintBadge(tabId, r) {
  const g = GRADES[r.grade];
  await api.action.setBadgeText({ tabId, text: r.score ? String(r.score) : '' });
  await api.action.setBadgeBackgroundColor({ tabId, color: g.badge });
  if (api.action.setBadgeTextColor) await api.action.setBadgeTextColor({ tabId, color: '#ffffff' });
  await api.action.setTitle({
    tabId,
    title: r.score ? `What Sites See: ${g.label} (${r.score}/100)` : 'What Sites See: nothing caught yet',
  });
}

// History is a plain object keyed by hostname. Writes are chained so two tabs updating at
// once can't overwrite each other's read-modify-write.
let historyChain = Promise.resolve();
function remember(st, report) {
  if (st.incognito || report.score === 0 || !/^https?:/.test(st.url)) return;
  historyChain = historyChain.then(async () => {
    const { history = {} } = await api.storage.local.get('history');
    const prev = history[report.host];
    const now = Date.now();
    // Keep the worst behavior ever seen: a site that fingerprinted you once still did it.
    history[report.host] = {
      host: report.host,
      score: report.score,
      maxScore: Math.max(prev?.maxScore ?? 0, report.score),
      caught: [...new Set([...(prev?.caught ?? []), ...report.items.map(i => i.id)])],
      firstSeen: prev?.firstSeen ?? now,
      lastSeen: now,
    };
    const hosts = Object.keys(history);
    if (hosts.length > HISTORY_LIMIT) {
      hosts.sort((a, b) => history[a].lastSeen - history[b].lastSeen)
        .slice(0, hosts.length - HISTORY_LIMIT)
        .forEach(h => delete history[h]);
    }
    await api.storage.local.set({ history });
  }).catch(() => {});
}
