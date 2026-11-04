'use strict';

const euroleague = require('./euroleague');
const maccabi = require('./maccabi');
const ibasketball = require('./ibasketball');
const vivenu = require('./vivenu');
const ticketmaster = require('./ticketmaster');
const muzi = require('./muzi');
const sportpalace = require('./sportpalace');
const manual = require('./manual');
const { jsonLdSource } = require('./jsonld');

// Ordered by priority: when several sources list the same event, the first one supplies the title and time.
module.exports = [
  maccabi,
  ibasketball,
  euroleague,
  vivenu,
  ticketmaster,
  // muzi publishes the real start time; the arena calendar often shows a round placeholder hour.
  muzi,
  // The arena operator's own calendar: every booking, whichever company sells the tickets.
  sportpalace,
  jsonLdSource({
    id: 'tickchak',
    name: "טיקצ'אק לייב",
    homepage: 'https://live.tickchak.co.il/tel-aviv-menorah-hall',
    pages: ['https://live.tickchak.co.il/tel-aviv-menorah-hall'],
  }),
  manual,
];
