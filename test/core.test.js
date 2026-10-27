'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const { extractEvents } = require('../src/sources/jsonld');
const euroleague = require('../src/sources/euroleague');
const { mergeEvents } = require('../src/aggregator');
const { MemoryStore } = require('../src/store');
const { Aggregator } = require('../src/aggregator');
const { buildIcs } = require('../src/ics');
const { parseIsraelDate } = require('../src/util');
const { createHandler } = require('../src/server');

const fixture = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');

test('parseIsraelDate handles offsets, local times and DST', () => {
  assert.strictEqual(parseIsraelDate('2026-11-19T20:45:00+02:00').toISOString(), '2026-11-19T18:45:00.000Z');
  assert.strictEqual(parseIsraelDate('2026-11-19T20:45:00').toISOString(), '2026-11-19T18:45:00.000Z'); // winter, UTC+2
  assert.strictEqual(parseIsraelDate('2026-07-01 21:00').toISOString(), '2026-07-01T18:00:00.000Z'); // summer, UTC+3
  assert.strictEqual(parseIsraelDate('not a date'), null);
});

test('JSON-LD extractor reads Tickchak venue page', () => {
  const evs = extractEvents(fixture('tickchak.html'), 'https://live.tickchak.co.il/tel-aviv-menorah-hall');
  assert.ok(evs.length >= 1);
  for (const e of evs) {
    assert.ok(e.title);
    assert.ok(e.start instanceof Date && !Number.isNaN(e.start.getTime()));
    assert.match(e.url, /^https:\/\//);
  }
});

test('JSON-LD extractor ignores scripts and malformed blocks', () => {
  const html = `<script type="application/ld+json">{bad json</script>
    <script type="application/ld+json">{"@type":"Event","name":"<img src=x onerror=alert(1)>Show","startDate":"2026-12-01T20:00:00+02:00","url":"javascript:alert(1)"}</script>`;
  const [e] = extractEvents(html, 'https://example.com/page');
  assert.strictEqual(e.title, 'Show');
  assert.strictEqual(e.url, 'https://example.com/page');
});

test('EuroLeague parser keeps only games at Menora arena', () => {
  const evs = euroleague.parseGames(JSON.parse(fixture('euroleague.json')), { code: 'E', name: 'יורוליג' }, 'https://api');
  assert.strictEqual(evs.length, 1);
  assert.strictEqual(evs[0].sourceEventId, 'TEST_MENORA');
  assert.strictEqual(evs[0].category, 'sports');
});

test('events from different sources at the same time are merged', () => {
  const row = (source, id, title, start) => ({ source, data: { sourceEventId: id, title, start, url: `https://${source}.example/${id}` }, firstSeen: '2026-10-01T00:00:00Z', lastSeen: '2026-10-02T00:00:00Z' });
  const merged = mergeEvents([
    row('b', '1', 'Artist Live', '2026-12-01T18:30:00Z'),
    row('a', 'x', 'אמן בהופעה', '2026-12-01T18:00:00Z'),
    row('a', 'y', 'Next day', '2026-12-02T18:00:00Z'),
  ], [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  assert.strictEqual(merged.length, 2);
  assert.strictEqual(merged[0].title, 'אמן בהופעה');
  assert.deepStrictEqual(merged[0].sources.map((s) => s.id), ['a', 'b']);
  assert.ok(merged[0].traffic.arrivalWindow.from < merged[0].start);
});

test('a failing source keeps its previous events', async () => {
  let fail = false;
  const src = { id: 's', name: 'S', fetch: async () => { if (fail) throw new Error('down'); return [{ sourceEventId: '1', title: 'T', start: new Date(Date.now() + 86400000) }]; } };
  const agg = new Aggregator(new MemoryStore(), [src], { log: { info() {}, warn() {}, error() {} } });
  await agg.refresh();
  fail = true;
  await agg.refresh();
  assert.strictEqual(agg.events.length, 1);
  assert.strictEqual(agg.sourceStatus()[0].ok, false);
});

test('ICS output is valid-ish and escapes text', () => {
  const [ev] = mergeEvents([{ source: 'a', data: { sourceEventId: '1', title: 'A, B; C', start: '2026-12-01T18:00:00Z' }, firstSeen: 'x', lastSeen: 'x' }], [{ id: 'a', name: 'A' }]);
  const ics = buildIcs([ev], { trafficBlocks: true });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /SUMMARY:A\\, B\\; C/);
  assert.strictEqual((ics.match(/BEGIN:VEVENT/g) || []).length, 3);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);
});

test('HTTP API: events, validation, auth and security headers', async () => {
  const agg = { events: [], updatedAt: null, sourceStatus: () => [], refresh: async () => {} };
  const server = http.createServer(createHandler(agg));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let r = await fetch(`${base}/api/events`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers.get('access-control-allow-origin'), '*');
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
    r = await fetch(`${base}/api/events?from=garbage`);
    assert.strictEqual(r.status, 400);
    r = await fetch(`${base}/api/events?category=<script>`);
    assert.strictEqual(r.status, 400);
    r = await fetch(`${base}/api/refresh`, { method: 'POST' });
    assert.strictEqual(r.status, 401);
    r = await fetch(`${base}/../package.json`);
    assert.strictEqual(r.status, 404);
    r = await fetch(`${base}/calendar.ics`);
    assert.match(r.headers.get('content-type'), /text\/calendar/);
    r = await fetch(`${base}/`);
    assert.strictEqual(r.status, 200);
  } finally {
    server.close();
  }
});
