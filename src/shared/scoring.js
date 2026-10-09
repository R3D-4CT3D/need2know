// Turns raw per-frame tallies into the report the popup and badge show. Pure functions with
// no browser APIs, so they run unchanged in the extension and under `node --test`.
import { TECHNIQUES } from './techniques.js';
import { matchVendor } from './vendors.js';
import { hostOf, siteOf, isThirdParty } from './domain.js';

// `token` is a CSS variable from theme.css; `badge` is the toolbar badge color.
export const GRADES = {
  none: { label: 'Nothing caught yet', token: '--muted', badge: '#5b665d' },
  low: { label: 'A little probing', token: '--ok', badge: '#2f7d4f' },
  moderate: { label: 'Actively fingerprinting', token: '--warn', badge: '#9a6400' },
  heavy: { label: 'Heavy fingerprinting', token: '--stamp', badge: '#b8392a' },
};

export const gradeFor = score => score === 0 ? 'none' : score < 25 ? 'low' : score < 60 ? 'moderate' : 'heavy';

const VENDOR_ITEM = { replay: 'session-replay', fingerprint: 'fp-vendor', fraud: 'fraud-vendor', bot: 'fraud-vendor' };

function fileOf(src) {
  try { return new URL(src).pathname.split('/').filter(Boolean).pop() || ''; } catch { return ''; }
}

// Every frame (top page and iframes) reports separately; add them up.
export function mergeFrames(frames) {
  const merged = {};
  const hosts = new Set();
  const failed = new Set();
  const frameUrls = [];
  let protect = false;
  for (const f of Object.values(frames || {})) {
    if (f.url) frameUrls.push(f.url);
    if (f.protect) protect = true;
    for (const h of f.hosts || []) hosts.add(h);
    for (const h of f.failed || []) failed.add(h);
    for (const [t, row] of Object.entries(f.snap || {})) {
      const m = merged[t] ??= { n: 0, x: null, s: {} };
      m.n += row.n || 0;
      if (typeof row.x === 'number') m.x = Math.max(m.x ?? 0, row.x);
      for (const [src, n] of Object.entries(row.s || {})) m.s[src] = (m.s[src] || 0) + n;
    }
  }
  return { merged, hosts, failed, frameUrls, protect };
}

// What happened to each attempt: "neutralized" (the site got noise or a generic answer),
// "blocked" (the vendor never loaded), or "active" (it worked). `defenses` lists the defenses
// the page loaded with; older states without it had them all.
function statusOf(def, protect, scripts, failed, defenses) {
  if (def.defense === 'block') return scripts.length && scripts.every(s => failed.has(s.host)) ? 'blocked' : 'active';
  if (!protect || !def.guard || (defenses && !defenses.includes(def.guard))) return 'active';
  return def.defense === 'partial' ? 'partial' : 'neutralized';
}

export function buildReport(state) {
  const url = state?.url || '';
  const pageHost = hostOf(url);
  const pageNoQuery = url.replace(/[?#].*$/, '');
  const { merged, hosts, failed, frameUrls, protect } = mergeFrames(state?.frames);
  const items = [];

  const describe = (src, count) => {
    const host = hostOf(src);
    return {
      url: src, host, count,
      file: src === pageNoQuery ? 'inline script' : fileOf(src),
      thirdParty: isThirdParty(host, pageHost),
      vendor: matchVendor(host)?.name ?? null,
    };
  };

  // Techniques caught by the API hooks.
  for (const [id, row] of Object.entries(merged)) {
    const def = TECHNIQUES[id];
    if (!def || def.vendor) continue;
    if (def.min && (row.x ?? 0) < def.min) continue;
    let scripts = Object.entries(row.s).sort((a, b) => b[1] - a[1]).map(([src, n]) => describe(src, n));
    let count = row.n;
    if (def.thirdPartyOnly) {
      scripts = scripts.filter(s => s.thirdParty);
      if (!scripts.length) continue;
      count = scripts.reduce((sum, s) => sum + s.count, 0);
    }
    items.push({ id, title: def.title, why: def.why(row), weight: def.weight, count, scripts, status: statusOf(def, protect, scripts, failed, state?.defenses) });
  }

  // Known vendors, from every domain the page touched.
  const contacted = new Set([...hosts, ...failed]);
  for (const row of Object.values(merged)) for (const src of Object.keys(row.s)) contacted.add(hostOf(src));
  for (const fu of frameUrls) contacted.add(hostOf(fu));
  contacted.delete('');

  const byItem = {}; // item id -> Map(vendor name -> [hosts])
  for (const h of contacted) {
    const v = matchVendor(h);
    if (!v) continue;
    const names = byItem[VENDOR_ITEM[v.kind]] ??= new Map();
    if (!names.has(v.name)) names.set(v.name, []);
    names.get(v.name).push(h);
  }
  for (const [id, names] of Object.entries(byItem)) {
    const def = TECHNIQUES[id];
    const scripts = [...names].flatMap(([name, hs]) => hs.sort().map(h => ({
      url: `https://${h}/`, host: h, file: '', count: null, thirdParty: isThirdParty(h, pageHost), vendor: name,
    })));
    items.push({ id, title: def.title, why: def.why({ vendors: [...names.keys()] }), weight: def.weight, count: names.size, scripts, status: statusOf(def, protect, scripts, failed, state?.defenses) });
  }

  items.sort((a, b) => b.weight - a.weight || b.count - a.count);
  const score = Math.min(100, items.reduce((sum, i) => sum + i.weight, 0));
  const grade = gradeFor(score);
  const thirdPartySites = [...new Set([...contacted].filter(h => isThirdParty(h, pageHost)).map(siteOf))].sort();

  const links = state?.frames?.[0]?.links ?? {};

  return {
    url, host: pageHost, score, grade, label: GRADES[grade].label, items, thirdPartySites, protect,
    links: { privacy: links.privacy ?? null, choices: links.choices ?? null },
    stopped: items.filter(i => i.status !== 'active').length,
  };
}
