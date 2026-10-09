import test from 'node:test';
import assert from 'node:assert/strict';
import { allowsBlobWorkers } from '../src/shared/csp.js';

const csp = value => [{ name: 'Content-Security-Policy', value }];

test('no policy, or a policy that doesn\'t cover workers, allows blob workers', () => {
  assert.equal(allowsBlobWorkers([]), true);
  assert.equal(allowsBlobWorkers(csp("img-src 'self'; frame-ancestors 'none'")), true);
});

test('worker-src decides first, then child-src, script-src, default-src', () => {
  assert.equal(allowsBlobWorkers(csp("worker-src 'self' blob:")), true);
  assert.equal(allowsBlobWorkers(csp("worker-src 'self'; script-src blob:")), false, 'worker-src wins over script-src');
  assert.equal(allowsBlobWorkers(csp("child-src blob:; default-src 'self'")), true);
  assert.equal(allowsBlobWorkers(csp("script-src 'self' 'nonce-abc'")), false);
  assert.equal(allowsBlobWorkers(csp("default-src 'self'")), false);
  assert.equal(allowsBlobWorkers(csp("default-src *")), false, '* does not cover blob:');
});

test('every policy must allow it, including several in one header', () => {
  assert.equal(allowsBlobWorkers([...csp("worker-src blob:"), ...csp("default-src 'self'")]), false);
  assert.equal(allowsBlobWorkers(csp("worker-src blob:, worker-src 'self'")), false);
  assert.equal(allowsBlobWorkers([{ name: 'content-security-policy', value: "worker-src BLOB:" }]), true, 'case-insensitive');
});

test('report-only policies don\'t block anything', () => {
  assert.equal(allowsBlobWorkers([{ name: 'Content-Security-Policy-Report-Only', value: "default-src 'none'" }]), true);
});
