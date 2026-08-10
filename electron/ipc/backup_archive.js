// Nickland Edusoft — Backup archive safety helpers
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Pure functions used by the restore path, kept separate from the IPC module so
// they carry no Electron or auth dependencies and can be tested directly.

const path = require('path');

// Resolve an archive entry to an absolute path inside `root`, or null if the
// entry would escape it. Archive entry names are attacker-controlled data — a
// name like `uploads/../../../Startup/x.exe` passes a naive prefix check and
// writes outside the app's data folder ("zip slip"). Restores accept a file the
// user picked off disk, so the archive is not necessarily one we produced.
function safeExtractPath(root, entryName) {
  const normalized = String(entryName).replace(/\\/g, '/');
  if (normalized.includes('\0')) return null;
  const dest = path.resolve(root, normalized);
  const base = path.resolve(root);
  if (dest !== base && !dest.startsWith(base + path.sep)) return null;
  return dest;
}

// Confirm an extracted file really is a readable Nickland Edusoft database
// before it replaces live data. Restoring a truncated or corrupt archive used
// to leave the school with an unopenable database and no way back.
//
// Returns { ok: true } | { ok: true, skipped } | { ok: false, error }.
function verifyDatabaseFile(filePath) {
  let Database;
  try { Database = require('better-sqlite3'); }
  catch (e) { return { ok: true, skipped: 'sqlite driver unavailable' }; }
  let probe;
  try {
    probe = new Database(filePath, { readonly: true, fileMustExist: true });
    const integrity = probe.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') return { ok: false, error: `database failed its integrity check (${integrity})` };
    const core = probe.prepare(
      "SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name IN ('users','students','settings')"
    ).get().c;
    if (core < 3) return { ok: false, error: 'file is a database but not a Nickland Edusoft one' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  } finally {
    try { if (probe) probe.close(); } catch (_) {}
  }
}

module.exports = { safeExtractPath, verifyDatabaseFile };
