// Nickland Edusoft — Application log
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// A packaged desktop app has no console. When a school reports "it won't open"
// or "the parent app stopped updating", there was previously nothing to look
// at: startup failures, migration failures and background sync errors all went
// to a stdout nobody sees. This writes them to a rotating file under the user
// data folder, and mirrors them into the system_log table when a database is
// available so Settings can show them without asking anyone to find a file.
//
// Deliberately dependency-free and never throws — logging must not be able to
// break the thing it is reporting on.

const fs = require('fs');
const path = require('path');

const MAX_BYTES = 2 * 1024 * 1024;   // rotate at 2 MB
const KEEP = 3;                      // .log + .1 + .2
const LOG_DIR_NAME = 'logs';
const LOG_FILE_NAME = 'nickland-edusoft.log';

let logDir = null;
let logPath = null;
let db = null;

function init(userDataPath) {
  try {
    logDir = path.join(userDataPath, LOG_DIR_NAME);
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    logPath = path.join(logDir, LOG_FILE_NAME);
  } catch (_) { logDir = null; logPath = null; }
  return logPath;
}

// Attach a database so entries are also queryable from inside the app.
function attachDatabase(database) { db = database; }

function rotateIfNeeded() {
  try {
    if (!logPath || !fs.existsSync(logPath)) return;
    if (fs.statSync(logPath).size < MAX_BYTES) return;
    for (let i = KEEP - 1; i >= 1; i--) {
      const from = i === 1 ? logPath : `${logPath}.${i - 1}`;
      const to = `${logPath}.${i}`;
      if (fs.existsSync(from)) {
        try { if (fs.existsSync(to)) fs.unlinkSync(to); } catch (_) {}
        try { fs.renameSync(from, to); } catch (_) {}
      }
    }
  } catch (_) { /* rotation is best-effort */ }
}

function write(level, source, message, detail) {
  const stamp = new Date().toISOString();
  const line = `${stamp} ${String(level).toUpperCase().padEnd(5)} [${source || 'app'}] ${message}` +
    (detail ? `\n    ${String(detail).replace(/\n/g, '\n    ')}` : '');

  // Console first — visible in `npm run dev` and in a terminal-launched build.
  try {
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  } catch (_) {}

  try {
    if (logPath) {
      rotateIfNeeded();
      fs.appendFileSync(logPath, line + '\n');
    }
  } catch (_) {}

  try {
    if (db && level !== 'debug') {
      db.prepare('INSERT INTO system_log (level, source, message, detail) VALUES (?, ?, ?, ?)')
        .run(level, source || 'app', String(message).slice(0, 1000), detail ? String(detail).slice(0, 4000) : null);
    }
  } catch (_) { /* the DB may be closed (restore/reset) or not yet migrated */ }
}

const info = (source, message, detail) => write('info', source, message, detail);
const warn = (source, message, detail) => write('warn', source, message, detail);
const error = (source, message, detail) => write('error', source, message, detail);

// Trim the in-database mirror. The file is bounded by rotation; the table
// needs its own retention or it grows for the life of the installation.
function pruneDatabaseLog(days = 30, keepMax = 5000) {
  if (!db) return 0;
  try {
    let n = db.prepare("DELETE FROM system_log WHERE created_at < datetime('now', ?)").run(`-${Math.max(1, days)} days`).changes;
    n += db.prepare(
      'DELETE FROM system_log WHERE id NOT IN (SELECT id FROM system_log ORDER BY id DESC LIMIT ?)'
    ).run(Math.max(100, keepMax)).changes;
    return n;
  } catch (_) { return 0; }
}

function recent(limit = 200, level = null) {
  if (!db) return [];
  try {
    return level
      ? db.prepare('SELECT * FROM system_log WHERE level = ? ORDER BY id DESC LIMIT ?').all(level, limit)
      : db.prepare('SELECT * FROM system_log ORDER BY id DESC LIMIT ?').all(limit);
  } catch (_) { return []; }
}

function paths() { return { dir: logDir, file: logPath }; }

module.exports = { init, attachDatabase, info, warn, error, pruneDatabaseLog, recent, paths };
