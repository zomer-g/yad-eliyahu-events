'use strict';

const { fetchJson, parseIsraelDate, normalizeText, isVenueMatch, safeUrl } = require('../util');

// The municipal company that runs the arena publishes its booking calendar with Joomla DPCalendar.
// The calendar page loads its events from this JSON endpoint; Itemid 254 is the Menora Mivtachim calendar.
const BASE = 'https://www.sportpalace.co.il';
const ITEM_ID = 254;
const SPORTS_CALENDAR = 'dp-event-calendar-10';
const CLOSED_EVENT = /^אירוע סגור/;

function fmtDay(d) {
  return d.toISOString().slice(0, 10);
}

function cleanTitle(t) {
  let s = normalizeText(t);
  // Titles typed right-to-left sometimes carry the closing geresh at the start: "'בוי ג'ורג".
  if (/^['׳]/.test(s) && !/['׳]$/.test(s)) s = `${s.slice(1)}${s[0]}`;
  return s;
}

function parseCalendar(json) {
  const list = json && json.data && json.data.events;
  if (!Array.isArray(list)) throw new Error('unexpected calendar response');
  return list
    // All-day entries are bookings (set-up days, holds), not shows with an audience.
    .filter((e) => e && e.title && e.start && !e.allDay)
    .filter((e) => !Array.isArray(e.location) || !e.location.length || e.location.some((l) => isVenueMatch(l.title)))
    .map((e) => {
      const classes = [].concat(e.classNames || []);
      const title = cleanTitle(e.title);
      const closed = CLOSED_EVENT.test(title);
      return {
        sourceEventId: String(e.id),
        title,
        start: parseIsraelDate(e.start),
        // The calendar's end time is a one-hour placeholder, so the category's typical duration is used instead.
        end: null,
        category: classes.includes(SPORTS_CALENDAR) ? 'sports' : closed ? 'other' : null,
        description: closed ? 'אירוע סגור לקהל הרחב (לפי לוח ההיכל)' : '',
        url: e.url ? safeUrl(new URL(e.url, BASE).toString()) : null,
        extra: {},
      };
    })
    .filter((e) => e.start);
}

module.exports = {
  id: 'sportpalace',
  name: 'חברת היכלי הספורט (לוח ההיכל הרשמי)',
  homepage: `${BASE}/tlv-faclities/sport-halls/menora-hall/menorah-mivtachim-hall-events-calendar`,
  kind: 'venue',
  parseCalendar,
  async fetch() {
    const from = new Date(Date.now() - 86400000);
    const to = new Date(Date.now() + 365 * 86400000);
    const url = `${BASE}/index.php?option=com_dpcalendar&view=events&format=raw&limit=0&Itemid=${ITEM_ID}&date-start=${fmtDay(from)}&date-end=${fmtDay(to)}`;
    return parseCalendar(await fetchJson(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } }));
  },
};
