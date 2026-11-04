'use strict';

const { fetchText, parseIsraelDate, normalizeText, isVenueMatch, safeUrl, israelDay } = require('../util');
const { extractEvents } = require('./jsonld');

// Generic source for ticketing and venue sites that do not publish an API.
// For each listing page it uses, in order:
//   1. schema.org JSON-LD events on the page;
//   2. "cards": links that match `linkPattern`, read together with the text around them (title, date, time, venue);
//   3. event pages (from cards that were missing a date or venue, and from sitemaps), read with 1 and then with
//      the page's own title and text.
// A site that changes its markup makes the source fail or return 0 events, which the sources page shows.

const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const EN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(ינואר|פברואר|מרץ|מרס|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

function monthIndex(name) {
  const n = name.toLowerCase();
  if (n === 'מרס') return 2;
  const he = HE_MONTHS.indexOf(n);
  return he >= 0 ? he : EN_MONTHS.indexOf(n.slice(0, 3));
}

const DATE_PATTERNS = [
  // 2026-11-04
  { re: /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g, get: (m) => [+m[1], +m[2] - 1, +m[3]] },
  // 04 נובמבר 2026, 4 בנובמבר, 4 November 2026
  { re: new RegExp(`(?<![\\d:])(\\d{1,2})\\s*(?:ב|ב-|of\\s+)?${MONTH_RE}(?![a-zא-ת])\\.?,?\\s*(20\\d{2})?`, 'gi'), get: (m) => [m[3] ? +m[3] : null, monthIndex(m[2]), +m[1]] },
  // November 4, 2026 / Nov 4
  { re: new RegExp(`(?<![א-תa-z])${MONTH_RE}\\.?\\s+(\\d{1,2})(?![\\d:])(?:st|nd|rd|th)?,?\\s*(20\\d{2})?`, 'gi'), get: (m) => [m[3] ? +m[3] : null, monthIndex(m[1]), +m[2]] },
  // 04.11.2026, 04/11/26, 4.11
  { re: /(?<![\d.:/])(\d{1,2})[./](\d{1,2})(?:[./](20\d{2}|\d{2}))?(?![\d:]|[./]\d)/g, get: (m) => [m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null, +m[2] - 1, +m[1]] },
];

const TIME_RE = /(?<![\d.:/])([01]?\d|2[0-3]):([0-5]\d)(?!\d)/g;
const START_TIME_RE = /(?:תחילת\s+(?:ה)?(?:מופע|הופעה|אירוע|משחק)|מופע\s+(?:מתחיל|ב-?)|show\s*(?:starts?|time)?|start(?:s|\s+time)?)\D{0,15}?([01]?\d|2[0-3]):([0-5]\d)/i;

// Every calendar date written in `text`, with its position. Dates without a year get the next occurrence
// (looking back up to 60 days, so a listing of a show from last week keeps its year).
function findDates(text, now = new Date()) {
  const out = [];
  const today = israelDay(now);
  for (const { re, get } of DATE_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      let [y, mo, d] = get(m);
      if (mo < 0 || mo > 11 || d < 1 || d > 31) continue;
      if (y == null) {
        y = +today.slice(0, 4);
        const iso = `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        if (Date.parse(iso) < Date.parse(today) - 60 * 86400000) y += 1;
      }
      const probe = new Date(Date.UTC(y, mo, d));
      if (probe.getUTCMonth() !== mo) continue; // 31.11 and the like
      if (out.some((x) => m.index < x.index + x.length && x.index < m.index + m[0].length)) continue;
      out.push({ index: m.index, length: m[0].length, y, mo, d });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// Picks the event's date and start time from a block of text. Returns { start, timeTbd } or null.
// `upcomingOnly` skips dates that already passed (for whole event pages, which also carry publish dates).
function parseWhen(text, { now = new Date(), upcomingOnly = false, defaultTime = '21:00' } = {}) {
  let dates = findDates(text, now);
  if (upcomingOnly) dates = dates.filter((x) => Date.UTC(x.y, x.mo, x.d) >= Date.parse(israelDay(now)));
  if (!dates.length) return null;
  // Prefer a date that has a time written right after it.
  let pick = null;
  let time = null;
  for (const dt of dates) {
    const after = text.slice(dt.index + dt.length, dt.index + dt.length + 40);
    TIME_RE.lastIndex = 0;
    const tm = TIME_RE.exec(after);
    if (tm) {
      pick = dt;
      time = [tm[1], tm[2]];
      break;
    }
  }
  if (!pick) pick = dates[0];
  const explicitStart = text.match(START_TIME_RE);
  if (explicitStart) time = [explicitStart[1], explicitStart[2]];
  if (!time) {
    TIME_RE.lastIndex = 0;
    const any = TIME_RE.exec(text);
    if (any) time = [any[1], any[2]];
  }
  const [hh, mm] = time || defaultTime.split(':');
  const start = parseIsraelDate(`${pick.y}-${pad(pick.mo + 1)}-${pad(pick.d)}T${pad(hh)}:${pad(mm)}:00`);
  return start ? { start, timeTbd: !time } : null;
}

function stripNoise(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ');
}

function decodeHref(href) {
  return href.replace(/&amp;/g, '&').replace(/&#0?38;/g, '&');
}

function absolute(href, base) {
  try {
    return safeUrl(new URL(decodeHref(href), base).toString());
  } catch {
    return null;
  }
}

const GENERIC_LINK_TEXT = /^(לפרטים( נוספים)?|פרטים( נוספים)?|למידע נוסף|מידע נוסף|לרכישה|לרכישת כרטיסים|רכישת כרטיסים|כרטיסים|הזמינו( כרטיסים)?|להזמנה|הזמנת כרטיסים|קנו עכשיו|more( info)?|buy( tickets)?|tickets?|book( now)?|read more|לחצו כאן|אזל|sold out|\d+)$/i;

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? (m[2] ?? m[3]) : null;
}

function pickTitle(anchors, context) {
  const texts = anchors.flatMap((a) => [a.text, a.title, a.alt]).map(normalizeText)
    .filter((t) => t && t.length >= 2 && t.length <= 140 && !GENERIC_LINK_TEXT.test(t) && !findDates(t).length);
  if (texts.length) return texts.sort((a, b) => b.length - a.length)[0];
  const h = context.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
  const ht = h && normalizeText(h[1]);
  return ht && !GENERIC_LINK_TEXT.test(ht) ? ht : null;
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

// Start and end offsets of every element, from a forgiving pass over the tags (unclosed tags are dropped).
function elementSpans(html) {
  const spans = [];
  const stack = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g;
  let m;
  while ((m = re.exec(html))) {
    const name = m[2].toLowerCase();
    if (VOID_TAGS.has(name) || m[3]) continue;
    if (!m[1]) {
      stack.push({ name, start: m.index });
      continue;
    }
    const at = stack.map((x) => x.name).lastIndexOf(name);
    if (at < 0) continue;
    const open = stack[at];
    stack.length = at;
    spans.push({ start: open.start, end: m.index + m[0].length });
  }
  return spans;
}

// Cards on a listing page: every link that matches `linkPattern`, read with the text between it and its neighbours.
function extractCards(html, pageUrl, { linkPattern, requireVenueMatch = false, now = new Date() } = {}) {
  if (!linkPattern) return { events: [], incomplete: [] };
  const clean = stripNoise(html);
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  const anchors = [];
  let m;
  while ((m = re.exec(clean))) {
    const href = attr(m[1], 'href');
    const url = href && absolute(href, pageUrl);
    if (!url || !linkPattern.test(url) || url.replace(/[#?].*$/, '') === pageUrl.replace(/[#?].*$/, '')) continue;
    const img = m[2].match(/<img\b[^>]*>/i);
    anchors.push({
      url: url.replace(/#.*$/, ''), start: m.index, end: m.index + m[0].length,
      text: m[2], title: attr(m[1], 'title') || attr(m[1], 'aria-label'), alt: img ? attr(img[0], 'alt') : null,
    });
  }
  // Consecutive links to the same page (image + title + "buy" button) are one card.
  const groups = [];
  for (const a of anchors) {
    const last = groups.at(-1);
    if (last && last.url === a.url) {
      last.anchors.push(a);
      last.end = a.end;
    } else {
      groups.push({ url: a.url, start: a.start, end: a.end, anchors: [a] });
    }
  }

  const elements = elementSpans(clean);
  const events = [];
  const incomplete = [];
  groups.forEach((g, i) => {
    // The card is the largest element around the link that holds no other event link and is not too long.
    let card = null;
    for (const el of elements) {
      if (el.start > g.start || el.end < g.end) continue;
      if (groups.some((o, j) => j !== i && o.start < el.end && o.end > el.start)) continue;
      if (el.end - el.start > 20000 || normalizeText(clean.slice(el.start, el.end)).length > 800) continue;
      if (!card || el.end - el.start > card.end - card.start) card = el;
    }
    // No markup to go by: the text between the neighbouring cards, capped.
    const from = card ? card.start : Math.max(i > 0 ? groups[i - 1].end : 0, g.start - 600);
    const to = card ? card.end : Math.min(i < groups.length - 1 ? groups[i + 1].start : clean.length, g.end + 600);
    const context = clean.slice(from, to);
    const text = normalizeText(context);
    const title = pickTitle(g.anchors, context);
    const when = parseWhen(text, { now });
    const venueOk = !requireVenueMatch || isVenueMatch(text);
    if (!title || !when || !venueOk) {
      // Not enough on the listing; the event page itself may say more.
      incomplete.push(g.url);
      return;
    }
    events.push({
      sourceEventId: g.url,
      title,
      start: when.start,
      timeTbd: when.timeTbd,
      url: g.url,
      cancelled: /(בוטל|cancell?ed)/i.test(text),
      postponed: /(נדחה|postponed)/i.test(text),
      extra: {},
    });
  });
  return { events, incomplete: [...new Set(incomplete)] };
}

function metaContent(html, key) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, 'i');
  const tag = html.match(re);
  return tag ? normalizeText(attr(tag[0], 'content')) : null;
}

// One event page: JSON-LD first, otherwise the page title and the first upcoming date in its text.
function extractDetail(html, pageUrl, { requireVenueMatch = false, now = new Date() } = {}) {
  const ld = extractEvents(html, pageUrl, { requireVenueMatch });
  if (ld.length) return ld;
  const clean = stripNoise(html);
  const body = (clean.match(/<main\b[\s\S]*?<\/main>/i) || clean.match(/<body\b[\s\S]*<\/body>/i) || [clean])[0]
    .replace(/<(header|footer|nav)\b[\s\S]*?<\/\1>/gi, ' ');
  const text = normalizeText(body);
  if (requireVenueMatch && !isVenueMatch(text)) return [];
  const h1 = body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = (h1 && normalizeText(h1[1])) || metaContent(html, 'og:title')
    || normalizeText((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]).split(/\s+[|\-–]\s+/)[0];
  const when = parseWhen(text, { now, upcomingOnly: true });
  if (!title || !when) return [];
  return [{
    sourceEventId: pageUrl,
    title,
    start: when.start,
    timeTbd: when.timeTbd,
    url: pageUrl,
    description: (metaContent(html, 'og:description') || '').slice(0, 600),
    image: safeUrl(metaContent(html, 'og:image')),
    cancelled: /(האירוע בוטל|המופע בוטל|event cancell?ed)/i.test(text),
    postponed: /(נדחה|postponed)/i.test(text),
    extra: {},
  }];
}

// <loc> entries of a sitemap; nested sitemap indexes are returned separately.
function parseSitemap(xml) {
  const locs = [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((x) => decodeHref(x[1]));
  const isIndex = /<sitemapindex\b/i.test(xml);
  return isIndex ? { sitemaps: locs, urls: [] } : { sitemaps: [], urls: locs };
}

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await fn(items[idx]);
      } catch {
        out[idx] = [];
      }
    }
  });
  await Promise.all(workers);
  return out;
}

function dedupe(events) {
  const seen = new Map();
  for (const e of events) {
    const key = `${israelDay(e.start)}|${normalizeText(e.title).toLowerCase()}`;
    if (!seen.has(key)) seen.set(key, e);
  }
  return [...seen.values()];
}

// Factory. Options:
//   pages             listing pages to read
//   linkPattern       RegExp for links to single events (cards and sitemap URLs)
//   requireVenueMatch the pages list several venues; keep only events whose text names this arena
//   sitemaps          sitemap URLs whose matching entries are read as event pages
//   sitemapFilter     RegExp for nested sitemaps worth following in a sitemap index
//   detailLimit       most event pages to read per run
//   category          default category for every event of this source
function listingSource({
  id, name, homepage, pages = [], linkPattern = null, requireVenueMatch = false,
  sitemaps = [], sitemapFilter = null, detailLimit = 40, category = null, fetchPage = fetchText,
}) {
  return {
    id,
    name,
    homepage,
    kind: 'tickets',
    async fetch() {
      const now = new Date();
      const events = [];
      const detail = new Set();
      const errors = [];
      let pagesRead = 0;

      for (const page of pages) {
        let html;
        try {
          html = await fetchPage(page);
          pagesRead++;
        } catch (err) {
          errors.push(err.message);
          continue;
        }
        events.push(...extractEvents(html, page, { requireVenueMatch }));
        const cards = extractCards(html, page, { linkPattern, requireVenueMatch, now });
        events.push(...cards.events);
        cards.incomplete.forEach((u) => detail.add(u));
      }

      for (const sm of sitemaps) {
        try {
          let { sitemaps: nested, urls } = parseSitemap(await fetchPage(sm));
          pagesRead++;
          if (sitemapFilter) nested = nested.filter((u) => sitemapFilter.test(u));
          for (const n of nested.slice(0, 5)) urls = urls.concat(parseSitemap(await fetchPage(n)).urls);
          urls.filter((u) => !linkPattern || linkPattern.test(u)).forEach((u) => detail.add(u));
        } catch (err) {
          errors.push(err.message);
        }
      }

      if (!pagesRead) throw new Error(errors[0] || 'no pages configured');

      const known = new Set(events.map((e) => e.url));
      const todo = [...detail].filter((u) => !known.has(u)).slice(0, detailLimit);
      const fromDetail = await mapLimit(todo, 4, async (u) => extractDetail(await fetchPage(u), u, { requireVenueMatch, now }));
      events.push(...fromDetail.flat());

      return dedupe(events).map((e) => ({ ...e, category: e.category || category }));
    },
  };
}

module.exports = { listingSource, extractCards, extractDetail, parseWhen, findDates, parseSitemap };
