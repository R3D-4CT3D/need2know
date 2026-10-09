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
