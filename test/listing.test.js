'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { extractCards, extractDetail, parseWhen, findDates, parseSitemap, listingSource } = require('../src/sources/listing');
const manual = require('../src/sources/manual');
const sources = require('../src/sources');
const { mergeEvents } = require('../src/aggregator');

const NOW = new Date('2026-11-01T10:00:00Z');
const iso = (d) => d.toISOString();

test('reads Hebrew, English and numeric dates with the start time', () => {
  assert.strictEqual(iso(parseWhen('יום רביעי, 04 נובמבר 2026 • 21:00', { now: NOW }).start), '2026-11-04T19:00:00.000Z');
  assert.strictEqual(iso(parseWhen('Wednesday, 04 November 2026 · 21:00', { now: NOW }).start), '2026-11-04T19:00:00.000Z');
  assert.strictEqual(iso(parseWhen('Nov 5, 2026 9:00', { now: NOW }).start), '2026-11-05T07:00:00.000Z');
  assert.strictEqual(iso(parseWhen('05.11.2026 | 21:00', { now: NOW }).start), '2026-11-05T19:00:00.000Z');
  assert.strictEqual(iso(parseWhen('ב-24/11/26 בשעה 20:30', { now: NOW }).start), '2026-11-24T18:30:00.000Z');
  // Summer time (UTC+3)
  assert.strictEqual(iso(parseWhen('שבת, 10 אוקטובר 2026, 17:15–18:15', { now: NOW }).start), '2026-10-10T14:15:00.000Z');
});

test('dates without a year roll to the next occurrence, and missing times are flagged', () => {
  const w = parseWhen('3 בינואר', { now: NOW });
  assert.strictEqual(w.timeTbd, true);
  assert.strictEqual(iso(w.start).slice(0, 10), '2027-01-03');
  assert.strictEqual(findDates('31.11.2026').length, 0);
  assert.strictEqual(findDates('מחיר 189.00 ₪, מאיר 5').length, 0);
});

test('prefers the published start time over the doors time', () => {
  const w = parseWhen('05.11.2026 פתיחת דלתות 19:30 תחילת המופע 21:00', { now: NOW });
  assert.strictEqual(iso(w.start), '2026-11-05T19:00:00.000Z');
});

const LISTING = `
<html><body><nav><a href="/performance/MMM99/001/ALL/iw">לרכישה</a></nav>
<div class="card"><a href="/performance/MMM27/001/ALL/iw"><img src="x.jpg" alt="ליאור נרקיס"></a>
  <h3><a href="/performance/MMM27/001/ALL/iw">ליאור נרקיס</a></h3><span>05.11.2026 21:00</span><span>היכל מנורה מבטחים</span>
  <a href="/performance/MMM27/001/ALL/iw">לרכישה</a></div>
<div class="card"><h3><a href="/performance/MMM31/001/ALL/iw">טונה</a></h3><span>12.11.2026 21:00</span><span>זאפה הרצליה</span></div>
<div class="card"><h3><a href="/performance/MMM40/001/ALL/iw">בוי ג'ורג'</a></h3><span>היכל מנורה מבטחים</span></div>
<div class="card"><a href="/about">אודות</a> 06.11.2026</div>
</body></html>`;

test('listing cards: keeps events at the arena and queues incomplete cards for their own page', () => {
  const base = 'https://www.ticketmaster.co.il/homepage/ALL/iw';
  const linkPattern = /ticketmaster\.co\.il\/performance\//;
  const { events, incomplete } = extractCards(LISTING, base, { linkPattern, requireVenueMatch: true, now: NOW });
  assert.deepStrictEqual(events.map((e) => e.title), ['ליאור נרקיס']);
  assert.strictEqual(iso(events[0].start), '2026-11-05T19:00:00.000Z');
  assert.strictEqual(events[0].url, 'https://www.ticketmaster.co.il/performance/MMM27/001/ALL/iw');
  assert.ok(incomplete.includes('https://www.ticketmaster.co.il/performance/MMM40/001/ALL/iw'));
  assert.ok(!incomplete.some((u) => u.includes('/about')));
});

test('event page without JSON-LD: title from h1, first upcoming date, venue check', () => {
  const html = `<html><head><title>בוי ג'ורג' | טיקטמאסטר</title><meta property="og:image" content="https://x.test/a.jpg"></head>
    <body><header>פורסם 01.09.2026</header><main><h1>בוי ג'ורג'</h1><p>היכל מנורה מבטחים, תל אביב</p>
    <p>פורסם 20.09.2026</p><p>יום רביעי 04.11.2026 · פתיחת דלתות 19:30 · תחילת המופע 21:00</p></main></body></html>`;
  const [e] = extractDetail(html, 'https://www.ticketmaster.co.il/performance/MMM40/001/ALL/iw', { requireVenueMatch: true, now: NOW });
  assert.strictEqual(e.title, "בוי ג'ורג'");
  assert.strictEqual(iso(e.start), '2026-11-04T19:00:00.000Z');
  assert.strictEqual(e.image, 'https://x.test/a.jpg');
  assert.strictEqual(extractDetail(html.replace('היכל מנורה מבטחים', 'זאפה'), 'https://x.test/p', { requireVenueMatch: true, now: NOW }).length, 0);
});

test('event page with JSON-LD uses the structured data', () => {
  const html = `<script type="application/ld+json">{"@type":"MusicEvent","name":"Boy George","startDate":"2026-11-07T21:00:00+02:00",
    "location":{"@type":"Place","name":"Menora Mivtachim Arena"}}</script><h1>ignored</h1>`;
  const [e] = extractDetail(html, 'https://x.test/e', { requireVenueMatch: true, now: NOW });
  assert.strictEqual(e.title, 'Boy George');
  assert.strictEqual(e.category, 'concert');
});

test('sitemaps: urls and nested indexes', () => {
  assert.deepStrictEqual(parseSitemap('<urlset><url><loc>https://a.test/e/1?x=1&amp;y=2</loc></url></urlset>').urls, ['https://a.test/e/1?x=1&y=2']);
  assert.deepStrictEqual(parseSitemap('<sitemapindex><sitemap><loc>https://a.test/s1.xml</loc></sitemap></sitemapindex>').sitemaps, ['https://a.test/s1.xml']);
});

test('listingSource follows incomplete cards to their pages and tolerates a failing sitemap', async () => {
  const pages = {
    'https://www.ticketmaster.co.il/homepage/ALL/iw': LISTING,
    'https://www.ticketmaster.co.il/performance/MMM40/001/ALL/iw': '<main><h1>בוי ג\'ורג\'</h1>היכל מנורה מבטחים 07.11.2026 21:00</main>',
  };
  const src = listingSource({
    id: 't', name: 't', homepage: 'x',
    pages: ['https://www.ticketmaster.co.il/homepage/ALL/iw'],
    sitemaps: ['https://www.ticketmaster.co.il/sitemap.xml'],
    linkPattern: /ticketmaster\.co\.il\/performance\//,
    requireVenueMatch: true,
    fetchPage: async (u) => { if (!(u in pages)) throw new Error(`HTTP 404 for ${u}`); return pages[u]; },
  });
  const evs = await src.fetch();
  assert.deepStrictEqual(evs.map((e) => e.title).sort(), ["בוי ג'ורג'", 'ליאור נרקיס']);
});

test('listingSource fails when no page could be read, so the old data is kept', async () => {
  const src = listingSource({ id: 't', name: 't', homepage: 'x', pages: ['https://a.test/'], fetchPage: async () => { throw new Error('HTTP 403'); } });
  await assert.rejects(src.fetch(), /HTTP 403/);
});

test('manual events file is valid and its entries merge with scraped ones', async () => {
  const evs = await manual.fetch();
  assert.ok(evs.length >= 1);
  for (const e of evs) {
    assert.ok(e.start instanceof Date && !Number.isNaN(e.start.getTime()));
    assert.match(e.url, /^https:\/\//);
  }
  const bg = evs.find((e) => /Boy George 360/.test(e.title));
  assert.strictEqual(iso(bg.start), '2026-11-04T19:00:00.000Z');
  const row = (source, data) => ({ source, data: { ...data, start: iso(data.start) }, firstSeen: 'x', lastSeen: 'x' });
  const merged = mergeEvents([
    row('manual', bg),
    row('ticketmaster', { sourceEventId: 'tm', title: "בוי ג'ורג'", start: new Date('2026-11-04T19:00:00Z') }),
  ], sources);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].title, "בוי ג'ורג'");
  assert.strictEqual(merged[0].traffic.expectedAttendance, 11000);
  assert.deepStrictEqual(merged[0].sources.map((s) => s.id), ['ticketmaster', 'manual']);
});

test('every source has a unique id and a fetch function', () => {
  const ids = sources.map((s) => s.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  for (const s of sources) assert.strictEqual(typeof s.fetch, 'function');
});
