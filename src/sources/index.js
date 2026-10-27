'use strict';

const euroleague = require('./euroleague');
const maccabi = require('./maccabi');
const ibasketball = require('./ibasketball');
const vivenu = require('./vivenu');
const { jsonLdSource } = require('./jsonld');

// Ordered by priority: when several sources list the same event, the first one supplies the title and time.
module.exports = [
  maccabi,
  ibasketball,
  euroleague,
  vivenu,
  jsonLdSource({
    id: 'tickchak',
    name: "טיקצ'אק לייב",
    homepage: 'https://live.tickchak.co.il/tel-aviv-menorah-hall',
    pages: ['https://live.tickchak.co.il/tel-aviv-menorah-hall'],
  }),
];
