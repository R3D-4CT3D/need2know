// Turns a crawl (scripts/crawl.mjs) into the compact statistics the extension ships, and
// answers "how does this site compare?". Pure functions, unit tested.
import { TECHNIQUES } from './techniques.js';
import { gradeFor } from './scoring.js';
import { siteOf } from './domain.js';

const share = (k, n) => (n ? Math.round((k / n) * 1000) / 10 : 0);

// notes: optional follow-up findings (data/crawl-*.notes.json). Sites in notes.botChallenges are
// listed as bot challenges instead of possible breakage.
export function summarize(crawl, notes = {}) {
  const sites = crawl.sites;
  const challenged = new Set([...Object.keys(notes.botChallenges ?? {}), ...sites.filter(s => s.protectedChallenge).map(s => s.domain)]);
  const n = sites.length;
  const scores = sites.map(s => s.score ?? 0).sort((a, b) => a - b);
  const uses = (s, id) => s.techniques?.find(t => t.id === id);

  const techniques = Object.keys(TECHNIQUES).map(id => {
    const using = sites.filter(s => uses(s, id));
    return {
      id, title: TECHNIQUES[id].title,
      sites: using.length, share: share(using.length, n),
      thirdParty: share(using.filter(s => uses(s, id).thirdParty).length, n),
    };
  }).filter(t => t.sites).sort((a, b) => b.sites - a.sites);

  const vendorCounts = new Map();
  for (const s of sites) for (const v of new Set(s.vendors ?? [])) vendorCounts.set(v, (vendorCounts.get(v) ?? 0) + 1);
  const vendors = [...vendorCounts].map(([name, count]) => ({ name, sites: count, share: share(count, n) })).sort((a, b) => b.sites - a.sites);

  const grades = { none: 0, low: 0, moderate: 0, heavy: 0 };
  for (const score of scores) grades[gradeFor(score)]++;

  // With protection on: of the attempts protection is designed for, how many were stopped?
  let covered = 0, stopped = 0;
  for (const s of sites) {
    for (const t of s.protected?.techniques ?? []) {
      if (!TECHNIQUES[t.id]?.guard && TECHNIQUES[t.id]?.defense !== 'block') continue;
      covered++;
      if (t.status !== 'active') stopped++;
    }
  }
  const broke = sites.filter(s => s.protected?.possibleBreakage?.length && !challenged.has(s.domain));

  return {
    date: crawl.meta.date,
    tranco: crawl.meta.tranco,
    sites: n,
    scores,
    median: scores.length ? scores[Math.floor((scores.length - 1) / 2)] : 0,
    grades,
    techniques,
    vendors,
    medianThirdParties: (() => { const t = sites.map(s => s.thirdPartySites ?? 0).sort((a, b) => a - b); return t.length ? t[Math.floor((t.length - 1) / 2)] : 0; })(),
    top: [...sites].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.rank - b.rank).slice(0, 15)
      .map(s => ({ domain: s.domain, rank: s.rank, score: s.score ?? 0, techniques: (s.techniques ?? []).length })),
    protection: {
      stoppedShare: share(stopped, covered), attempts: covered,
      possibleBreakage: broke.map(s => ({ domain: s.domain, reasons: s.protected.possibleBreakage })),
      botChallenges: [...challenged].sort().map(domain => ({ domain, note: notes.botChallenges?.[domain] ?? 'Bot challenge page with protection on.' })),
      notDetectedAsBlocked: Object.entries(notes.blockedNotDetected ?? {}).map(([domain, note]) => ({ domain, note })),
    },
    bySite: Object.fromEntries(sites.map(s => [siteOf(s.domain), s.score ?? 0])),
  };
}

// Share of crawled sites that scored lower than `score` (0-100).
export function percentBelow(score, scores) {
  if (!scores?.length) return null;
  return Math.round((scores.filter(s => s < score).length / scores.length) * 100);
}

// One line for the popup comparing this page with the crawl, or null if there's nothing useful to say.
export function compareLine(score, host, stats) {
  if (!stats) return null;
  const tested = stats.bySite[siteOf(host)];
  const month = new Date(stats.date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (tested !== undefined) return `When we tested this site's homepage (${month}), it scored ${tested}.`;
  if (!score) return null;
  const below = percentBelow(score, stats.scores);
  return below >= 50
    ? `More fingerprinting than ${below}% of the top ${stats.sites} websites we tested (${month}).`
    : `Less fingerprinting than ${100 - below}% of the top ${stats.sites} websites we tested (${month}).`;
}
