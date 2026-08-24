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


// After a restore — or after an app update that moved the data folder — the
// absolute upload paths baked into the database (the school logo, the two
// signatures, every student/staff/user photo) point at where those files USED
// to live. The files themselves are restored into the CURRENT uploads folder,
// but the stored path still names the old one, so `file://<oldpath>` resolves
// to nothing and the image shows broken. The classic symptom: "after an update,
// the logo disappears when I restore a backup."
//
// This re-points every stored upload path at the current uploads folder,
// keyed by the part of the path AFTER the `uploads/` segment (so
// `…/uploads/signatures/x.png` heals to `<here>/uploads/signatures/x.png`).
// It only rewrites when the file actually exists at the new location, so it can
// never replace a working path with a dead one. Pure and db-agnostic: it works
// on any handle with `.prepare`, so it is exercised directly in the tests.
function subPathAfterUploads(stored) {
  const norm = String(stored || '').replace(/\\/g, '/');
  const m = norm.match(/(?:^|\/)uploads\/(.+)$/i);
  return m ? m[1] : null;   // e.g. 'school_logo.png' or 'signatures/x.png'
}

function repairUploadPaths(db, userDataPath, fsMod) {
  const fs = fsMod || require('fs');
  const uploadsRoot = path.join(userDataPath, 'uploads');
  let repaired = 0;
  const details = [];

  const heal = (stored) => {
    const sub = subPathAfterUploads(stored);
    if (!sub) return null;
    // Rebuild with OS-correct separators from the archived sub-path.
    const next = path.join(uploadsRoot, ...sub.split('/'));
    if (next === stored) return null;                 // already correct
    try { if (!fs.existsSync(next)) return null; }     // never point at a missing file
    catch (_) { return null; }
    return next;
  };

  // ── settings: *_path keys that point into uploads ──
  try {
    const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE '%\_path' ESCAPE '\\'").all();
    const upd = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
    for (const r of rows) {
      const next = heal(r.value);
      if (next) { upd.run(next, r.key); repaired++; details.push({ where: `settings.${r.key}`, to: next }); }
    }
  } catch (_) { /* older schema — skip */ }

  // ── photo_path columns on the people tables ──
  for (const table of ['students', 'staff', 'users']) {
    try {
      const rows = db.prepare(`SELECT id, photo_path FROM ${table} WHERE photo_path IS NOT NULL AND photo_path <> ''`).all();
      const upd = db.prepare(`UPDATE ${table} SET photo_path = ? WHERE id = ?`);
      for (const r of rows) {
        const next = heal(r.photo_path);
        if (next) { upd.run(next, r.id); repaired++; details.push({ where: `${table}#${r.id}.photo_path`, to: next }); }
      }
    } catch (_) { /* table/column absent — skip */ }
  }

  return { repaired, details };
}

module.exports = { safeExtractPath, verifyDatabaseFile, repairUploadPaths, subPathAfterUploads };
