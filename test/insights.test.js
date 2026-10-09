import test from 'node:test';
import assert from 'node:assert/strict';
import { followers } from '../src/shared/insights.js';

const history = {
  'news.example.com': { host: 'news.example.com', thirdParty: ['hotjar.com', 'adnet.io', 'cdn-only.net'] },
  'www.example.com': { host: 'www.example.com', thirdParty: ['hotjar.com'] }, // same site as news.example.com
  'shop.other.org': { host: 'shop.other.org', thirdParty: ['hotjar.com', 'adnet.io'] },
  'blog.third.net': { host: 'blog.third.net', thirdParty: ['hotjar.com'] },
};

test('counts distinct first-party sites, not hosts', () => {
  const [top] = followers(history);
  assert.equal(top.site, 'hotjar.com');
  assert.equal(top.count, 3);
  assert.deepEqual(top.sites, ['example.com', 'other.org', 'third.net']);
  assert.equal(top.vendor, 'Hotjar');
});

test('a third party on only one site is left out, since it links nothing', () => {
  const sites = followers(history).map(f => f.site);
  assert.deepEqual(sites, ['hotjar.com', 'adnet.io']);
});

test('handles empty history', () => {
  assert.deepEqual(followers({}), []);
});

test('week summary: recent sites, followers and request deadlines', async () => {
  const { weekSummary } = await import('../src/shared/insights.js');
  const now = Date.UTC(2026, 9, 8);
  const day = 86400000;
  const h = {
    'a.com': { host: 'a.com', maxScore: 80, lastSeen: now - day, thirdParty: ['hotjar.com'] },
    'b.org': { host: 'b.org', maxScore: 10, lastSeen: now - 2 * day, thirdParty: ['hotjar.com'] },
    'old.net': { host: 'old.net', maxScore: 90, lastSeen: now - 30 * day, thirdParty: ['hotjar.com'] },
  };
  const requests = { 'a.com': { sentAt: now - 40 * day, dueAt: now + 5 * day }, 'z.com': now - 50 * day };
  const w = weekSummary(h, requests, now);
  assert.equal(w.sites, 2);
  assert.equal(w.heavy, 1);
  assert.equal(w.followers[0].count, 2, 'old visits are outside the week');
  assert.deepEqual(w.dueSoon.map(r => r.host), ['a.com']);
  assert.deepEqual(w.overdue.map(r => r.host), ['z.com']);
});
