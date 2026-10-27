'use strict';

const euroleague = require('./euroleague');
const { jsonLdSource } = require('./jsonld');

// Ordered by priority: when several sources list the same event, the first one supplies the title.
module.exports = [
  euroleague,
  jsonLdSource({
    id: 'tickchak',
    name: "טיקצ'אק לייב",
    homepage: 'https://live.tickchak.co.il/tel-aviv-menorah-hall',
    pages: ['https://live.tickchak.co.il/tel-aviv-menorah-hall'],
  }),
];
