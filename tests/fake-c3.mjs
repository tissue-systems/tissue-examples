// A c3 binding backed by node:sqlite, close enough to exercise the example
// Cells: prepare/bind/first/all/run, exec and batch.

import { DatabaseSync } from 'node:sqlite';

export function fakeC3() {
  const db = new DatabaseSync(':memory:');
  const norm = (v) => (typeof v === 'boolean' ? Number(v) : Array.isArray(v) ? JSON.stringify(v) : v);
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a.map(norm)),
    async first(col) {
      const row = db.prepare(sql).get(...args);
      return row == null ? null : col ? row[col] : { ...row };
    },
    async all() {
      return { results: db.prepare(sql).all(...args).map((r) => ({ ...r })), success: true };
    },
    async run() {
      const p = db.prepare(sql);
      if (/\breturning\b/i.test(sql)) return { results: p.all(...args), meta: {} };
      const r = p.run(...args);
      return { success: true, meta: { rows_affected: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
  });
  return {
    raw: db,
    prepare: (sql) => stmt(sql),
    async exec(sql) { db.exec(sql); return { count: 1 }; },
    async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; },
  };
}

// Swaps globalThis.fetch for the length of one test and records every call.
export function stubFetch(t, respond = () => new Response('{}')) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return respond(String(url), init); };
  t.after(() => { globalThis.fetch = real; });
  return calls;
}

export const VAULT_UNSET = '***REMOVED***';
