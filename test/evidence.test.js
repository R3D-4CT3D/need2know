import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJSON, evidenceRecord, sealEvidence } from '../src/shared/evidence.js';
import { buildReport } from '../src/shared/scoring.js';

const state = {
  url: 'https://news.example.com/story',
  frames: { 0: { url: 'https://news.example.com/story', protect: true, hosts: ['static.hotjar.com'], failed: [],
    snap: { 'canvas-fp': { n: 2, x: null, s: { 'https://cdn.tracker.net/fp.js': 2 } } } } },
};
const meta = { version: '0.2.0', userAgent: 'TestAgent/1.0', generatedAt: Date.UTC(2026, 9, 8) };

test('canonical JSON ignores key order', () => {
  assert.equal(canonicalJSON({ b: 1, a: [2, { d: 3, c: 4 }] }), canonicalJSON({ a: [2, { c: 4, d: 3 }], b: 1 }));
  assert.equal(canonicalJSON({ a: undefined, b: null }), '{"b":null}');
});

test('the record carries findings, sources and outcome', () => {
  const r = evidenceRecord(buildReport(state), state, meta);
  assert.equal(r.schema, 'what-sites-see/evidence@1');
  assert.equal(r.generatedAt, '2026-10-08T00:00:00.000Z');
  const canvas = r.findings.find(f => f.technique === 'canvas-fp');
  assert.equal(canvas.status, 'neutralized');
  assert.equal(canvas.sources[0].url, 'https://cdn.tracker.net/fp.js');
  assert.equal(canvas.sources[0].thirdParty, true);
  assert.ok(r.findings.some(f => f.technique === 'session-replay'));
});

test('the hash is stable and changes if anything is altered', async () => {
  const record = evidenceRecord(buildReport(state), state, meta);
  const a = await sealEvidence(record);
  const b = await sealEvidence(JSON.parse(JSON.stringify(record)));
  assert.match(a.sha256, /^[0-9a-f]{64}$/);
  assert.equal(a.sha256, b.sha256);
  record.findings[0].calls += 1;
  assert.notEqual((await sealEvidence(record)).sha256, a.sha256);
});
