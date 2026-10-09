// Cross-site view: which third parties appeared on the most of the sites you visited.
// Pure function over the history object, so it's unit tested.
import { matchVendor } from './vendors.js';
import { siteOf } from './domain.js';
import { asRequest } from './letters.js';

// history: { host: { thirdParty: [site, ...], ... } } -> [{ site, vendor, count, sites }]
export function followers(history, limit = 15) {
  const seen = new Map(); // third-party site -> Set of first-party sites
  for (const entry of Object.values(history)) {
    const first = siteOf(entry.host);
    for (const third of entry.thirdParty ?? []) {
      if (!seen.has(third)) seen.set(third, new Set());
      seen.get(third).add(first);
    }
  }
  return [...seen]
    .filter(([, sites]) => sites.size >= 2) // one site alone can't link anything
    .map(([site, sites]) => ({ site, vendor: matchVendor(site)?.name ?? null, count: sites.size, sites: [...sites].sort() }))
    .sort((a, b) => b.count - a.count || a.site.localeCompare(b.site))
    .slice(0, limit);
}

// The last 7 days at a glance: how many sites probed you, who followed you across them, and
// which deletion requests are due soon or overdue.
const DAY = 86400000;
export function weekSummary(history, requests = {}, now = Date.now()) {
  const recent = Object.fromEntries(Object.entries(history).filter(([, e]) => e.lastSeen >= now - 7 * DAY));
  const entries = Object.values(recent);
  const tracked = Object.entries(requests).map(([host, r]) => [host, asRequest(r)]).filter(([, r]) => r);
  return {
    sites: entries.length,
    heavy: entries.filter(e => e.maxScore >= 25).length,
    followers: followers(recent, 3),
    dueSoon: tracked.filter(([, r]) => r.dueAt >= now && r.dueAt < now + 7 * DAY).map(([host, r]) => ({ host, dueAt: r.dueAt })),
    overdue: tracked.filter(([, r]) => r.dueAt < now).map(([host, r]) => ({ host, dueAt: r.dueAt })),
  };
}
