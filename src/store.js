'use strict';

// Persists the events each source returned plus the status of each source's last run.
// Uses Postgres when DATABASE_URL is set (xhostd injects one), otherwise keeps everything in memory.

function serialize(ev) {
  return {
    ...ev,
    start: new Date(ev.start).toISOString(),
    end: ev.end ? new Date(ev.end).toISOString() : null,
  };
}

class MemoryStore {
  constructor() {
    this.events = new Map(); // key `${source}\u0000${id}` -> row
    this.runs = new Map();
  }

  async init() {}

  async saveRun(sourceId, run, events) {
    const now = new Date().toISOString();
    const prev = this.runs.get(sourceId) || {};
    this.runs.set(sourceId, {
      source: sourceId,
      lastAttempt: now,
      lastSuccess: run.ok ? now : prev.lastSuccess || null,
      ok: run.ok,
      error: run.error || null,
      count: run.ok ? events.length : prev.count || 0,
    });
    if (!run.ok) return;
    const seen = new Set();
    for (const ev of events) {
      const key = `${sourceId}\u0000${ev.sourceEventId}`;
      seen.add(key);
      const old = this.events.get(key);
      this.events.set(key, { source: sourceId, data: serialize(ev), firstSeen: old ? old.firstSeen : now, lastSeen: now });
    }
    // Upcoming events that disappeared from the source were removed there; past ones are kept as history.
    for (const [key, row] of this.events) {
      if (row.source === sourceId && !seen.has(key) && new Date(row.data.start) > new Date()) this.events.delete(key);
    }
  }

  async loadEvents() {
    return [...this.events.values()];
  }

  async loadRuns() {
    return [...this.runs.values()];
  }
}

class PgStore {
  constructor(url) {
    const { Pool } = require('pg');
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || /sslmode=disable/.test(url);
    this.pool = new Pool({ connectionString: url, max: 3, ssl: local ? false : undefined });
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS source_events (
        source TEXT NOT NULL,
        source_event_id TEXT NOT NULL,
        data JSONB NOT NULL,
        start_at TIMESTAMPTZ NOT NULL,
        first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (source, source_event_id)
      );
      CREATE TABLE IF NOT EXISTS source_runs (
        source TEXT PRIMARY KEY,
        last_attempt TIMESTAMPTZ,
        last_success TIMESTAMPTZ,
        ok BOOLEAN,
        error TEXT,
        count INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  async saveRun(sourceId, run, events) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO source_runs (source, last_attempt, last_success, ok, error, count)
         VALUES ($1, now(), CASE WHEN $2 THEN now() END, $2, $3, $4)
         ON CONFLICT (source) DO UPDATE SET
           last_attempt = now(),
           last_success = CASE WHEN $2 THEN now() ELSE source_runs.last_success END,
           ok = $2, error = $3,
           count = CASE WHEN $2 THEN $4 ELSE source_runs.count END`,
        [sourceId, run.ok, run.error || null, events.length],
      );
      if (run.ok) {
        const ids = [];
        for (const ev of events) {
          const row = serialize(ev);
          ids.push(String(ev.sourceEventId));
          await client.query(
            `INSERT INTO source_events (source, source_event_id, data, start_at)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (source, source_event_id) DO UPDATE SET data = $3, start_at = $4, last_seen = now()`,
            [sourceId, String(ev.sourceEventId), row, row.start],
          );
        }
        await client.query(
          `DELETE FROM source_events WHERE source = $1 AND start_at > now() AND NOT (source_event_id = ANY($2::text[]))`,
          [sourceId, ids],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async loadEvents() {
    const { rows } = await this.pool.query(
      `SELECT source, data, first_seen, last_seen FROM source_events WHERE start_at > now() - interval '120 days'`,
    );
    return rows.map((r) => ({ source: r.source, data: r.data, firstSeen: r.first_seen.toISOString(), lastSeen: r.last_seen.toISOString() }));
  }

  async loadRuns() {
    const { rows } = await this.pool.query('SELECT * FROM source_runs');
    return rows.map((r) => ({
      source: r.source,
      lastAttempt: r.last_attempt && r.last_attempt.toISOString(),
      lastSuccess: r.last_success && r.last_success.toISOString(),
      ok: r.ok,
      error: r.error,
      count: r.count,
    }));
  }
}

function createStore(databaseUrl) {
  return databaseUrl ? new PgStore(databaseUrl) : new MemoryStore();
}

module.exports = { createStore, MemoryStore };
