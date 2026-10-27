'use strict';

const VENUE = {
  name: 'היכל מנורה מבטחים',
  nameEn: 'Menora Mivtachim Arena',
  aliases: [
    'מנורה מבטחים', 'היכל מנורה', 'היכל יד אליהו', 'יד אליהו', 'היכל נוקיה',
    'menora mivtachim', 'menora arena', 'menorah hall', 'yad eliyahu', 'nokia arena',
  ],
  address: 'יגאל אלון 51, תל אביב-יפו',
  lat: 32.0612901,
  lon: 34.7915565,
  capacity: 11000,
  timezone: 'Asia/Jerusalem',
};

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

module.exports = {
  VENUE,
  port: int(process.env.XHOSTD_HTTP_PORT || process.env.XHOST_HTTP_PORT || process.env.PORT, 3000),
  databaseUrl: process.env.DATABASE_URL || '',
  // How often to re-scrape all sources.
  refreshMinutes: int(process.env.REFRESH_MINUTES, 180),
  // Optional token that allows POST /api/refresh. When unset the endpoint is disabled.
  adminToken: process.env.ADMIN_TOKEN || '',
  baseUrl: (process.env.BASE_URL || process.env.XHOSTD_URL || '').replace(/\/+$/, ''),
  // Google Analytics 4 measurement id (G-XXXXXXX). Analytics stays off when unset or malformed.
  gaMeasurementId: /^G-[A-Z0-9]{4,20}$/.test(process.env.GA_MEASUREMENT_ID || '') ? process.env.GA_MEASUREMENT_ID : '',
  userAgent: 'Mozilla/5.0 (compatible; YadEliyahuEvents/1.0; +https://github.com/zomer-g/yad-eliyahu-events)',
};
