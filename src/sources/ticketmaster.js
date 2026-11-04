'use strict';

const { fetchJson, normalizeText, isVenueMatch, safeUrl } = require('../util');

// Ticketmaster Israel (Live Nation) sells most international acts and many big Israeli shows.
// Its web client reads these public JSON endpoints; events at Menora carry venue code "MM".
const API = 'https://www.ticketmaster.co.il/wbtxapi/api/v1/bxcached/event';
const VENUE_CODE = 'MM';
const IMAGES = 'https://www.ticketmaster.co.il/static/images/live/event';

function toEvent({ code, name, venueCode, venueName, first, last, image, customUrl }) {
  if (!code || !name || !first) return null;
  if (venueCode !== VENUE_CODE && !isVenueMatch(venueName)) return null;
  const start = new Date(first);
  if (Number.isNaN(start.getTime())) return null;
  return {
    sourceEventId: code,
    title: normalizeText(name),
    start,
    end: null,
    category: null,
    // Events with several shows publish only the first and last date.
    description: last && last !== first ? 'כמה מועדים, ראו באתר טיקטמאסטר' : '',
    url: `https://www.ticketmaster.co.il/event/${encodeURIComponent(code)}/ALL/iw`,
    image: image ? safeUrl(`${IMAGES}/${encodeURIComponent(image)}`) : null,
    extra: { info: safeUrl(customUrl) },
  };
}

// getAllTopEvent: { data: [ { btxEventId, eventName, venueCode, venueName, firstPerformanceDate, ... } ] }
// getSpotLightData: { data: { elements: [ { event: { eventCode, eventName, venueId, ... } } ] } }
function parseEvents(top, spotlight) {
  const rows = [];
  for (const e of [].concat(top && top.data || [])) {
    if (!e || e.eventType === 'GROUP') continue;
    rows.push(toEvent({
      code: e.btxEventId, name: e.eventName, venueCode: e.venueCode, venueName: e.venueName,
      first: e.firstPerformanceDate, last: e.lastPerformanceDate, image: e.smallImage, customUrl: e.customUrl,
    }));
  }
  for (const el of [].concat(spotlight && spotlight.data && spotlight.data.elements || [])) {
    const e = el && el.event;
    if (!e) continue;
    rows.push(toEvent({
      code: e.eventCode, name: e.eventName, venueCode: e.venueId, venueName: e.venueName,
      first: e.firstPerformanceDate, last: e.lastPerformanceDate, image: null, customUrl: e.customUrl,
    }));
  }
  const byCode = new Map();
  for (const r of rows) if (r && !byCode.has(r.sourceEventId)) byCode.set(r.sourceEventId, r);
  return [...byCode.values()];
}

module.exports = {
  id: 'ticketmaster',
  name: 'טיקטמאסטר ישראל (Live Nation)',
  homepage: 'https://www.ticketmaster.co.il/homepage/ALL/iw',
  kind: 'tickets',
  parseEvents,
  async fetch() {
    const [top, spotlight] = await Promise.all([
      fetchJson(`${API}/getAllTopEvent/iw`),
      fetchJson(`${API}/getSpotLightData/ALL/ALL/iw`).catch(() => null),
    ]);
    if (!top || top.status !== 'SUCCESS' || !Array.isArray(top.data)) throw new Error('unexpected Ticketmaster response');
    return parseEvents(top, spotlight);
  },
};
