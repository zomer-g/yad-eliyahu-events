'use strict';

const euroleague = require('./euroleague');
const maccabi = require('./maccabi');
const ibasketball = require('./ibasketball');
const vivenu = require('./vivenu');
const manual = require('./manual');
const { jsonLdSource } = require('./jsonld');
const { listingSource } = require('./listing');

// Ordered by priority: when several sources list the same event, the first one supplies the title and time.
module.exports = [
  maccabi,
  ibasketball,
  euroleague,
  vivenu,
  // Live Nation Israel sells its arena shows (international acts and most big Israeli 360° shows) only here.
  listingSource({
    id: 'ticketmaster',
    name: 'טיקטמאסטר ישראל (Live Nation)',
    homepage: 'https://www.ticketmaster.co.il/homepage/ALL/iw',
    pages: ['https://www.ticketmaster.co.il/homepage/ALL/iw', 'https://www.ticketmaster.co.il/homepage/ALL/en'],
    linkPattern: /^https:\/\/(www\.)?ticketmaster\.co\.il\/(performance|event)\/[A-Za-z0-9]+\//,
    sitemaps: ['https://www.ticketmaster.co.il/sitemap.xml'],
    requireVenueMatch: true,
    detailLimit: 60,
  }),
  // The municipal company that runs the arena; its calendar lists every booking, including shows sold elsewhere.
  listingSource({
    id: 'sportpalace',
    name: 'חברת היכלי הספורט ת"א-יפו (מפעילת ההיכל)',
    homepage: 'https://www.sportpalace.co.il/tlv-faclities/sport-halls/menora-hall/menorah-mivtachim-hall-events-calendar',
    pages: [
      'https://www.sportpalace.co.il/tlv-faclities/sport-halls/menora-hall/menorah-mivtachim-hall-events-calendar',
      'https://www.sportpalace.co.il/tlv-faclities/sport-halls/menora-hall',
      'https://www.sportpalace.co.il/',
    ],
    linkPattern: /^https:\/\/(www\.)?sportpalace\.co\.il\/tlv-faclities\/sport-halls\/menora-hall\/menorah-mivtachim-hall-events-calendar\/[^/?#]+/,
    detailLimit: 40,
  }),
  jsonLdSource({
    id: 'tickchak',
    name: "טיקצ'אק לייב",
    homepage: 'https://live.tickchak.co.il/tel-aviv-menorah-hall',
    pages: ['https://live.tickchak.co.il/tel-aviv-menorah-hall'],
  }),
  // Concert guides that list shows across all ticket vendors, by venue.
  listingSource({
    id: 'muzi',
    name: 'muzi · הופעות בהיכל מנורה',
    homepage: 'https://muzi.co.il/events-by-hall/%D7%94%D7%99%D7%9B%D7%9C-%D7%9E%D7%A0%D7%95%D7%A8%D7%94/',
    pages: ['https://muzi.co.il/events-by-hall/%D7%94%D7%99%D7%9B%D7%9C-%D7%9E%D7%A0%D7%95%D7%A8%D7%94/'],
  }),
  listingSource({
    id: 'bandsintown',
    name: 'Bandsintown',
    homepage: 'https://www.bandsintown.com/v/10009795-menora-mivtachim-arena',
    pages: ['https://www.bandsintown.com/v/10009795-menora-mivtachim-arena'],
    category: 'concert',
  }),
  manual,
];
