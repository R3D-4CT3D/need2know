// Cross-site view: which third parties appeared on the most of the sites you visited.
// Pure function over the history object, so it's unit tested.
import { matchVendor } from './vendors.js';
import { siteOf } from './domain.js';

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
