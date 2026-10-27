'use strict';

const { fetchText, parseIsraelDate, normalizeText, isVenueMatch, safeUrl } = require('../util');

// Extracts schema.org Event items from the <script type="application/ld+json"> blocks of a page.
function extractEvents(html, pageUrl, { requireVenueMatch = false } = {}) {
  const blocks = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      blocks.push(JSON.parse(m[1].trim()));
    } catch {
      // Ignore malformed blocks; other blocks on the page may still be valid.
    }
  }

  const nodes = [];
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    nodes.push(n);
    if (n['@graph']) walk(n['@graph']);
    if (n.itemListElement) walk(n.itemListElement);
    if (n.item && typeof n.item === 'object') walk(n.item);
  };
  walk(blocks);

  const byId = new Map(nodes.filter((n) => n['@id']).map((n) => [n['@id'], n]));
  const resolve = (v) => (v && typeof v === 'object' && v['@id'] && byId.has(v['@id']) ? { ...byId.get(v['@id']), ...v } : v);
  const isEvent = (n) => [].concat(n['@type'] || []).some((t) => /Event$/.test(String(t)));

  const seen = new Set();
  const events = [];
  for (const raw of nodes) {
    if (!isEvent(raw) || !raw.startDate || !raw.name) continue;
    const n = resolve(raw);
    const loc = resolve(n.location) || {};
    const locText = `${loc.name || ''} ${typeof loc.address === 'string' ? loc.address : JSON.stringify(loc.address || '')}`;
    if (requireVenueMatch && !isVenueMatch(locText)) continue;
    const start = parseIsraelDate(n.startDate);
    if (!start) continue;
    const url = safeUrl(n.url || (n['@id'] || '').replace(/#.*$/, '')) || pageUrl;
    const id = n['@id'] || `${n.name}|${n.startDate}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const types = [].concat(n['@type']).map(String);
    const status = String(n.eventStatus || '');
    events.push({
      sourceEventId: id,
      title: normalizeText(n.name),
      start,
      end: parseIsraelDate(n.endDate),
      category: types.includes('MusicEvent') ? 'concert'
        : types.includes('SportsEvent') ? 'sports'
          : types.includes('ComedyEvent') || types.includes('TheaterEvent') ? 'show'
            : types.includes('BusinessEvent') || types.includes('EducationEvent') ? 'conference' : null,
      description: normalizeText(n.description).slice(0, 600),
      url,
      image: safeUrl([].concat(n.image || [])[0]),
      cancelled: /Cancelled/i.test(status),
      postponed: /Postponed|Rescheduled/i.test(status),
      extra: {
        performers: [].concat(n.performer || []).map((p) => normalizeText(resolve(p)?.name)).filter(Boolean),
        location: normalizeText(loc.name),
      },
    });
  }
  return events;
}

// Factory for a source backed by a page that publishes JSON-LD events.
function jsonLdSource({ id, name, homepage, pages, requireVenueMatch = false }) {
  return {
    id,
    name,
    homepage,
    kind: 'tickets',
    async fetch() {
      const out = [];
      for (const page of pages) {
        out.push(...extractEvents(await fetchText(page), page, { requireVenueMatch }));
      }
      return out;
    },
  };
}

module.exports = { extractEvents, jsonLdSource };
