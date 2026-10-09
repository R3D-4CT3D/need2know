import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, gradeFor } from '../src/shared/scoring.js';

const PAGE = 'https://news.example.com/story?id=7';
const TRACKER = 'https://cdn.tracker.net/fp.js';
const OWN = 'https://static.example.com/app.js';
const page = (...frames) => ({ url: PAGE, frames: Object.fromEntries(frames.map((f, i) => [i, f])) });
const frame = (snap, hosts = []) => ({ url: PAGE, snap, hosts });
const ids = r => r.items.map(i => i.id);

test('an empty page scores zero', () => {
  const r = buildReport(page(frame({})));
  assert.equal(r.score, 0);
  assert.equal(r.grade, 'none');
  assert.deepEqual(r.items, []);
});

test('canvas fingerprinting is attributed to the script that did it', () => {
  const r = buildReport(page(frame({ 'canvas-fp': { n: 2, x: null, s: { [TRACKER]: 2 } } })));
  assert.deepEqual(ids(r), ['canvas-fp']);
  assert.equal(r.score, 25);
  const [s] = r.items[0].scripts;
  assert.equal(s.host, 'cdn.tracker.net');
  assert.equal(s.file, 'fp.js');
  assert.equal(s.thirdParty, true);
});

test('an inline script is labeled as such and is first-party', () => {
  const r = buildReport(page(frame({ 'webgl-gpu': { n: 1, x: null, s: { 'https://news.example.com/story': 1 } } })));
  assert.equal(r.items[0].scripts[0].file, 'inline script');
  assert.equal(r.items[0].scripts[0].thirdParty, false);
});

test('font probing and hardware sweeps only count past their thresholds', () => {
  const few = buildReport(page(frame({ 'font-probe': { n: 5, x: 5, s: {} }, 'hw-sweep': { n: 4, x: 4, s: {} } })));
  assert.deepEqual(ids(few), []);
  const many = buildReport(page(frame({ 'font-probe': { n: 150, x: 150, s: {} }, 'hw-sweep': { n: 12, x: 12, s: {} } })));
  assert.deepEqual(ids(many), ['font-probe', 'hw-sweep']);
  assert.match(many.items[0].why, /150 font settings/);
});

test('a site\'s own keyboard shortcuts are ignored, a third party listening is flagged', () => {
  const own = buildReport(page(frame({ 'key-listen': { n: 3, x: null, s: { [OWN]: 3 } } })));
  assert.deepEqual(ids(own), []);
  const both = buildReport(page(frame({ 'key-listen': { n: 4, x: null, s: { [OWN]: 3, [TRACKER]: 1 } } })));
  assert.deepEqual(ids(both), ['key-listen']);
  assert.equal(both.items[0].count, 1);
  assert.equal(both.items[0].scripts.length, 1);
});

test('known vendors are flagged from the domains a page contacts', () => {
  const r = buildReport(page(frame({}, ['static.hotjar.com', 'script.hotjar.com', 'fpnpmcdn.net', 'api.fpjs.io', 'h.online-metrix.net'])));
  assert.deepEqual(ids(r).sort(), ['fp-vendor', 'fraud-vendor', 'session-replay']);
  const replay = r.items.find(i => i.id === 'session-replay');
  assert.equal(replay.count, 1, 'two Hotjar hosts are still one vendor');
  assert.match(replay.why, /Hotjar/);
});

test('detections from iframes merge with the top page', () => {
  const r = buildReport(page(
    frame({ 'canvas-fp': { n: 1, x: null, s: { [TRACKER]: 1 } } }),
    { url: 'https://ads.adnet.io/frame.html', snap: { 'canvas-fp': { n: 2, x: null, s: { 'https://ads.adnet.io/ad.js': 2 } }, 'font-probe': { n: 30, x: 30, s: {} } }, hosts: [] },
  ));
  const canvas = r.items.find(i => i.id === 'canvas-fp');
  assert.equal(canvas.count, 3);
  assert.equal(canvas.scripts.length, 2);
  assert.ok(r.thirdPartySites.includes('adnet.io'));
});

test('the score is capped at 100', () => {
  const all = Object.fromEntries(['canvas-fp', 'audio-fp', 'webgl-gpu', 'battery', 'media-devices', 'webrtc', 'voices']
    .map(t => [t, { n: 1, x: null, s: {} }]));
  all['font-probe'] = { n: 50, x: 50, s: {} };
  assert.equal(buildReport(page(frame(all))).score, 100);
});

test('grades', () => {
  assert.equal(gradeFor(0), 'none');
  assert.equal(gradeFor(2), 'low');
  assert.equal(gradeFor(25), 'moderate');
  assert.equal(gradeFor(60), 'heavy');
});

test('a vendor blocked at the network level counts as blocked, even without an element error', () => {
  const r = buildReport({ url: PAGE, blocked: ['www.clarity.ms'], frames: { 0: frame({}, ['www.clarity.ms']) } });
  assert.equal(r.items.find(i => i.id === 'session-replay').status, 'blocked');
});
