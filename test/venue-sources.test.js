'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const sportpalace = require('../src/sources/sportpalace');
const ticketmaster = require('../src/sources/ticketmaster');
const muzi = require('../src/sources/muzi');
const manual = require('../src/sources/manual');
const sources = require('../src/sources');
const { mergeEvents } = require('../src/aggregator');

const read = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');
const json = (f) => JSON.parse(read(f));
const iso = (d) => new Date(d).toISOString();

test('arena calendar: timed bookings in local time, sports calendar and closed events tagged', () => {
  const evs = sportpalace.parseCalendar(json('sportpalace.json'));
  const raw = json('sportpalace.json').data.events;
  assert.strictEqual(evs.length, raw.filter((e) => !e.allDay).length);
  const bg = evs.find((e) => e.sourceEventId === '159');
  assert.strictEqual(bg.title, "בוי ג'ורג'");
  assert.strictEqual(iso(bg.start), '2026-11-04T19:00:00.000Z');
  assert.strictEqual(bg.end, null);
  assert.match(bg.url, /^https:\/\/www\.sportpalace\.co\.il\/tlv-faclities\/sport-halls\/menora-hall\//);
  assert.ok(evs.filter((e) => e.category === 'sports').every((e) => /מכבי|הפועל/.test(e.title)));
  assert.strictEqual(evs.find((e) => /אירוע סגור/.test(e.title)).category, 'other');
  assert.throws(() => sportpalace.parseCalendar({ success: false }), /unexpected/);
});

test('Ticketmaster: only venue MM, one row per event code, first performance date', () => {
  const evs = ticketmaster.parseEvents(json('ticketmaster-top.json'), json('ticketmaster-spotlight.json'));
  assert.ok(evs.length >= 4);
  assert.strictEqual(new Set(evs.map((e) => e.sourceEventId)).size, evs.length);
  for (const e of evs) assert.match(e.url, /^https:\/\/www\.ticketmaster\.co\.il\/event\/MMM\d+\/ALL\/iw$/);
  const narkis = evs.find((e) => e.title === 'ליאור נרקיס');
  assert.strictEqual(iso(narkis.start), '2026-11-05T19:00:00.000Z');
  assert.ok(evs.some((e) => e.title === 'Boy George' && iso(e.start) === '2026-11-04T19:00:00.000Z'));
  assert.ok(evs.some((e) => e.title === 'Boy George' && iso(e.start) === '2026-11-07T19:00:00.000Z'));
});

test('muzi: date headers, real start time, title without venue suffix, next page', () => {
  const { events, pages } = muzi.parsePage(read('muzi.html'));
  assert.deepStrictEqual(events.map((e) => e.title), ["Boy George 360 בוי ג'ורג", 'ליאור נרקיס', "Boy George בוי ג'ורג", 'מור רביעי', 'קובי פרץ']);
  assert.strictEqual(iso(events[3].start), '2026-11-12T18:45:00.000Z');
  assert.ok(events.every((e) => !e.timeTbd));
  assert.match(events[0].description, /₪280/);
  assert.strictEqual(pages.length, 1);
  assert.match(pages[0], /\/page\/2\/$/);
});

test('the same show from Ticketmaster, muzi and the arena calendar becomes one event', () => {
  const at = (source, list) => list.map((d) => ({ source, data: { ...d, start: iso(d.start) }, firstSeen: 'x', lastSeen: 'x' }));
  const rows = [
    ...at('ticketmaster', ticketmaster.parseEvents(json('ticketmaster-top.json'), json('ticketmaster-spotlight.json'))),
    ...at('muzi', muzi.parsePage(read('muzi.html')).events),
    ...at('sportpalace', sportpalace.parseCalendar(json('sportpalace.json'))),
  ];
  const merged = mergeEvents(rows, sources);
  const nov4 = merged.filter((e) => e.start.startsWith('2026-11-04'));
  assert.strictEqual(nov4.length, 1);
  assert.deepStrictEqual(nov4[0].sources.map((s) => s.id), ['ticketmaster', 'muzi', 'sportpalace']);
  assert.strictEqual(nov4[0].category, 'concert');
  // Mor Revivi: muzi's 20:45 wins over the calendar's 21:00 placeholder.
  const mor = merged.find((e) => e.title === 'מור רביעי');
  assert.strictEqual(mor.start, '2026-11-12T18:45:00.000Z');
  assert.strictEqual(mor.sources.length, 2);
});

test('manual events: file is valid and entries are parsed in Israel time', async () => {
  assert.ok(Array.isArray(await manual.fetch()));
  const [e] = manual.parseManual({ events: [{ title: 'מופע', start: '2026-11-07T21:00', timeTbd: true, url: 'https://example.com/a', attendance: 11000 }] });
  assert.strictEqual(iso(e.start), '2026-11-07T19:00:00.000Z');
  assert.strictEqual(e.timeTbd, true);
  assert.strictEqual(e.attendance, 11000);
  assert.strictEqual(manual.parseManual({ events: [{ title: 'x', start: 'bad' }] }).length, 0);
});

test('every source has a unique id and a fetch function', () => {
  const ids = sources.map((s) => s.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  for (const s of sources) assert.strictEqual(typeof s.fetch, 'function');
});
