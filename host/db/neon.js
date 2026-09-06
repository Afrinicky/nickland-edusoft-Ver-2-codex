// Nickland Edusoft — Neon, wearing the shape the school already knows.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// SPIKE.
//
// The audit found that 22,400 lines of handlers touch the database through a
// remarkably small opening:
//
//   db.prepare(sql).get() / .all() / .run()      1,631 sites
//   db.transaction(fn)                              72 sites
//   db.exec, db.pragma, db.name                      3 sites
//
//   and nothing else — no .iterate, no .pluck, no .raw, no .bind.
//
// So this is not a database layer. It is five methods with the same names and
// the same synchronous behaviour as better-sqlite3, answered by Postgres. No
// handler changes. No second implementation of anything. The office PC keeps
// better-sqlite3 and keeps its local file; only the host, and only when
// DATABASE_URL is set, ever comes here.

const path = require('node:path');
const { Worker } = require('node:worker_threads');
const dialect = require('./dialect');

// 32MB. A class register is kilobytes; this is sized for the largest thing a
// school actually reads at once — the students sheet — with room to spare, and
// a clear error rather than a truncation if something ever exceeds it.
const DATA_BYTES = 32 * 1024 * 1024;

function openNeonDatabase(connectionString, options = {}) {
  const control = new SharedArrayBuffer(16);
  const data = new SharedArrayBuffer(DATA_BYTES);
  const ctrl = new Int32Array(control);
  const bytes = new Uint8Array(data);

  const worker = new Worker(path.join(__dirname, 'worker.js'), {
    workerData: {
      control, data, connectionString,
      schema: options.schema || null,
      poolSize: options.poolSize || 3,
      latencyMs: options.latencyMs || 0,
    },
  });
  worker.unref();          // the worker must not hold the process open
  worker.on('error', (e) => { lastWorkerError = e; });
  let lastWorkerError = null;

  // The whole trick, in six lines.
  //
  // The request goes to the worker, which has its own event loop and receives
  // it while this thread is stopped. Atomics.wait parks this thread until the
  // worker writes the answer into shared memory and notifies. Nothing here is
  // polling and nothing is spinning: the thread is genuinely asleep.
  function ask(message) {
    Atomics.store(ctrl, 0, 0);
    Atomics.store(ctrl, 1, 0);
    Atomics.store(ctrl, 2, 0);
    worker.postMessage(message);

    // A bounded wait, so a Neon project that has gone away cannot hang the
    // host for ever with nothing on screen to explain it.
    const outcome = Atomics.wait(ctrl, 0, 0, 60000);
    if (outcome === 'timed-out') {
      throw new Error(
        'The school\'s database did not answer within 60 seconds. ' +
        (lastWorkerError ? `(${lastWorkerError.message})` : 'Check the connection to Neon.')
      );
    }

    const length = Atomics.load(ctrl, 1);
    const payload = JSON.parse(Buffer.from(bytes.subarray(0, length)).toString('utf8'));
    if (Atomics.load(ctrl, 2) === 1 || payload.error) {
      // Thrown, not returned. A handler that asks for a row and is handed an
      // error object would carry on and write nonsense; the office PC throws
      // here too, so this behaves the same way.
      const err = new Error(payload.error);
      err.code = payload.code;
      err.sql = payload.sql;
      throw err;
    }
    return payload;
  }

  // Translation is per statement and cached, exactly as a prepared statement
  // would be — the handlers prepare the same SQL over and over.
  const translated = new Map();

  // Which tables have an `id` column, asked once and remembered. Without it
  // the adapter appends RETURNING id to every INSERT, and the tables keyed by
  // something else — settings by `key`, and others — fail the write outright.
  // One query at start-up; nothing per request.
  let idTables = null;
  function hasIdColumn(table) {
    if (idTables === null) {
      const rows = ask({
        kind: 'all',
        sql: `SELECT table_name FROM information_schema.columns
               WHERE column_name = 'id' AND table_schema = COALESCE($1, current_schema())`,
        params: [options.schema || null],
      }).rows;
      idTables = new Set(rows.map(r => String(r.table_name).toLowerCase()));
    }
    return idTables.has(table);
  }

  function toPostgres(sql) {
    let out = translated.get(sql);
    if (out === undefined) {
      out = dialect.translate(sql, hasIdColumn);
      translated.set(sql, out);
    }
    return out;
  }

  // better-sqlite3 takes parameters as (a, b, c) OR as one object for named
  // parameters. Every site in this application uses the positional form.
  function positional(args) {
    if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])
        && !(args[0] instanceof Date)) {
      throw new Error('Named parameters are not supported by the Neon adapter; this application does not use them.');
    }
    return args.map(v => (v === undefined ? null : v));
  }

  const db = {
    prepare(sql) {
      const pg = toPostgres(sql);
      return {
        get: (...args) => ask({ kind: 'get', sql: pg, params: positional(args) }).row,
        all: (...args) => ask({ kind: 'all', sql: pg, params: positional(args) }).rows,
        run: (...args) => {
          const r = ask({ kind: 'run', sql: pg, params: positional(args) });
          return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
        },
      };
    },

    // better-sqlite3's transaction() returns a FUNCTION that runs fn inside a
    // transaction. 72 places rely on that shape, and on the rollback: a
    // payment that half-happened is the thing this application most needs
    // never to do.
    transaction(fn) {
      return (...args) => {
        ask({ kind: 'begin' });
        try {
          const result = fn(...args);
          ask({ kind: 'commit' });
          return result;
        } catch (e) {
          try { ask({ kind: 'rollback' }); } catch (_) { /* already gone */ }
          throw e;
        }
      };
    },

    exec(sql) { ask({ kind: 'all', sql: toPostgres(sql), params: [] }); },

    // Answered rather than executed. PRAGMA is SQLite's; Postgres has its own
    // settings and the handlers only ever set journal/synchronous, which mean
    // nothing here.
    pragma() { return []; },

    name: 'neon',
    close() { try { worker.postMessage({ kind: 'shutdown' }); } catch (_) {} },

    // Spike instrumentation: how many statements actually reached Neon.
    _queryCount() { return ask({ kind: 'count' }).queries; },
    _resetQueryCount() { ask({ kind: 'reset-count' }); },
  };

  return db;
}

module.exports = { openNeonDatabase };
