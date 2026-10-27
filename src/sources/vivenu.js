'use strict';

const { fetchJson, normalizeText, isVenueMatch } = require('../util');

// Leaan sells tickets through Vivenu; one public listings call returns every event of the Leaan organisation.
const LEAAN_ORG_ID = '63651ec16933da2b73dce6c2';
const MACCABI_SELLER_ID = '670e1f99266913e795a515b1';
// Season passes, parking permits, duplicate "unreserved" listings and non-event products.
const SKIP_NAME = /(תו חניה|מנוי|לא מסומן|נקודות מועדון|טופס|שובר|gift|voucher)/i;

function eventUrl(e) {
  if (!e.url) return null;
  const host = e.sellerId === MACCABI_SELLER_ID ? 'tickets.maccabitickets.co.il' : 'tickets.leaan.net';
  return `https://${host}/event/${encodeURIComponent(e.url)}`;
}

function parseListings(list) {
  return list
    .filter((e) => e && e.eventType !== 'GROUP' && e.start && e.name && !SKIP_NAME.test(e.name))
    .filter((e) => isVenueMatch(`${e.locationName || ''} ${e.locationStreet || ''}`))
    .map((e) => {
      const name = normalizeText(e.name);
      return {
        sourceEventId: String(e._id),
        title: name.replace(/\s+-\s+/, ' נגד '),
        start: new Date(e.start),
        end: e.end ? new Date(e.end) : null,
        category: e.sellerId === MACCABI_SELLER_ID ? 'sports' : null,
        description: e.saleStatus === 'onSale' ? 'כרטיסים במכירה' : '',
        url: eventUrl(e),
        extra: { seller: e.sellerId, saleStatus: e.saleStatus || null },
      };
    })
    .filter((e) => !Number.isNaN(e.start.getTime()));
}

module.exports = {
  id: 'vivenu',
  name: 'לאן / Vivenu (כרטיסים)',
  homepage: 'https://www.leaan.co.il/',
  kind: 'tickets',
  parseListings,
  async fetch() {
    const endMin = new Date(Date.now() - 86400000).toISOString();
    const list = await fetchJson(`https://vivenu.com/api/events/public/listings?orgId=${LEAAN_ORG_ID}&endMin=${encodeURIComponent(endMin)}&top=1000`);
    if (!Array.isArray(list)) throw new Error('unexpected listings response');
    return parseListings(list);
  },
};
