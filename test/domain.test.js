import test from 'node:test';
import assert from 'node:assert/strict';
import { siteOf, isThirdParty, hostOf } from '../src/shared/domain.js';
import { matchVendor } from '../src/shared/vendors.js';

test('siteOf finds the registrable domain', () => {
  assert.equal(siteOf('www.example.com'), 'example.com');
  assert.equal(siteOf('a.b.example.co.uk'), 'example.co.uk');
  assert.equal(siteOf('someone.github.io'), 'someone.github.io');
  assert.equal(siteOf('localhost'), 'localhost');
  assert.equal(siteOf('127.0.0.1'), '127.0.0.1');
  assert.equal(siteOf('WWW.Example.COM.'), 'example.com');
});

test('isThirdParty compares sites, not hosts', () => {
  assert.equal(isThirdParty('cdn.example.com', 'www.example.com'), false);
  assert.equal(isThirdParty('cdn.tracker.net', 'www.example.com'), true);
  assert.equal(isThirdParty('alice.github.io', 'bob.github.io'), true);
  assert.equal(isThirdParty('127.0.0.1', 'localhost'), true);
  assert.equal(isThirdParty('', 'example.com'), false);
});

test('hostOf tolerates junk', () => {
  assert.equal(hostOf('https://A.example.com/x'), 'a.example.com');
  assert.equal(hostOf('not a url'), '');
});

test('matchVendor matches subdomains but not lookalikes', () => {
  assert.equal(matchVendor('static.hotjar.com')?.name, 'Hotjar');
  assert.equal(matchVendor('hotjar.com')?.kind, 'replay');
  assert.equal(matchVendor('nothotjar.com'), null);
  assert.equal(matchVendor(''), null);
});
