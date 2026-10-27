'use strict';

const { enrich } = require('./enrich');
const { israelDay, shortHash } = require('./util');

// Two listings on the same day that start within this window describe the same event:
// the arena hosts one event at a time.
const SAME_EVENT_WINDOW_MS = 150 * 60000;
// Sources publish provisional dates for future rounds that can differ by a day or two,
// so games between the same teams this close together are one game.
const SAME_GAME_WINDOW_MS = 3 * 86400000;
const AGREE_MS = 30 * 60000;

const TEAM_STOPWORDS = new Set(['מכבי', 'הפועל', 'תל', 'אביב', 'תא', 'rapyd', 'ראפיד', 'נגד', 'עירוני', 'בני', 'ibi', 'קבוצת', 'vs', 'בכדורסל']);

// Distinctive words of a game title, used to recognise the same game across sources.
function teamTokens(title) {
  return new Set(String(title || '').toLowerCase()
    .replace(/["'”“׳״`.,—–\-/()]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !TEAM_STOPWORDS.has(w)));
}

function sameGame(group, row) {
  if (!group.sports || !isSports(row)) return false;
  if (Math.abs(group.start - new Date(row.data.start)) > SAME_GAME_WINDOW_MS) return false;
  for (const t of teamTokens(row.data.title)) if (group.tokens.has(t)) return true;
  return false;
}

function isSports(row) {
  return row.data.category === 'sports';
}

// rows: [{ source, data, firstSeen, lastSeen }], sources: ordered list of source definitions (priority order).
function mergeEvents(rows, sources) {
  const priority = new Map(sources.map((s, i) => [s.id, i]));
  const meta = new Map(sources.map((s) => [s.id, s]));
  const sorted = [...rows].sort((a, b) =>
    new Date(a.data.start) - new Date(b.data.start)
    || (priority.get(a.source) ?? 99) - (priority.get(b.source) ?? 99));

  const groups = [];
  for (const row of sorted) {
    const start = new Date(row.data.start);
    const day = israelDay(start);
    const g = groups.find((x) => (x.day === day && Math.abs(x.start - start) <= SAME_EVENT_WINDOW_MS) || sameGame(x, row));
    if (g) {
      g.rows.push(row);
      if (isSports(row)) {
        g.sports = true;
        for (const t of teamTokens(row.data.title)) g.tokens.add(t);
      }
    } else {
      groups.push({ day, start, rows: [row], sports: isSports(row), tokens: isSports(row) ? teamTokens(row.data.title) : new Set() });
    }
  }

  return groups.map(({ rows: rs }) => {
    const ranked = [...rs].sort((a, b) => (priority.get(a.source) ?? 99) - (priority.get(b.source) ?? 99));
    const primary = ranked[0];
    const d = primary.data;
    const pick = (field) => (ranked.find((r) => r.data[field]) || {}).data?.[field] ?? null;
    // Take the time from the best source that publishes a real hour, not a placeholder.
    const timed = ranked.find((r) => !r.data.timeTbd) || primary;
    const startMs = new Date(timed.data.start).getTime();
    const agree = ranked.every((r) => (r.data.timeTbd
      ? israelDay(new Date(r.data.start)) === israelDay(new Date(startMs))
      : Math.abs(new Date(r.data.start).getTime() - startMs) <= AGREE_MS));
    const merged = {
      id: shortHash(`${primary.source}|${d.sourceEventId}`),
      title: d.title,
      start: timed.data.start,
      timeTbd: !!timed.data.timeTbd,
      end: pick('end'),
      category: pick('category'),
      description: pick('description') || '',
      image: pick('image'),
      cancelled: ranked.every((r) => r.data.cancelled),
      postponed: ranked.some((r) => r.data.postponed),
      confirmed: timed.data.confirmed !== false && !timed.data.timeTbd && agree,
      attendance: pick('attendance'),
      extra: d.extra || {},
      firstSeen: rs.map((r) => r.firstSeen).sort()[0],
      lastSeen: rs.map((r) => r.lastSeen).sort().at(-1),
      sources: ranked.map((r) => ({
        id: r.source,
        name: meta.get(r.source)?.name || r.source,
        title: r.data.title,
        start: r.data.start,
        url: r.data.url || meta.get(r.source)?.homepage || null,
      })),
    };
    return enrich(merged);
  });
}

class Aggregator {
  constructor(store, sources, { log = console } = {}) {
    this.store = store;
    this.sources = sources;
    this.log = log;
    this.events = [];
    this.runs = [];
    this.updatedAt = null;
    this.running = null;
  }

  async load() {
    const [rows, runs] = await Promise.all([this.store.loadEvents(), this.store.loadRuns()]);
    this.events = mergeEvents(rows, this.sources);
    this.runs = runs;
    this.updatedAt = new Date().toISOString();
  }

  // Runs every source; a failing source keeps its last good data.
  refresh() {
    if (this.running) return this.running;
    this.running = (async () => {
      for (const src of this.sources) {
        let events = [];
        let run;
        try {
          events = await src.fetch();
          run = { ok: true };
          this.log.info(`[scrape] ${src.id}: ${events.length} events`);
        } catch (err) {
          run = { ok: false, error: String(err && err.message || err).slice(0, 300) };
          this.log.warn(`[scrape] ${src.id} failed: ${run.error}`);
        }
        try {
          await this.store.saveRun(src.id, run, events);
        } catch (err) {
          this.log.error(`[store] ${src.id}: ${err.message}`);
        }
      }
      await this.load();
    })().finally(() => { this.running = null; });
    return this.running;
  }

  sourceStatus() {
    return this.sources.map((s) => {
      const r = this.runs.find((x) => x.source === s.id) || {};
      return {
        id: s.id, name: s.name, homepage: s.homepage, kind: s.kind,
        ok: r.ok ?? null, lastAttempt: r.lastAttempt || null, lastSuccess: r.lastSuccess || null,
        error: r.error || null, eventCount: r.count || 0,
      };
    });
  }
}

module.exports = { Aggregator, mergeEvents };
