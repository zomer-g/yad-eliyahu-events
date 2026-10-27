'use strict';

const { VENUE } = require('./config');

const CATEGORIES = {
  sports: { label: 'ספורט', durationMin: 135, attendance: 9500 },
  concert: { label: 'הופעה', durationMin: 150, attendance: 10000 },
  show: { label: 'מופע / סטנדאפ', durationMin: 120, attendance: 8000 },
  conference: { label: 'כנס / תערוכה', durationMin: 360, attendance: 5000 },
  other: { label: 'אחר', durationMin: 150, attendance: 7000 },
};

const KEYWORDS = [
  ['sports', /(נגד| vs\.? |מכבי|הפועל|יורוליג|יורוקאפ|גביע|ליגת|משחק|כדורסל|basketball|euroleague|maccabi|hapoel)/i],
  ['conference', /(כנס|ועידה|תערוכה|אקספו|summit|conference|expo|כנסת|טקס|graduation|סיום)/i],
  ['show', /(סטנדאפ|stand.?up|מופע|הצגה|קרקס|circus|on ice|על הקרח|מחזמר|בלט|קומדי)/i],
  ['concert', /(הופעה|קונצרט|concert|live|tour|סיבוב|מסיבה|party|פסטיבל|festival)/i],
];

const RIVALS = /(הפועל.*מכבי|מכבי.*הפועל|real madrid|ריאל|barcelona|ברצלונה|olympiacos|panathinaikos|fenerbahce|final|גמר)/i;

function inferCategory(ev) {
  if (ev.category && CATEGORIES[ev.category]) return ev.category;
  const text = `${ev.title} ${ev.description || ''}`;
  for (const [cat, re] of KEYWORDS) if (re.test(text)) return cat;
  return 'concert'; // Most arena events without a clear category are performances.
}

const fmt = new Intl.DateTimeFormat('he-IL', { timeZone: VENUE.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// Adds category, attendance and traffic estimates to a merged event.
function enrich(ev) {
  const category = inferCategory(ev);
  const c = CATEGORIES[category];
  let attendance = ev.attendance || c.attendance;
  if (!ev.attendance && category === 'sports' && RIVALS.test(`${ev.title} ${ev.description || ''}`)) attendance = VENUE.capacity;
  attendance = Math.min(attendance, VENUE.capacity);

  const start = new Date(ev.start);
  const end = ev.end ? new Date(ev.end) : new Date(start.getTime() + c.durationMin * 60000);
  const level = attendance >= 9000 ? 'high' : attendance >= 5000 ? 'medium' : 'low';
  // Arrival traffic builds up ~2 hours before start; departure traffic peaks right after the end.
  const arrival = { from: new Date(start.getTime() - 120 * 60000), to: new Date(start.getTime() + 15 * 60000) };
  const departure = { from: new Date(end.getTime() - 15 * 60000), to: new Date(end.getTime() + 75 * 60000) };

  const levelText = { high: 'עומס כבד', medium: 'עומס בינוני', low: 'עומס קל' }[level];
  const advice = ev.cancelled
    ? 'האירוע בוטל לפי המקור.'
    : `${levelText}. מומלץ להימנע מהגעה לאזור יגאל אלון / יד אליהו בין ${fmt.format(arrival.from)} ל-${fmt.format(arrival.to)}, ובין ${fmt.format(departure.from)} ל-${fmt.format(departure.to)} (פיזור הקהל).`;

  return {
    ...ev,
    category,
    categoryLabel: c.label,
    end: ev.end || null,
    estimatedEnd: end.toISOString(),
    traffic: {
      level,
      expectedAttendance: attendance,
      attendanceIsEstimate: !ev.attendance,
      arrivalWindow: { from: arrival.from.toISOString(), to: arrival.to.toISOString() },
      departureWindow: { from: departure.from.toISOString(), to: departure.to.toISOString() },
      advice,
    },
  };
}

module.exports = { enrich, inferCategory, CATEGORIES };
