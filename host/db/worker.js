// Nickland Edusoft — the thread that actually talks to Neon.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// SPIKE.
//
// Postgres drivers are asynchronous and the school's handlers are not: they
// call db.prepare(...).get() and expect an answer on the next line, 1,631
// times. Rewriting those call sites would mean editing the installer, which is
// exactly what this whole approach exists to avoid.
//
// So the asynchrony is put in a thread of its own. This worker owns the pool
// and does the awaiting; the main thread hands it a query and blocks on an
// Atomics.wait until the answer is in shared memory. From a handler's point of
// view the call was synchronous, and nothing about it changed.
//
// The cost is honest and is what the spike measures: while the main thread is
// blocked it is not serving anybody else.

const { parentPort, workerData } = require('node:worker_threads');
const { Pool, types } = require('pg');

// ── The one type that does not come back the way SQLite sends it ────────────
//
// The schema generator maps SQLite INTEGER to Postgres BIGINT, and there are
// 332 of them: every id, every COUNT(*), every 0/1 flag. node-postgres returns
// BIGINT as a STRING, because a 64-bit integer does not always fit in a
// JavaScript number.
//
// Left alone that is quietly catastrophic here. The handlers compare ids with
// ===, use them as object keys and do arithmetic on counts; `row.id === 5`
// would simply be false, everywhere, with nothing thrown and nothing logged.
// The spike found it on its first query — `{"id":"2"}` where the office PC
// answers `{"id":2}`.
//
// A school's ids and counts do not approach 2^53, so they are read as numbers,
// which is what every one of those 1,631 call sites already expects.
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));   // int8 / BIGINT
types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // numeric, if ever used

const { control, data, connectionString, schema, poolSize, latencyMs } = workerData;

const ctrl = new Int32Array(control);          // [ready, byteLength, isError]
const bytes = new Uint8Array(data);

// Small on purpose. The main thread blocks on every query, so it can only ever
// have one in flight; a large pool would be idle connections Neon still counts.
// A couple spare covers transactions, which hold a client for their duration.
const pool = new Pool({
  connectionString,
  max: poolSize || 3,
  idleTimeoutMillis: 30000,
  // Neon suspends an idle project. A short connect timeout turns "waking up"
  // into a clear error rather than a request that hangs for a minute.
  connectionTimeoutMillis: 15000,
  ...(schema ? { options: `-c search_path=${schema}` } : {}),
});

// Only for the spike: models the round-trip to a Neon region so the blocking
// cost can be measured against a local Postgres. Never set in production.
const delay = latencyMs > 0 ? () => new Promise(r => setTimeout(r, latencyMs)) : null;

// A transaction must run every statement on ONE connection, so while one is
// open the pool is bypassed and this client is used instead.
let txnClient = null;
let queryCount = 0;

function reply(payload) {
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  if (json.length > bytes.length) {
    const tooBig = Buffer.from(JSON.stringify({
      error: `That query answered with ${(json.length / 1048576).toFixed(1)}MB, which is more than this host will pass between threads. Narrow it or page it.`,
    }), 'utf8');
    bytes.set(tooBig);
    Atomics.store(ctrl, 1, tooBig.length);
    Atomics.store(ctrl, 2, 1);
  } else {
    bytes.set(json);
    Atomics.store(ctrl, 1, json.length);
    Atomics.store(ctrl, 2, payload && payload.error ? 1 : 0);
  }
  Atomics.store(ctrl, 0, 1);
  Atomics.notify(ctrl, 0);
}

async function run(msg) {
  const { sql, params, kind } = msg;
  try {
    if (delay) await delay();

    if (kind === 'begin') {
      txnClient = await pool.connect();
      await txnClient.query('BEGIN');
      queryCount++;
      return reply({ ok: true });
    }
    if (kind === 'commit' || kind === 'rollback') {
      if (txnClient) {
        try { await txnClient.query(kind.toUpperCase()); queryCount++; }
        finally { txnClient.release(); txnClient = null; }
      }
      return reply({ ok: true });
    }
    if (kind === 'count') return reply({ ok: true, queries: queryCount });
    if (kind === 'reset-count') { queryCount = 0; return reply({ ok: true }); }

    const runner = txnClient || pool;
    queryCount++;
    const res = await runner.query(sql, params);

    if (kind === 'get') return reply({ ok: true, row: res.rows[0] || undefined });
    if (kind === 'all') return reply({ ok: true, rows: res.rows });
    // run(): the two things better-sqlite3 answers with, and 114 places read
    // the first of them.
    return reply({
      ok: true,
      changes: res.rowCount || 0,
      lastInsertRowid: res.rows && res.rows[0] ? res.rows[0].id : undefined,
    });
  } catch (e) {
    // A failed statement inside a transaction poisons the whole transaction in
    // Postgres, so the client is let go rather than reused in that state.
    if (txnClient) {
      try { await txnClient.query('ROLLBACK'); } catch (_) {}
      try { txnClient.release(); } catch (_) {}
      txnClient = null;
    }
    reply({ error: (e && e.message) || String(e), code: e && e.code, sql });
  }
}

parentPort.on('message', (msg) => {
  if (msg && msg.kind === 'shutdown') {
    pool.end().finally(() => process.exit(0));
    return;
  }
  run(msg);
});
