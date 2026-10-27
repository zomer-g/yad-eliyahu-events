'use strict';

(function () {
  const TZ = 'Asia/Jerusalem';
  const dayFmt = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
  const timeFmt = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
  const dateTimeFmt = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  // Calendar-day formatters work on "civil" dates stored as UTC noon, so no time zone shift applies.
  const civilDay = new Intl.DateTimeFormat('he-IL', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'numeric' });
  const civilMonth = new Intl.DateTimeFormat('he-IL', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  const civilShort = new Intl.DateTimeFormat('he-IL', { timeZone: 'UTC', day: 'numeric', month: 'long' });
  const LEVEL = { high: 'עומס כבד', medium: 'עומס בינוני', low: 'עומס קל' };
  const WEEKDAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  const VIEWS = ['list', 'week', 'month'];

  let events = [];
  let loaded = false;
  let category = '';
  let view = 'list';
  let weekOffset = 0;
  let monthOffset = 0;
  let selectedDay = null;

  // Sends a Google Analytics event when analytics is configured; a no-op otherwise.
  function track(name, params) {
    if (typeof window.gtag === 'function') window.gtag('event', name, params || {});
  }

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

  function storage(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch (e) {
      // Storage can be unavailable (private mode); the view simply isn't remembered.
    }
    return null;
  }

  // Civil-date helpers: a day is "YYYY-MM-DD"; Date objects are UTC noon of that day.
  const civil = (key) => new Date(`${key}T12:00:00Z`);
  const keyOf = (d) => d.toISOString().slice(0, 10);
  const addDays = (key, n) => keyOf(new Date(civil(key).getTime() + n * 86400000));
  const todayKey = () => dateKey.format(new Date());

  function range(w) {
    return `${timeFmt.format(new Date(w.from))} עד ${timeFmt.format(new Date(w.to))}`;
  }

  function relDay(key) {
    if (key === todayKey()) return 'היום';
    if (key === addDays(todayKey(), 1)) return 'מחר';
    return null;
  }

  function filtered() {
    return events.filter((e) => !category || e.category === category);
  }

  function byDay(list) {
    const m = new Map();
    for (const ev of list) {
      const k = dateKey.format(new Date(ev.start));
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(ev);
    }
    return m;
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

  function card(ev, idPrefix = 'event-') {
    const start = new Date(ev.start);
    const t = ev.traffic;
    const badges = [
      el('span', { class: `badge cat-${ev.category}` }, ev.categoryLabel),
      el('span', { class: `badge lvl-${t.level}` }, LEVEL[t.level]),
      ev.cancelled && el('span', { class: 'badge warn' }, 'בוטל'),
      ev.postponed && el('span', { class: 'badge warn' }, 'נדחה'),
      !ev.confirmed && el('span', { class: 'badge warn' }, 'מועד לא סופי'),
    ];
    return el('article', { class: `card${ev.cancelled ? ' cancelled' : ''}`, id: `${idPrefix}${ev.id}` },
      el('div', { class: 'time' }, ev.timeTbd ? '?' : timeFmt.format(start)),
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
          el('a', { class: 'btn small add-to-cal', href: gcalEventLink(ev), target: '_blank', rel: 'noopener', 'data-title': ev.title }, '+ ליומן'),
          el('a', { class: 'btn small', href: `/api/events/${ev.id}`, target: '_blank' }, 'JSON'))));
  }

  function renderNext() {
    const box = document.getElementById('next');
    const now = Date.now();
    const ev = events.find((e) => !e.cancelled && new Date(e.end || e.estimatedEnd).getTime() > now);
    if (!ev) { box.hidden = true; return; }
    const start = new Date(ev.start);
    const live = start.getTime() <= now;
    const rd = relDay(dateKey.format(start));
    box.hidden = false;
    box.className = `next lvl-${ev.traffic.level}`;
    box.replaceChildren(
      el('div', { class: 'label' }, live ? 'מתקיים עכשיו' : 'האירוע הבא'),
      el('div', { class: 'title' }, ev.title),
      el('div', { class: 'when' }, `${rd ? `${rd}, ` : ''}${dayFmt.format(start)} · ${ev.timeTbd ? 'שעה טרם נקבעה' : timeFmt.format(start)}`),
      el('p', null, ev.traffic.advice),
      el('a', { href: `#event-${ev.id}`, class: 'btn small' }, 'לפרטים'));
  }

  function renderList() {
    const list = document.getElementById('view-list');
    const shown = filtered();
    if (!loaded) return;
    if (!shown.length) {
      list.replaceChildren(el('p', { class: 'muted' }, 'אין אירועים צפויים בקטגוריה הזו כרגע.'));
      return;
    }
    const out = [];
    for (const [k, evs] of byDay(shown)) {
      const rd = relDay(k);
      out.push(el('h2', { class: `day${rd ? ' soon' : ''}` }, `${rd ? `${rd} · ` : ''}${dayFmt.format(new Date(evs[0].start))}`), ...evs.map((e) => card(e)));
    }
    list.replaceChildren(...out);
  }

  function weekStart(offset) {
    const today = todayKey();
    return addDays(today, -civil(today).getUTCDay() + offset * 7);
  }

  function renderWeek() {
    const box = document.getElementById('view-week');
    const first = weekStart(weekOffset);
    const last = addDays(first, 6);
    box.querySelector('.cal-title').textContent = `${civilShort.format(civil(first))} – ${civilShort.format(civil(last))}`;
    const days = byDay(filtered());
    const out = [];
    for (let i = 0; i < 7; i++) {
      const k = addDays(first, i);
      const evs = days.get(k) || [];
      const rd = relDay(k);
      out.push(el('div', { class: `week-day${k === todayKey() ? ' today' : ''}${evs.length ? '' : ' empty'}` },
        el('h3', { class: 'week-day-title' }, `${rd ? `${rd} · ` : ''}${civilDay.format(civil(k))}`),
        evs.length ? evs.map((e) => card(e, 'week-')) : el('p', { class: 'muted small' }, 'אין אירועים')));
    }
    box.querySelector('.week-days').replaceChildren(...out);
  }

  function monthStart(offset) {
    const t = civil(todayKey());
    return keyOf(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + offset, 1, 12)));
  }

  function renderDayDetail(box, key, evs) {
    const detail = box.querySelector('.day-detail');
    if (!key) { detail.replaceChildren(); return; }
    detail.replaceChildren(
      el('h3', { class: 'day' }, dayFmt.format(civil(key))),
      ...(evs.length ? evs.map((e) => card(e, 'month-')) : [el('p', { class: 'muted' }, 'אין אירועים ביום הזה.')]));
  }

  function renderMonth() {
    const box = document.getElementById('view-month');
    const first = monthStart(monthOffset);
    const firstDate = civil(first);
    const month = firstDate.getUTCMonth();
    box.querySelector('.cal-title').textContent = civilMonth.format(firstDate);
    const days = byDay(filtered());
    const cells = WEEKDAYS.map((d) => el('div', { class: 'month-head', role: 'columnheader' }, d));
    let k = addDays(first, -firstDate.getUTCDay());
    // Default selection: today if it's in this month, otherwise the month's first event day.
    if (!selectedDay || civil(selectedDay).getUTCMonth() !== month) {
      const inMonth = [...days.keys()].filter((d) => d.slice(0, 7) === first.slice(0, 7)).sort();
      selectedDay = todayKey().slice(0, 7) === first.slice(0, 7) ? todayKey() : inMonth[0] || null;
    }
    for (let i = 0; i < 42; i++) {
      const d = civil(k);
      if (i >= 35 && d.getUTCMonth() !== month) break;
      const evs = days.get(k) || [];
      const level = ['high', 'medium', 'low'].find((l) => evs.some((e) => e.traffic.level === l)) || null;
      const key = k;
      const cell = el('button', {
        type: 'button',
        role: 'gridcell',
        class: ['month-cell', d.getUTCMonth() !== month && 'other', key === todayKey() && 'today', key === selectedDay && 'selected', level && `has lvl-${level}`].filter(Boolean).join(' '),
        'aria-label': `${dayFmt.format(d)}: ${evs.length ? `${evs.length} אירועים` : 'אין אירועים'}`,
      },
      el('span', { class: 'num' }, String(d.getUTCDate())),
      evs.length ? el('span', { class: 'items' }, evs.slice(0, 2).map((e) => el('span', { class: `item lvl-${e.traffic.level}` }, `${e.timeTbd ? '' : `${timeFmt.format(new Date(e.start))} `}${e.title}`))) : null,
      evs.length ? el('span', { class: 'dots' }, evs.slice(0, 3).map((e) => el('i', { class: `dot lvl-${e.traffic.level}` }))) : null);
      cell.addEventListener('click', () => {
        selectedDay = key;
        renderMonth();
      });
      cells.push(cell);
      k = addDays(k, 1);
    }
    box.querySelector('.month-grid').replaceChildren(...cells);
    renderDayDetail(box, selectedDay, (selectedDay && days.get(selectedDay)) || []);
  }

  function render() {
    renderNext();
    for (const v of VIEWS) document.getElementById(`view-${v}`).hidden = v !== view;
    if (view === 'list') renderList();
    if (view === 'week') renderWeek();
    if (view === 'month') renderMonth();
  }

  function setView(v) {
    view = VIEWS.includes(v) ? v : 'list';
    storage('view', view);
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.view === view;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    });
    render();
  }

  function setupTabs() {
    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
      setView(t.dataset.view);
      track('view_change', { view: t.dataset.view });
    }));
    document.querySelectorAll('#view-week [data-step]').forEach((b) => b.addEventListener('click', () => {
      weekOffset += Number(b.dataset.step);
      renderWeek();
    }));
    document.querySelectorAll('#view-month [data-step]').forEach((b) => b.addEventListener('click', () => {
      monthOffset += Number(b.dataset.step);
      selectedDay = null;
      renderMonth();
    }));
  }

  function renderSources(sources) {
    const ul = document.getElementById('sourceList');
    ul.replaceChildren(...sources.map((s) => el('li', null,
      el('span', { class: `dot ${s.ok === false ? 'bad' : s.ok ? 'ok' : ''}` }),
      el('a', { href: s.homepage, target: '_blank', rel: 'noopener' }, s.name),
      ` · ${s.eventCount} אירועים`,
      s.lastSuccess ? ` · עודכן ${dateTimeFmt.format(new Date(s.lastSuccess))}` : '',
      s.ok === false ? el('span', { class: 'muted small' }, ' (שגיאה בריצה האחרונה)') : '')));
  }

  function setupFilters() {
    for (const chip of document.querySelectorAll('.chip')) {
      chip.addEventListener('click', () => {
        category = chip.dataset.cat;
        track('filter_category', { category: category || 'all' });
        document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
        render();
      });
    }
  }

  function focusHash() {
    if (!location.hash.startsWith('#event-')) return;
    if (view !== 'list') setView('list');
    const target = document.getElementById(location.hash.slice(1));
    if (target) {
      document.querySelectorAll('.card.focus').forEach((c) => c.classList.remove('focus'));
      target.classList.add('focus');
      target.scrollIntoView({ block: 'center' });
    }
  }

  async function load() {
    try {
      const [er, sr] = await Promise.all([fetch('/api/events', { cache: 'no-store' }), fetch('/api/sources', { cache: 'no-store' })]);
      const data = await er.json();
      events = data.events || [];
      loaded = true;
      render();
      focusHash();
      renderSources((await sr.json()).sources || []);
      document.getElementById('updated').textContent = data.updatedAt ? `עודכן: ${dateTimeFmt.format(new Date(data.updatedAt))}` : '';
    } catch (err) {
      document.getElementById('view-list').replaceChildren(el('p', { class: 'muted' }, 'שגיאה בטעינת האירועים. נסו לרענן.'));
    }
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a.add-to-cal');
    if (a) track('add_event_to_calendar', { event_title: a.dataset.title });
  });

  setupTabs();
  setupFilters();
  setView(storage('view') || 'list');
  window.addEventListener('hashchange', focusHash);
  load();
  setInterval(load, 10 * 60000);
})();
