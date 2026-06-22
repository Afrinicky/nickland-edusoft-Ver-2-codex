// Nickland Edusoft — Backup, Restore & Factory Reset IPC
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Provides secure, additive handlers for:
//   • Creating a ZIP backup of the SQLite database + all uploaded user files
//   • Restoring from a previous backup (with an automatic safety backup first)
//   • Factory reset back to first-time setup (with an automatic safety backup first)
//
// All destructive actions are restricted to full-access roles (Proprietor /
// Administrator) through the existing backend permission layer, and run only
// in the main (Node) process — never in the renderer.

const fs = require('fs');
const path = require('path');
const os = require('os');
const security = require('./_security');

const DB_FILE = 'nickland-edusoft.db';
const BACKUP_DIR_NAME = 'Nickland Edusoft Backups';
const UPLOADS_DIR_NAME = 'uploads';

// ── Helpers ───────────────────────────────────────────────
function backupDir(userDataPath) {
  return path.join(userDataPath, BACKUP_DIR_NAME);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// 2026-06-22-1430
function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function recordAudit(db, action, justification, severity = 'high') {
  try {
    db.prepare(`
      INSERT INTO audit_log (entity_type, entity_id, action, user_id, justification, severity)
      VALUES ('backup', NULL, ?, ?, ?, ?)
    `).run(action, security.getCurrentUserId(), justification, severity);
  } catch (e) { /* audit is best-effort */ }
}

// Recursively add a folder's contents to a PizZip instance.
function addFolderToZip(zip, absDir, zipPrefix) {
  if (!fs.existsSync(absDir)) return;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, entry.name);
    const rel = zipPrefix ? `${zipPrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      addFolderToZip(zip, abs, rel);
    } else if (entry.isFile()) {
      zip.file(rel, fs.readFileSync(abs));
    }
  }
}

// Produce a consistent snapshot copy of the live database.
// Prefers better-sqlite3's online backup API; falls back to a WAL
// checkpoint + plain file copy if that API is unavailable.
async function snapshotDatabase(db, userDataPath, destPath) {
  const livePath = path.join(userDataPath, DB_FILE);
  try {
    if (typeof db.backup === 'function') {
      await db.backup(destPath);
      return;
    }
  } catch (e) {
    // fall through to manual copy
  }
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) { /* ignore */ }
  fs.copyFileSync(livePath, destPath);
}

// Core backup routine — used by the explicit "Create Backup" button and by the
// automatic safety backups taken before restore / factory reset.
async function createBackup(db, userDataPath, { label } = {}) {
  let PizZip;
  try {
    PizZip = require('pizzip');
  } catch (e) {
    return { ok: false, error: 'ZIP library (pizzip) is not available.' };
  }

  const dir = backupDir(userDataPath);
  ensureDir(dir);

  const stamp = timestamp();
  const prefix = label ? `${label}-` : '';
  const fileName = `nickland-edusoft-backup-${prefix}${stamp}.zip`;
  const zipPath = path.join(dir, fileName);

  // 1. Snapshot the database into a temp file.
  const snapPath = path.join(os.tmpdir(), `nickland-edusoft-snapshot-${Date.now()}.db`);
  try {
    await snapshotDatabase(db, userDataPath, snapPath);

    // 2. Build the ZIP: database + uploaded files + manifest.
    const zip = new PizZip();
    zip.file(DB_FILE, fs.readFileSync(snapPath));
    addFolderToZip(zip, path.join(userDataPath, UPLOADS_DIR_NAME), UPLOADS_DIR_NAME);
    zip.file('manifest.json', JSON.stringify({
      app: 'Nickland Edusoft',
      kind: label || 'manual',
      db_file: DB_FILE,
      created_at: new Date().toISOString(),
    }, null, 2));

    const buffer = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.writeFileSync(zipPath, buffer);
  } finally {
    try { if (fs.existsSync(snapPath)) fs.unlinkSync(snapPath); } catch (e) { /* ignore */ }
  }

  const stat = fs.statSync(zipPath);
  return { ok: true, path: zipPath, fileName, folder: dir, size: stat.size, format: 'zip' };
}

module.exports = function registerBackupHandlers(ipcMain, db, app, userDataPath) {
  // Only full-access roles (Proprietor / Administrator) may use these tools.
  // checkPermission grants settings:edit/delete only to those designations.
  const denied = (action) => ({
    ok: false,
    error: `Access denied. Only an Administrator or Proprietor can ${action}.`,
  });

  // ── Where backups are stored ──────────────────────────
  ipcMain.handle('backup:get-info', () => {
    const dir = backupDir(userDataPath);
    return {
      ok: true,
      folder: dir,
      dbPath: path.join(userDataPath, DB_FILE),
      uploadsPath: path.join(userDataPath, UPLOADS_DIR_NAME),
      format: 'zip',
    };
  });

  // ── List previous backups ─────────────────────────────
  ipcMain.handle('backup:list', () => {
    const dir = backupDir(userDataPath);
    if (!fs.existsSync(dir)) return { ok: true, folder: dir, backups: [] };
    const backups = fs.readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.zip'))
      .map((f) => {
        const full = path.join(dir, f);
        const st = fs.statSync(full);
        return { fileName: f, path: full, size: st.size, modified: st.mtime.toISOString() };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified));
    return { ok: true, folder: dir, backups };
  });

  // ── Open the backups folder in the OS file manager ────
  ipcMain.handle('backup:open-folder', () => {
    const dir = backupDir(userDataPath);
    ensureDir(dir);
    return require('electron').shell.openPath(dir);
  });

  // ── Create a backup ───────────────────────────────────
  ipcMain.handle('backup:create', async () => {
    if (!security.checkPermission(db, 'settings', 'edit')) return denied('create backups');
    try {
      const res = await createBackup(db, userDataPath, {});
      if (res.ok) recordAudit(db, 'backup_created', `Backup created: ${res.fileName}`, 'normal');
      return res;
    } catch (e) {
      return { ok: false, error: 'Backup failed: ' + (e.message || String(e)) };
    }
  });

  // ── Restore from a previous backup ────────────────────
  ipcMain.handle('backup:restore', async (_e, backupPath) => {
    if (!security.checkPermission(db, 'settings', 'edit')) return denied('restore backups');

    let PizZip;
    try { PizZip = require('pizzip'); }
    catch (e) { return { ok: false, error: 'ZIP library (pizzip) is not available.' }; }

    if (!backupPath || !fs.existsSync(backupPath)) {
      return { ok: false, error: 'Selected backup file was not found.' };
    }

    // 1. Validate the archive and locate the database entry.
    let zip;
    try {
      zip = new PizZip(fs.readFileSync(backupPath));
    } catch (e) {
      return { ok: false, error: 'The selected file is not a valid Nickland Edusoft backup.' };
    }
    const dbEntry = zip.file(DB_FILE);
    if (!dbEntry) {
      return { ok: false, error: 'This backup does not contain a database and cannot be restored.' };
    }

    try {
      // 2. Safety backup of the CURRENT data before we overwrite anything.
      const safety = await createBackup(db, userDataPath, { label: 'safety-before-restore' });
      if (!safety.ok) return { ok: false, error: 'Could not create a safety backup, restore aborted.' };

      // 3. Read everything we need from the archive into memory.
      const dbBuffer = dbEntry.asNodeBuffer();
      const uploadEntries = Object.keys(zip.files)
        .filter((name) => name.startsWith(UPLOADS_DIR_NAME + '/') && !zip.files[name].dir)
        .map((name) => ({ name, buffer: zip.files[name].asNodeBuffer() }));

      // 4. Close the live database so the file can be replaced safely (Windows-safe).
      try { db.close(); } catch (e) { /* already closed */ }

      // 5. Replace the database file (and clear stale WAL/SHM side files).
      const dbPath = path.join(userDataPath, DB_FILE);
      fs.writeFileSync(dbPath, dbBuffer);
      for (const side of ['-wal', '-shm']) {
        const sp = dbPath + side;
        if (fs.existsSync(sp)) { try { fs.unlinkSync(sp); } catch (e) {} }
      }

      // 6. Replace the uploads folder with the backed-up files.
      const uploadsPath = path.join(userDataPath, UPLOADS_DIR_NAME);
      try { fs.rmSync(uploadsPath, { recursive: true, force: true }); } catch (e) {}
      ensureDir(uploadsPath);
      for (const entry of uploadEntries) {
        const dest = path.join(userDataPath, entry.name);
        ensureDir(path.dirname(dest));
        fs.writeFileSync(dest, entry.buffer);
      }

      // 7. Relaunch so the app reopens against the restored data.
      scheduleRelaunch(app);
      return { ok: true, restartRequired: true, safetyBackup: safety.fileName };
    } catch (e) {
      return { ok: false, error: 'Restore failed: ' + (e.message || String(e)) };
    }
  });

  // ── Factory reset ─────────────────────────────────────
  ipcMain.handle('backup:factory-reset', async (_e, payload) => {
    if (!security.checkPermission(db, 'settings', 'delete')) return denied('perform a factory reset');

    // Strong confirmation: caller must echo the literal word RESET.
    const confirmText = payload && payload.confirmText;
    if (confirmText !== 'RESET') {
      return { ok: false, error: 'Factory reset not confirmed. You must type RESET to proceed.' };
    }

    try {
      // 1. Safety backup BEFORE destroying anything.
      const safety = await createBackup(db, userDataPath, { label: 'safety-before-reset' });
      if (!safety.ok) return { ok: false, error: 'Could not create a safety backup, reset aborted.' };

      recordAudit(db, 'factory_reset', `Factory reset; safety backup: ${safety.fileName}`, 'high');

      // 2. Close the database so its files can be removed.
      try { db.close(); } catch (e) { /* already closed */ }

      // 3. Delete the database (and WAL/SHM side files).
      const dbPath = path.join(userDataPath, DB_FILE);
      for (const f of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
        if (fs.existsSync(f)) { try { fs.unlinkSync(f); } catch (e) {} }
      }

      // 4. Clear uploaded user files. The backups folder lives in a separate
      //    directory and is intentionally left untouched.
      const uploadsPath = path.join(userDataPath, UPLOADS_DIR_NAME);
      try { fs.rmSync(uploadsPath, { recursive: true, force: true }); } catch (e) {}
      ensureDir(uploadsPath);

      // 5. Relaunch — next launch recreates a fresh DB and shows first-time setup.
      scheduleRelaunch(app);
      return { ok: true, restartRequired: true, safetyBackup: safety.fileName };
    } catch (e) {
      return { ok: false, error: 'Factory reset failed: ' + (e.message || String(e)) };
    }
  });
};

// Relaunch the app shortly after responding, giving the renderer time to show
// its confirmation message before the window restarts.
function scheduleRelaunch(app) {
  setTimeout(() => {
    try { app.relaunch(); } catch (e) {}
    app.exit(0);
  }, 700);
}

module.exports.createBackup = createBackup;
