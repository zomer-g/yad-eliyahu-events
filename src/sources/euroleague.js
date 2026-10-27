'use strict';

const { fetchJson, isVenueMatch } = require('../util');

const MENORA_VENUE_CODE = 'AQO';
const COMPETITIONS = [
  { code: 'E', name: 'יורוליג' },
  { code: 'U', name: 'יורוקאפ' },
];

// The basketball season starts in autumn: Oct 2026 belongs to season 2026.
function currentSeasonYear(now = new Date()) {
  return now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

function parseGames(json, competition, sourceUrl = null) {
  const games = (json && json.data) || [];
  return games
    .filter((g) => {
      const v = g.venue || {};
      return v.code === MENORA_VENUE_CODE || isVenueMatch(`${v.name} ${v.address}`);
    })
    .map((g) => {
      const home = g.local?.club?.name || '';
      const away = g.road?.club?.name || '';
      const start = new Date(g.utcDate || g.date);
      return {
        sourceEventId: g.identifier || g.id,
        title: `${home} נגד ${away}`,
        start,
        end: null,
        category: 'sports',
        description: `${competition.name}, ${g.roundName || `מחזור ${g.round}`}`,
        url: sourceUrl,
        confirmed: g.confirmedDate !== false && g.confirmedHour !== false,
        extra: { competition: competition.name, home, away, played: !!g.played },
      };
    })
    .filter((e) => !Number.isNaN(e.start.getTime()));
}

module.exports = {
  id: 'euroleague',
  name: 'EuroLeague / EuroCup API',
  homepage: 'https://www.euroleaguebasketball.net/',
  kind: 'sports',
  parseGames,
  async fetch() {
    const year = currentSeasonYear();
    const out = [];
    for (const c of COMPETITIONS) {
      const url = `https://api-live.euroleague.net/v2/competitions/${c.code}/seasons/${c.code}${year}/games`;
      out.push(...parseGames(await fetchJson(url), c, url));
    }
    return out;
  },
};
