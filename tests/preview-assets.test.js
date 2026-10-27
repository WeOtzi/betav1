'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assets = require('../scripts/release/preview-assets.json');
const { rewritePaths } = require('../scripts/release/preview-server.cjs');

test('all trusted preview assets match their recorded upstream hashes', () => {
  for (const [name, entry] of Object.entries(assets.files)) {
    const bytes = fs.readFileSync(path.join(__dirname, '../scripts/release/preview-assets', name));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256, name);
  }
});

test('legacy icon fonts, editor and datepicker styles use local assets in every branch', () => {
  for (const [url, local] of Object.entries(assets.rewrites)) {
    const markup = '<script src="' + url + '"></script><link href="' + url + '" rel="stylesheet">';
    const rewritten = rewritePaths(markup, '/preview/test-branch');
    assert(!rewritten.includes(url));
    assert(rewritten.includes('src="' + local + '"'));
    assert(rewritten.includes('href="' + local + '"'));
    assert(!rewritten.includes('/preview/test-branch/__preview/'));
  }
});

test('component catalog may embed only same-origin preview frames', () => {
  const { CSP } = require('../scripts/release/preview-server.cjs');
  assert.match(CSP, /frame-src 'self';/);
  assert.match(CSP, /connect-src 'self';/);
  assert.match(CSP, /object-src 'none';/);
});
