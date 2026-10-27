'use strict';

const { fetchText, normalizeText, isVenueMatch, safeUrl, israelDay } = require('../util');
const { userAgent } = require('../config');

const BOARD_URL = 'https://maccabi.co.il/game-board/';
const AJAX_URL = 'https://maccabi.co.il/wp-admin/admin-ajax.php';
const MAX_PAGES = 10;

// The game board loads its games through the public WordPress AJAX action the page itself uses.
function parseGames(games) {
  return games
    .filter((g) => g.status !== 'FINISHED' && isVenueMatch(g.venue))
    .map((g) => {
      const start = new Date(Number(g.timestamp) * 1000);
      // Games whose hour is not set yet are published at 00:00 Israel time.
      const timeTbd = /\|\s*00:00\s*$/.test(String(g.dateDisplay || ''));
      return {
        sourceEventId: String(g.id),
        title: `${normalizeText(g.team1?.name)} נגד ${normalizeText(g.team2?.name)}`,
        start,
        end: null,
        category: 'sports',
        description: [normalizeText(g.league), g.phase ? `מחזור ${normalizeText(g.phase)}` : '', normalizeText(g.round)].filter(Boolean).join(', '),
        url: safeUrl(g.link) || BOARD_URL,
        timeTbd,
        confirmed: !timeTbd,
        extra: { competition: normalizeText(g.league), home: normalizeText(g.team1?.name), away: normalizeText(g.team2?.name), venue: normalizeText(g.venue), day: israelDay(start) },
      };
    })
    .filter((e) => !Number.isNaN(e.start.getTime()));
}

module.exports = {
  id: 'maccabi',
  name: 'מכבי תל אביב · לוח משחקים',
  homepage: BOARD_URL,
  kind: 'sports',
  parseGames,
  async fetch() {
    const page = await fetchText(BOARD_URL);
    const nonce = (page.match(/gamesPageNonce\s*=\s*['"]([a-f0-9]+)['"]/) || [])[1];
    if (!nonce) throw new Error('games nonce not found on game board page');
    const games = [];
    for (let p = 1; p <= MAX_PAGES; p++) {
      const body = new FormData();
      body.append('action', 'load_more_games');
      body.append('nonce', nonce);
      body.append('page', String(p));
      body.append('lang', 'he');
      body.append('filters', '{}');
      const res = await fetch(AJAX_URL, { method: 'POST', body, headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(25000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${AJAX_URL}`);
      const json = await res.json();
      if (!json.success || !json.data || !Array.isArray(json.data.games)) throw new Error('unexpected games response');
      games.push(...json.data.games);
      if (!json.data.hasMore) break;
    }
    const seen = new Set();
    return parseGames(games).filter((e) => !seen.has(e.sourceEventId) && seen.add(e.sourceEventId));
  },
};
