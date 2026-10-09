import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, percentBelow, compareLine } from '../src/shared/crawlstats.js';

const crawl = {
  meta: { date: '2026-10-09', tranco: 'TEST' },
  sites: [
    { rank: 1, domain: 'big.com', score: 84, thirdPartySites: 12, vendors: ['Hotjar'],
      techniques: [{ id: 'canvas-fp', thirdParty: true }, { id: 'font-probe', thirdParty: false }],
      protected: { techniques: [{ id: 'canvas-fp', status: 'neutralized' }, { id: 'font-probe', status: 'neutralized' }, { id: 'key-listen', status: 'active' }], possibleBreakage: [] } },
    { rank: 2, domain: 'news.co.uk', score: 30, thirdPartySites: 40, vendors: ['Hotjar', 'Sift'],
      techniques: [{ id: 'canvas-fp', thirdParty: false }],
      protected: { techniques: [{ id: 'canvas-fp', status: 'neutralized' }, { id: 'session-replay', status: 'blocked' }], possibleBreakage: ['2 new page errors'] } },
    { rank: 3, domain: 'quiet.org', score: 0, thirdPartySites: 0, techniques: [], protected: { techniques: [], possibleBreakage: [] } },
    { rank: 4, domain: 'mid.net', score: 12, thirdPartySites: 3, techniques: [{ id: 'webrtc', thirdParty: true }], protected: { techniques: [{ id: 'webrtc', status: 'active' }], possibleBreakage: [] } },
  ],
};

test('summarize: prevalence, vendors, grades and medians', () => {
  const s = summarize(crawl);
  assert.equal(s.sites, 4);
  assert.deepEqual(s.scores, [0, 12, 30, 84]);
  assert.equal(s.median, 12);
  assert.deepEqual(s.grades, { none: 1, low: 1, moderate: 1, heavy: 1 });
  assert.deepEqual(s.techniques[0], { id: 'canvas-fp', title: 'Canvas fingerprinting', sites: 2, share: 50, thirdParty: 25 });
  assert.deepEqual(s.vendors[0], { name: 'Hotjar', sites: 2, share: 50 });
  assert.equal(s.medianThirdParties, 3);
  assert.equal(s.top[0].domain, 'big.com');
  assert.equal(s.bySite['news.co.uk'], 30);
});

test('summarize: protection stats count only techniques protection is meant to stop', () => {
  const s = summarize(crawl);
  // canvas x2, font, replay = 4 covered, all stopped; key-listen and webrtc aren't covered.
  assert.equal(s.protection.attempts, 4);
  assert.equal(s.protection.stoppedShare, 100);
  assert.deepEqual(s.protection.possibleBreakage, [{ domain: 'news.co.uk', reasons: ['2 new page errors'] }]);
});

test('percentBelow and the popup line', () => {
  const s = summarize(crawl);
  assert.equal(percentBelow(50, s.scores), 75);
  assert.equal(percentBelow(0, s.scores), 0);
  assert.match(compareLine(50, 'www.example.com', s), /More fingerprinting than 75% of the top 4 websites we tested \(Oct 2026\)/);
  assert.match(compareLine(5, 'www.example.com', s), /Less fingerprinting than 75%/);
  assert.match(compareLine(99, 'www.big.com', s), /When we tested this site's homepage \(Oct 2026\), it scored 84/);
  assert.equal(compareLine(0, 'www.example.com', s), null);
  assert.equal(compareLine(50, 'x.com', null), null);
});

test('follow-up notes move bot challenges out of breakage', () => {
  const s = summarize(crawl, { botChallenges: { 'news.co.uk': 'Cloudflare challenge, also without protection.' } });
  assert.deepEqual(s.protection.possibleBreakage, []);
  assert.deepEqual(s.protection.botChallenges, [{ domain: 'news.co.uk', note: 'Cloudflare challenge, also without protection.' }]);
});
