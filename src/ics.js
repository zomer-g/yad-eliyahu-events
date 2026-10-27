'use strict';

const { VENUE } = require('./config');

function icsDate(iso) {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function esc(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
}

// RFC 5545 line folding at 75 octets.
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out = [];
  let cur = '';
  let curLen = 0;
  for (const ch of line) {
    const len = Buffer.byteLength(ch, 'utf8');
    if (curLen + len > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      curLen = 0;
    }
    cur += ch;
    curLen += len;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const timeFmt = new Intl.DateTimeFormat('he-IL', { timeZone: VENUE.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function buildIcs(events, { baseUrl = '', calName = 'אירועים בהיכל מנורה (יד אליהו)', trafficBlocks = false } = {}) {
  const now = icsDate(new Date().toISOString());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//yad-eliyahu-events//HE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(calName)}`,
    `X-WR-TIMEZONE:${VENUE.timezone}`,
    'X-PUBLISHED-TTL:PT3H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT3H',
  ];
  for (const ev of events) {
    const t = ev.traffic;
    const desc = [
      `${ev.categoryLabel} · ${t.advice}`,
      `קהל צפוי: כ-${t.expectedAttendance.toLocaleString('en-US')}${t.attendanceIsEstimate ? ' (הערכה)' : ''}`,
      ev.description,
      'מקורות:',
      ...ev.sources.map((s) => `- ${s.name}: ${s.url || ''}`),
      baseUrl ? `פרטים: ${baseUrl}/#event-${ev.id}` : '',
    ].filter(Boolean).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${ev.id}@yad-eliyahu-events`,
      `DTSTAMP:${now}`,
      `DTSTART:${icsDate(ev.start)}`,
      `DTEND:${icsDate(ev.end || ev.estimatedEnd)}`,
      `SUMMARY:${esc(`${ev.cancelled ? '[בוטל] ' : ''}${ev.title} (${ev.categoryLabel})`)}`,
      `LOCATION:${esc(`${VENUE.name}, ${VENUE.address}`)}`,
      `GEO:${VENUE.lat};${VENUE.lon}`,
      `DESCRIPTION:${esc(desc)}`,
      `STATUS:${ev.cancelled ? 'CANCELLED' : ev.confirmed ? 'CONFIRMED' : 'TENTATIVE'}`,
      'TRANSP:TRANSPARENT',
    );
    if (ev.sources[0] && ev.sources[0].url) lines.push(`URL:${ev.sources[0].url}`);
    lines.push('END:VEVENT');

    if (trafficBlocks && !ev.cancelled) {
      for (const [kind, w] of [['arrival', t.arrivalWindow], ['departure', t.departureWindow]]) {
        lines.push(
          'BEGIN:VEVENT',
          `UID:${ev.id}-${kind}@yad-eliyahu-events`,
          `DTSTAMP:${now}`,
          `DTSTART:${icsDate(w.from)}`,
          `DTEND:${icsDate(w.to)}`,
          `SUMMARY:${esc(`🚗 ${kind === 'arrival' ? 'עומס הגעה' : 'עומס יציאה'}: ${ev.title}`)}`,
          `DESCRIPTION:${esc(`${timeFmt.format(new Date(w.from))} עד ${timeFmt.format(new Date(w.to))} · ${t.advice}`)}`,
          `LOCATION:${esc(VENUE.address)}`,
          'TRANSP:TRANSPARENT',
          'END:VEVENT',
        );
      }
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

module.exports = { buildIcs };
