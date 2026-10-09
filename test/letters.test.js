import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLetter, guessLaw, LAWS, asRequest } from '../src/shared/letters.js';

const site = {
  host: 'shop.example.com',
  firstSeen: Date.UTC(2026, 8, 1, 12), lastSeen: Date.UTC(2026, 9, 7, 12), visits: 4,
  caught: ['canvas-fp', 'font-probe', 'session-replay'],
  vendors: ['Hotjar'],
  scripts: ['cdn.tracker.net/fp.js'],
};

test('every law produces a complete letter with the evidence', () => {
  for (const law of Object.keys(LAWS)) {
    const { subject, body } = buildLetter(law, site, { name: 'Sam Doe', email: 'sam@example.org' });
    assert.match(subject, /shop\.example\.com/, law);
    for (const needed of ['Canvas fingerprinting', 'Font probing', 'Session recording', 'Hotjar', 'cdn.tracker.net/fp.js', 'Sam Doe', 'sam@example.org', 'September 1, 2026', 'October 7, 2026']) {
      assert.ok(body.includes(needed), `${law} letter is missing "${needed}"`);
    }
  }
});

test('legal citations match the chosen law', () => {
  assert.match(buildLetter('ccpa', site).body, /§ 1798\.105.*§ 1798\.120/s);
  assert.match(buildLetter('ccpa', site).body, /45 days/);
  assert.match(buildLetter('gdpr', site).body, /Article 17.*ePrivacy Directive/s);
  assert.match(buildLetter('uk', site).body, /PECR/);
  assert.match(buildLetter('us-state', site, { state: 'Colorado' }).body, /my state, Colorado/);
  assert.doesNotMatch(buildLetter('other', site).body, /§|Article/);
});

test('placeholders appear when name and email are left blank', () => {
  const { body } = buildLetter('ccpa', site);
  assert.match(body, /\[Your name\]/);
  assert.match(body, /\[Your email address\]/);
});

test('a single visit reads as one date', () => {
  const { body } = buildLetter('ccpa', { ...site, firstSeen: site.lastSeen });
  assert.match(body, /on October 7, 2026/);
});

test('guessLaw uses the time zone as a starting point', () => {
  assert.equal(guessLaw('America/Los_Angeles'), 'ccpa');
  assert.equal(guessLaw('America/Chicago'), 'us-state');
  assert.equal(guessLaw('Europe/Berlin'), 'gdpr');
  assert.equal(guessLaw('Europe/London'), 'uk');
  assert.equal(guessLaw('Asia/Tokyo'), 'other');
});

test('tracked requests: old timestamps get a 45-day deadline, junk is ignored', () => {
  const t = Date.UTC(2026, 9, 8);
  assert.deepEqual(asRequest(t), { sentAt: t, dueAt: t + 45 * 86400000, law: null });
  const r = { sentAt: t, dueAt: t + 30 * 86400000, law: 'gdpr' };
  assert.equal(asRequest(r), r);
  assert.equal(asRequest(undefined), null);
  assert.equal(asRequest({ nope: 1 }), null);
});
