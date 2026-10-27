'use strict';

const crypto = require('node:crypto');
const { userAgent, VENUE } = require('./config');

const MAX_BODY_BYTES = 8 * 1024 * 1024;

// GET a URL with a timeout and a response-size cap. Returns the body as text.
async function fetchText(url, { timeoutMs = 25000, headers = {} } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': userAgent, 'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) throw new Error(`Response too large (${declared} bytes) for ${url}`);
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error(`Response too large for ${url}`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchJson(url, opts) {
  return JSON.parse(await fetchText(url, { ...opts, headers: { Accept: 'application/json', ...(opts && opts.headers) } }));
}

// Offset (in minutes) of Asia/Jerusalem from UTC at the given instant.
function tzOffsetMinutes(date, timeZone = VENUE.timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

// Parse a date string. Strings without an explicit offset are treated as Israel local time.
function parseIsraelDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const guess = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)));
  // Two passes handle the DST edge correctly.
  let d = new Date(guess.getTime() - tzOffsetMinutes(guess) * 60000);
  d = new Date(guess.getTime() - tzOffsetMinutes(d) * 60000);
  return d;
}

// YYYY-MM-DD of an instant in Israel.
function israelDay(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: VENUE.timezone }).format(date);
}

function normalizeText(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isVenueMatch(text) {
  const t = String(text || '').toLowerCase();
  return VENUE.aliases.some((a) => t.includes(a.toLowerCase()));
}

function shortHash(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
}

// Only allow http(s) links to be stored and shown.
function safeUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

module.exports = {
  fetchText, fetchJson, parseIsraelDate, israelDay, tzOffsetMinutes,
  normalizeText, isVenueMatch, shortHash, safeUrl,
};
