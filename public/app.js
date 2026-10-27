'use strict';

(function () {
  const TZ = 'Asia/Jerusalem';
  const dayFmt = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
  const timeFmt = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
  const dateTimeFmt = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const LEVEL = { high: 'עומס כבד', medium: 'עומס בינוני', low: 'עומס קל' };

  let events = [];
  let category = '';

  function el(tag, attrs, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'href') n.setAttribute('href', safeHref(v));
      else n.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return n;
  }

  function safeHref(u) {
    try {
      const url = new URL(u, location.href);
      return ['http:', 'https:', 'webcal:'].includes(url.protocol) ? url.href : '#';
    } catch (e) {
      return '#';
    }
  }

  function range(w) {
    return `${timeFmt.format(new Date(w.from))} עד ${timeFmt.format(new Date(w.to))}`;
  }

  function relDay(d) {
    const today = dateKey.format(new Date());
    const tomorrow = dateKey.format(new Date(Date.now() + 86400000));
    const k = dateKey.format(d);
    if (k === today) return 'היום';
    if (k === tomorrow) return 'מחר';
    return null;
  }

  function gcalEventLink(ev) {
    const f = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const p = new URLSearchParams({
      action: 'TEMPLATE',
      text: `${ev.title} (${ev.categoryLabel})`,
      dates: `${f(ev.start)}/${f(ev.end || ev.estimatedEnd)}`,
      location: 'היכל מנורה מבטחים, יגאל אלון 51, תל אביב',
      details: `${ev.traffic.advice}\n${location.origin}/#event-${ev.id}`,
      ctz: TZ,
    });
    return `https://calendar.google.com/calendar/render?${p}`;
  }

  function card(ev) {
    const start = new Date(ev.start);
    const t = ev.traffic;
    const badges = [
      el('span', { class: `badge cat-${ev.category}` }, ev.categoryLabel),
      el('span', { class: `badge lvl-${t.level}` }, LEVEL[t.level]),
      ev.cancelled && el('span', { class: 'badge warn' }, 'בוטל'),
      ev.postponed && el('span', { class: 'badge warn' }, 'נדחה'),
      !ev.confirmed && el('span', { class: 'badge warn' }, 'מועד לא סופי'),
    ];
    return el('article', { class: `card${ev.cancelled ? ' cancelled' : ''}`, id: `event-${ev.id}` },
      el('div', { class: 'time' }, timeFmt.format(start)),
      el('div', { class: 'body' },
        el('h3', null, ev.title),
        el('div', { class: 'badges' }, badges),
        el('dl', { class: 'traffic' },
          el('dt', null, 'עומס הגעה'), el('dd', null, range(t.arrivalWindow)),
          el('dt', null, 'עומס יציאה'), el('dd', null, range(t.departureWindow)),
          el('dt', null, 'קהל צפוי'), el('dd', null, `כ-${t.expectedAttendance.toLocaleString('he-IL')}${t.attendanceIsEstimate ? ' (הערכה)' : ''}`)),
        ev.description && el('p', { class: 'desc' }, ev.description),
        el('details', null,
          el('summary', null, `מקורות (${ev.sources.length})`),
          el('ul', { class: 'srcs' }, ev.sources.map((s) => el('li', null,
            s.url ? el('a', { href: s.url, target: '_blank', rel: 'noopener nofollow' }, s.name) : s.name,
            ` · ${s.title} · ${dateTimeFmt.format(new Date(s.start))}`))),
          el('p', { class: 'muted small' }, `נמצא לראשונה: ${dateTimeFmt.format(new Date(ev.firstSeen))}`)),
        el('div', { class: 'actions' },
          el('a', { class: 'btn small', href: gcalEventLink(ev), target: '_blank', rel: 'noopener' }, '+ ליומן'),
          el('a', { class: 'btn small', href: `/api/events/${ev.id}`, target: '_blank' }, 'JSON'))));
  }

  function renderNext() {
    const box = document.getElementById('next');
    const now = Date.now();
    const ev = events.find((e) => !e.cancelled && new Date(e.end || e.estimatedEnd).getTime() > now);
    if (!ev) { box.hidden = true; return; }
    const start = new Date(ev.start);
    const live = start.getTime() <= now;
    const rd = relDay(start);
    box.hidden = false;
    box.className = `next lvl-${ev.traffic.level}`;
    box.replaceChildren(
      el('div', { class: 'label' }, live ? 'מתקיים עכשיו' : 'האירוע הבא'),
      el('div', { class: 'title' }, ev.title),
      el('div', { class: 'when' }, `${rd ? `${rd}, ` : ''}${dayFmt.format(start)} · ${timeFmt.format(start)}`),
      el('p', null, ev.traffic.advice),
      el('a', { href: `#event-${ev.id}`, class: 'btn small' }, 'לפרטים'));
  }

  function renderList() {
    const list = document.getElementById('list');
    const shown = events.filter((e) => !category || e.category === category);
    if (!shown.length) {
      list.replaceChildren(el('p', { class: 'muted' }, 'אין אירועים צפויים בקטגוריה הזו כרגע.'));
      return;
    }
    const groups = new Map();
    for (const ev of shown) {
      const k = dateKey.format(new Date(ev.start));
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(ev);
    }
    const out = [];
    for (const evs of groups.values()) {
      const d = new Date(evs[0].start);
      const rd = relDay(d);
      out.push(el('h2', { class: `day${rd ? ' soon' : ''}` }, `${rd ? `${rd} · ` : ''}${dayFmt.format(d)}`), ...evs.map(card));
    }
    list.replaceChildren(...out);
    if (location.hash) {
      const target = document.getElementById(location.hash.slice(1));
      if (target) { target.classList.add('focus'); target.scrollIntoView({ block: 'center' }); }
    }
  }

  function renderSources(sources) {
    const ul = document.getElementById('sourceList');
    ul.replaceChildren(...sources.map((s) => el('li', null,
      el('span', { class: `dot ${s.ok === false ? 'bad' : s.ok ? 'ok' : ''}` }),
      el('a', { href: s.homepage, target: '_blank', rel: 'noopener' }, s.name),
      ` · ${s.eventCount} אירועים`,
      s.lastSuccess ? ` · עודכן ${dateTimeFmt.format(new Date(s.lastSuccess))}` : '',
      s.ok === false ? el('span', { class: 'muted small' }, ` (שגיאה בריצה האחרונה)`) : '')));
  }

  function setupSubscribe() {
    const cb = document.getElementById('withTraffic');
    const update = () => {
      const path = `/calendar.ics${cb.checked ? '?traffic=1' : ''}`;
      const https = `${location.origin}${path}`;
      const webcal = https.replace(/^https?:/, 'webcal:');
      document.getElementById('icsUrl').textContent = https;
      document.getElementById('gcal').setAttribute('href', safeHref(`https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`));
    };
    cb.addEventListener('change', update);
    update();
    document.getElementById('copyIcs').addEventListener('click', async (e) => {
      try {
        await navigator.clipboard.writeText(document.getElementById('icsUrl').textContent);
        e.target.textContent = 'הועתק ✓';
      } catch (err) {
        e.target.textContent = 'העתיקו ידנית מהשורה למטה';
      }
    });
  }

  function setupFilters() {
    for (const chip of document.querySelectorAll('.chip')) {
      chip.addEventListener('click', () => {
        category = chip.dataset.cat;
        document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
        renderList();
      });
    }
  }

  async function load() {
    try {
      const [er, sr] = await Promise.all([fetch('/api/events'), fetch('/api/sources')]);
      const data = await er.json();
      events = data.events || [];
      renderNext();
      renderList();
      renderSources((await sr.json()).sources || []);
      document.getElementById('updated').textContent = data.updatedAt ? `עודכן: ${dateTimeFmt.format(new Date(data.updatedAt))}` : '';
    } catch (err) {
      document.getElementById('list').replaceChildren(el('p', { class: 'muted' }, 'שגיאה בטעינת האירועים. נסו לרענן.'));
    }
  }

  setupSubscribe();
  setupFilters();
  load();
  setInterval(load, 10 * 60000);
})();
