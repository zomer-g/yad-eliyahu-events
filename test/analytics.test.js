'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

// Config is read at load time, so each case runs in a fresh process with its own env.
function probe(gaId) {
  const script = `
    const http = require('node:http');
    const { createHandler } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'server.js'))});
    const agg = { events: [], updatedAt: null, sourceStatus: () => [], refresh: async () => {} };
    const server = http.createServer(createHandler(agg)).listen(0, '127.0.0.1', async () => {
      const r = await fetch('http://127.0.0.1:' + server.address().port + '/ga.js');
      console.log(JSON.stringify({ csp: r.headers.get('content-security-policy'), body: await r.text() }));
      server.close();
    });`;
  const env = { ...process.env, GA_MEASUREMENT_ID: gaId };
  return JSON.parse(execFileSync(process.execPath, ['-e', script], { env, encoding: 'utf8' }));
}

test('analytics is off without a measurement id', () => {
  const r = probe('');
  assert.doesNotMatch(r.csp, /google/);
  assert.match(r.body, /not configured/);
});

test('analytics loads gtag and widens CSP only for Google endpoints', () => {
  const r = probe('G-ABC123XYZ');
  assert.match(r.body, /"G-ABC123XYZ"/);
  assert.match(r.csp, /script-src 'self' https:\/\/\*\.googletagmanager\.com;/);
  assert.match(r.csp, /connect-src 'self' https:\/\/\*\.google-analytics\.com/);
});

test('a malformed measurement id is ignored', () => {
  const r = probe('G-1"; alert(1); //');
  assert.match(r.body, /not configured/);
});
