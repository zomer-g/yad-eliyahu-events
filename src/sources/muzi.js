'use strict';

const { fetchText, parseIsraelDate, normalizeText, safeUrl } = require('../util');

// muzi lists concerts by venue from every ticket vendor, with the real start time.
// The page groups shows under date headers (data-event-date="YYYYMMDD") and is paginated (/page/2/).
const PAGE = 'https://muzi.co.il/events-by-hall/%D7%94%D7%99%D7%9B%D7%9C-%D7%9E%D7%A0%D7%95%D7%A8%D7%94/';
const MAX_PAGES = 6;

function cleanTitle(t) {
  return normalizeText(t).replace(/[\u2018\u2019]/g, "'")
    .replace(/\s*\|\s*(היכל\s+)?מנורה(\s+מבטחים)?\s*$/, '')
    .trim();
}

function parsePage(html) {
  const s = String(html).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ');
  const headers = [...s.matchAll(/data-event-date="(\d{8})"/g)].map((m) => ({ at: m.index, day: m[1] }));
  const out = [];
  // Only real listings use <a class="avatar-data__link" href=".../event/...">; promotions use other markup.
  const re = /<a\s+class="avatar-data__link"\s+href="(https:\/\/muzi\.co\.il\/event\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(s))) {
    const header = headers.filter((h) => h.at < m.index).at(-1);
    if (!header) continue;
    const after = normalizeText(s.slice(m.index + m[0].length, m.index + m[0].length + 2500));
    const time = after.match(/תחילת הופעה:\s*([01]?\d|2[0-3]):([0-5]\d)/);
    const d = header.day;
    const hhmm = time ? `${time[1].padStart(2, '0')}:${time[2]}` : '21:00';
    const start = parseIsraelDate(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${hhmm}:00`);
    const title = cleanTitle(m[2]);
    if (!start || !title) continue;
    const price = after.match(/₪\s*\d+\s*-\s*₪\s*\d+/);
    out.push({
      sourceEventId: m[1],
      title,
      start,
      timeTbd: !time,
      end: null,
      category: 'concert',
      description: price ? price[0].replace(/\s+/g, ' ') : '',
      url: safeUrl(m[1]),
      extra: {},
    });
  }
  const next = s.match(/href="([^"]*events-by-hall\/[^"]*\/page\/(\d+)\/)"/gi) || [];
  return { events: out, pages: next.map((x) => x.match(/href="([^"]+)"/)[1]) };
}

module.exports = {
  id: 'muzi',
  name: 'muzi · הופעות בהיכל מנורה',
  homepage: PAGE,
  kind: 'guide',
  parsePage,
  async fetch() {
    const events = [];
    const seen = new Set([PAGE.toLowerCase()]);
    const queue = [PAGE];
    for (let i = 0; i < MAX_PAGES && queue.length; i++) {
      const url = queue.shift();
      const { events: evs, pages } = parsePage(await fetchText(url));
      events.push(...evs);
      for (const p of pages) {
        const key = p.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          queue.push(p);
        }
      }
    }
    const byId = new Map(events.map((e) => [e.sourceEventId, e]));
    return [...byId.values()];
  },
};
