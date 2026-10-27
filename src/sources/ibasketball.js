'use strict';

const { fetchJson, normalizeText, parseIsraelDate, safeUrl } = require('../util');

// SportsPress venue ids of Menora Mivtachim Arena on ibasketball.co.il (regular and "temporary" entries).
const VENUE_IDS = [5348, 19431];
const API = 'https://ibasketball.co.il/wp-json/sportspress/v2';

function parseEvents(events, leagueNames = {}) {
  return events
    .filter((e) => e && e.date && (e.venues || []).some((v) => VENUE_IDS.includes(v)))
    .map((e) => {
      const start = parseIsraelDate(e.date);
      // Matches without a set hour are stored with identical local and GMT timestamps.
      const timeTbd = e.date === e.date_gmt;
      const league = (e.leagues || []).map((id) => leagueNames[id]).filter(Boolean).join(', ');
      return {
        sourceEventId: String(e.id),
        title: normalizeText(e.title && e.title.rendered).replace(/\s+—\s+/, ' נגד '),
        start,
        end: null,
        category: 'sports',
        description: league,
        url: safeUrl(e.link),
        timeTbd,
        confirmed: !timeTbd,
        extra: { competition: league },
      };
    })
    .filter((e) => e.start && e.title);
}

module.exports = {
  id: 'ibasketball',
  name: 'איגוד הכדורסל (ibasketball)',
  homepage: 'https://ibasketball.co.il/',
  kind: 'sports',
  parseEvents,
  async fetch() {
    const after = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 19);
    const events = [];
    for (let page = 1; page <= 5; page++) {
      const batch = await fetchJson(`${API}/events?venues=${VENUE_IDS.join(',')}&after=${after}&per_page=100&page=${page}&order=asc&orderby=date`);
      if (!Array.isArray(batch)) throw new Error('unexpected events response');
      events.push(...batch);
      if (batch.length < 100) break;
    }
    const leagueIds = [...new Set(events.flatMap((e) => e.leagues || []))];
    const leagueNames = {};
    if (leagueIds.length) {
      try {
        const leagues = await fetchJson(`${API}/leagues?include=${leagueIds.join(',')}&per_page=100`);
        for (const l of leagues) leagueNames[l.id] = normalizeText(l.name);
      } catch {
        // League names are a nicety; the events are still valid without them.
      }
    }
    return parseEvents(events, leagueNames);
  },
};
