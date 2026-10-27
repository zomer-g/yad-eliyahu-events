'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const maccabi = require('../src/sources/maccabi');
const ibasketball = require('../src/sources/ibasketball');
const vivenu = require('../src/sources/vivenu');
const { mergeEvents } = require('../src/aggregator');

const fixture = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8'));

test('Maccabi game board: keeps only upcoming games at Menora', () => {
  const evs = maccabi.parseGames(fixture('maccabi.json'));
  assert.ok(evs.length >= 1);
  for (const e of evs) {
    assert.match(e.extra.venue, /מנורה/);
    assert.match(e.url, /^https:\/\/maccabi\.co\.il\//);
    assert.strictEqual(e.category, 'sports');
  }
});

test('ibasketball: filters by Menora venue id and reads local time', () => {
  const raw = fixture('ibasketball.json');
  const evs = ibasketball.parseEvents(raw, { 119893: 'ליגת על' });
  assert.strictEqual(evs.length, raw.length - 1);
  assert.strictEqual(evs[0].start.toISOString(), new Date(`${raw[0].date}+02:00`).toISOString());
  assert.match(evs[0].title, / נגד /);
  assert.strictEqual(evs[0].description, 'ליגת על');
});

test('Vivenu: drops parking, passes and other-venue listings', () => {
  const evs = vivenu.parseListings(fixture('vivenu.json'));
  assert.ok(evs.length >= 1);
  for (const e of evs) {
    assert.doesNotMatch(e.title, /חניה|לא מסומן|נקודות|טופס/);
    assert.match(e.url, /^https:\/\/tickets\./);
  }
});

test('the same game with provisional dates in different sources is merged and marked unconfirmed', () => {
  const row = (source, id, title, start, timeTbd = false) => ({
    source, data: { sourceEventId: id, title, start, category: 'sports', timeTbd }, firstSeen: 'x', lastSeen: 'x',
  });
  const merged = mergeEvents([
    row('ibasketball', '1', 'מכבי תל אביב Rapyd נגד הפועל נס ציונה חי מו', '2026-12-28T18:00:00Z', true),
    row('vivenu', '2', 'מכבי ראפיד ת"א נגד עירוני נס ציונה', '2026-12-26T18:00:00Z'),
    row('vivenu', '3', 'מכבי ראפיד ת"א נגד בני הרצליה', '2026-12-27T18:00:00Z'),
  ], [{ id: 'ibasketball' }, { id: 'vivenu' }]);
  assert.strictEqual(merged.length, 2);
  const nz = merged.find((e) => e.sources.length === 2);
  assert.strictEqual(nz.start, '2026-12-26T18:00:00Z');
  assert.strictEqual(nz.confirmed, false);
});
