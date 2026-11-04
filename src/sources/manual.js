'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseIsraelDate, normalizeText, safeUrl, shortHash } = require('../util');

// Hand-curated events from public announcements (data/manual-events.json), for shows the automatic
// sources missed. Entries are checked like any other source and merged with the scraped listings.
const FILE = path.join(__dirname, '..', '..', 'data', 'manual-events.json');

function parseManual(json) {
  return [].concat(json && json.events || [])
    .filter((e) => e && e.title && e.start)
    .map((e) => ({
      sourceEventId: shortHash(`${e.title}|${e.start}`),
      title: normalizeText(e.title),
      start: parseIsraelDate(e.start),
      end: parseIsraelDate(e.end),
      timeTbd: !!e.timeTbd,
      category: e.category || null,
      attendance: Number.isFinite(e.attendance) ? e.attendance : null,
      description: normalizeText(e.description).slice(0, 600),
      url: safeUrl(e.url),
      cancelled: !!e.cancelled,
      extra: {},
    }))
    .filter((e) => e.start);
}

module.exports = {
  id: 'manual',
  name: 'הוספה ידנית (הודעות רשמיות וכתבות)',
  homepage: 'https://github.com/zomer-g/yad-eliyahu-events/blob/master/data/manual-events.json',
  kind: 'manual',
  parseManual,
  async fetch() {
    return parseManual(JSON.parse(await fs.promises.readFile(FILE, 'utf8')));
  },
};
