'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const config = require('./config');
const { createStore } = require('./store');
const { Aggregator } = require('./aggregator');
const { buildIcs } = require('./ics');
const { CATEGORIES } = require('./enrich');
const sources = require('./sources');
const openapi = require('./openapi');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/api': ['api.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/api.js': ['api.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
};

// Simple fixed-window rate limit per client IP.
const RATE_LIMIT = 120;
const hits = new Map();
setInterval(() => hits.clear(), 60000).unref();

// The platform proxy appends the real client address last; earlier entries are client-controlled.
function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return fwd.at(-1) || req.socket.remoteAddress || 'unknown';
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(res.req.method === 'HEAD' ? undefined : body);
}

function sendJson(res, status, obj, extra = {}) {
  send(res, status, JSON.stringify(obj, null, 2), {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=120',
    ...extra,
  });
}

function parseDateParam(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function filterEvents(events, q) {
  const now = new Date();
  const from = parseDateParam(q.get('from'));
  const to = parseDateParam(q.get('to'));
  if (from === undefined || to === undefined) return { error: 'Invalid from/to date. Use ISO 8601, e.g. 2026-11-01.' };
  const category = q.get('category');
  if (category && !CATEGORIES[category]) return { error: `Unknown category. Use one of: ${Object.keys(CATEGORIES).join(', ')}` };
  const includePast = q.get('include_past') === 'true';
  const limitRaw = Number.parseInt(q.get('limit') || '200', 10);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 200, 1), 500);
  const lower = from || (includePast ? null : new Date(now.getTime() - 6 * 3600000));
  const list = events.filter((e) => {
    const s = new Date(e.start);
    const end = new Date(e.end || e.estimatedEnd);
    if (lower && end < lower) return false;
    if (to && s > to) return false;
    if (category && e.category !== category) return false;
    return true;
  });
  return { list: list.slice(0, limit), total: list.length };
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function createHandler(agg) {
  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname.replace(/\/+$/, '') || '/';

    const ip = clientIp(req);
    if (hits.size > 50000) hits.clear();
    const n = (hits.get(ip) || 0) + 1;
    hits.set(ip, n);
    if (n > RATE_LIMIT) return sendJson(res, 429, { error: 'Too many requests' }, { 'Retry-After': '60' });

    if (req.method === 'OPTIONS') {
      return send(res, 204, '', {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Max-Age': '86400',
      });
    }

    if (req.method === 'POST' && p === '/api/refresh') {
      const auth = String(req.headers.authorization || '');
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!config.adminToken || !token || !safeEqual(token, config.adminToken)) {
        return sendJson(res, 401, { error: 'Unauthorized' }, { 'Cache-Control': 'no-store' });
      }
      agg.refresh().catch(() => {});
      return sendJson(res, 202, { status: 'refresh started' }, { 'Cache-Control': 'no-store' });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, HEAD, OPTIONS' });
    }

    if (STATIC[p]) {
      const [file, type] = STATIC[p];
      return fs.readFile(path.join(PUBLIC_DIR, file), (err, buf) => {
        if (err) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
        send(res, 200, buf, { 'Content-Type': type, 'Cache-Control': 'public, max-age=300' });
      });
    }

    if (p === '/healthz') return sendJson(res, 200, { ok: true, events: agg.events.length, updatedAt: agg.updatedAt }, { 'Cache-Control': 'no-store' });

    if (p === '/api/events') {
      const r = filterEvents(agg.events, url.searchParams);
      if (r.error) return sendJson(res, 400, { error: r.error });
      return sendJson(res, 200, { venue: config.VENUE, updatedAt: agg.updatedAt, total: r.total, count: r.list.length, events: r.list });
    }

    if (p === '/api/next') {
      const now = new Date();
      const ev = agg.events.find((e) => !e.cancelled && new Date(e.end || e.estimatedEnd) > now) || null;
      return sendJson(res, 200, { updatedAt: agg.updatedAt, event: ev });
    }

    const m = p.match(/^\/api\/events\/([a-f0-9]{16})$/);
    if (m) {
      const ev = agg.events.find((e) => e.id === m[1]);
      return ev ? sendJson(res, 200, ev) : sendJson(res, 404, { error: 'Event not found' });
    }

    if (p === '/api/sources') return sendJson(res, 200, { updatedAt: agg.updatedAt, sources: agg.sourceStatus() });
    if (p === '/api/categories') {
      return sendJson(res, 200, Object.fromEntries(Object.entries(CATEGORIES).map(([k, v]) => [k, v.label])));
    }
    if (p === '/api/openapi.json') return sendJson(res, 200, openapi(config.baseUrl));

    if (p === '/calendar.ics') {
      const q = new URLSearchParams(url.searchParams);
      q.set('include_past', 'false');
      q.delete('from');
      q.set('from', new Date(Date.now() - 30 * 86400000).toISOString());
      q.set('limit', '500');
      const r = filterEvents(agg.events, q);
      if (r.error) return sendJson(res, 400, { error: r.error });
      const ics = buildIcs(r.list, { baseUrl: config.baseUrl, trafficBlocks: url.searchParams.get('traffic') === '1' });
      return send(res, 200, ics, {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="yad-eliyahu-events.ics"',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=900',
      });
    }

    return sendJson(res, 404, { error: 'Not found' });
  };
}

async function main() {
  const log = {
    info: (...a) => console.log(new Date().toISOString(), ...a),
    warn: (...a) => console.warn(new Date().toISOString(), ...a),
    error: (...a) => console.error(new Date().toISOString(), ...a),
  };
  const store = createStore(config.databaseUrl);
  await store.init();
  const agg = new Aggregator(store, sources, { log });
  await agg.load();

  const handler = createHandler(agg);
  const server = http.createServer((req, res) => {
    handler(req, res).catch((err) => {
      log.error('[http]', err);
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' });
    });
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.listen(config.port, '0.0.0.0', () => log.info(`[server] listening on ${config.port} (${config.databaseUrl ? 'postgres' : 'memory'} store)`));

  // Scrape on boot, then on a fixed interval.
  agg.refresh().catch((err) => log.error('[scrape]', err));
  setInterval(() => agg.refresh().catch((err) => log.error('[scrape]', err)), config.refreshMinutes * 60000).unref();

  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { createHandler, filterEvents };
