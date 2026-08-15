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
const engine = require('./backup_engine');
const { setSetting } = require('../utils/idgen');
const { safeExtractPath, verifyDatabaseFile } = require('./backup_archive');

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

    // 2. Refresh the offline finance workbook so the copy in this backup is
    //    current. The whole point of the workbook is continuity: a backup that
    //    carried a stale one would hand the school a picture of the term as it
    //    stood weeks ago, exactly when they can least afford it.
    let workbookRel = null;
    try {
      const wbMod = require('./finance_workbook');
      await wbMod.refreshWorkbook(db, userDataPath);
      const wbPath = wbMod.latestPath(userDataPath);
      if (fs.existsSync(wbPath)) workbookRel = `${wbMod.WORKBOOK_DIR}/${wbMod.LATEST_NAME}`;
    } catch (e) {
      // A workbook that cannot be built must never cost the school its backup.
      try {
        db.prepare("INSERT INTO system_log (level, source, message, detail) VALUES ('warn', 'backup', ?, ?)")
          .run('Finance workbook could not be refreshed for this backup', String((e && e.message) || e).slice(0, 500));
      } catch (_) {}
    }

    // 3. Build the ZIP: database + uploaded files + finance workbook + manifest.
    const zip = new PizZip();
    zip.file(DB_FILE, fs.readFileSync(snapPath));
    addFolderToZip(zip, path.join(userDataPath, UPLOADS_DIR_NAME), UPLOADS_DIR_NAME);
    if (workbookRel) {
      const wbMod = require('./finance_workbook');
      zip.file(workbookRel, fs.readFileSync(wbMod.latestPath(userDataPath)));
    }
    zip.file('manifest.json', JSON.stringify({
      app: 'Nickland Edusoft',
      kind: label || 'manual',
      db_file: DB_FILE,
      finance_workbook: workbookRel,
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

// Copy a freshly-made backup to the configured extra destinations (custom
// folder / LAN / cloud-sync folder) and prune old automatic backups everywhere.
function fanOutAndPrune(db, userDataPath, srcPath) {
  const cfg = engine.getConfig(db);
  const folders = engine.destinationFolders(cfg);
  const copies = srcPath ? engine.copyToFolders(srcPath, folders) : [];
  // Prune the default folder + every destination folder.
  engine.pruneRetention(backupDir(userDataPath), cfg.retention);
  for (const folder of folders) engine.pruneRetention(folder, cfg.retention);
  return copies;
}

// The full automatic backup: snapshot → default folder → destinations → prune.
async function runAutomaticBackup(db, userDataPath) {
  const res = await createBackup(db, userDataPath, { label: engine.AUTO_LABEL });
  if (!res.ok) return res;
  const copies = fanOutAndPrune(db, userDataPath, res.path);
  try {
    setSetting(db, 'backup_last_auto_at', new Date().toISOString(), 'backup');
    recordAudit(db, 'backup_auto', `Automatic backup: ${res.fileName}`, 'normal');
  } catch (_) {}
  return { ...res, copies };
}

// Called by a 60-second scheduler in the main process.
async function maybeRunScheduledBackup(db, userDataPath) {
  try {
    const cfg = engine.getConfig(db);
    if (!cfg.enabled) return;
    const last = cfg.lastAutoAt ? new Date(cfg.lastAutoAt) : null;
    if (engine.isBackupDue(cfg, new Date(), last)) {
      await runAutomaticBackup(db, userDataPath);
    }
  } catch (_) { /* never let the scheduler crash the app */ }
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

  // ── Create a backup (also copies to configured destinations) ──
  ipcMain.handle('backup:create', async () => {
    if (!security.checkPermission(db, 'settings', 'edit')) return denied('create backups');
    try {
      const res = await createBackup(db, userDataPath, {});
      if (res.ok) {
        const copies = fanOutAndPrune(db, userDataPath, res.path);
        recordAudit(db, 'backup_created', `Backup created: ${res.fileName}`, 'normal');
        return { ...res, copies };
      }
      return res;
    } catch (e) {
      return { ok: false, error: 'Backup failed: ' + (e.message || String(e)) };
    }
  });

  // ── Automated backup config ───────────────────────────
  ipcMain.handle('backup:get-config', () => {
    const cfg = engine.getConfig(db);
    return { ok: true, config: cfg, defaultFolder: backupDir(userDataPath) };
  });

  ipcMain.handle('backup:set-config', (_e, patch) => {
    if (!security.checkPermission(db, 'settings', 'edit')) return denied('change backup settings');
    const map = {
      enabled: 'backup_auto_enabled', frequency: 'backup_frequency', time: 'backup_time',
      dayOfWeek: 'backup_day_of_week', retention: 'backup_retention',
      folderPath: 'backup_folder_path', cloudPath: 'backup_cloud_path',
    };
    for (const [k, key] of Object.entries(map)) {
      if (patch[k] !== undefined) setSetting(db, key, patch[k], 'backup');
    }
    return { ok: true, config: engine.getConfig(db) };
  });

  // ── Run an automatic backup now (manual trigger of the fan-out routine) ──
  ipcMain.handle('backup:run-auto', async () => {
    if (!security.checkPermission(db, 'settings', 'edit')) return denied('run backups');
    return await runAutomaticBackup(db, userDataPath);
  });

  // ── Pick a destination folder (custom / LAN / cloud-sync) ──
  ipcMain.handle('backup:pick-folder', async () => {
    const { dialog, BrowserWindow } = require('electron');
    const win = BrowserWindow.getFocusedWindow();
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose a backup destination folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
    return { ok: true, folder: res.filePaths[0] };
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

    const uploadsPath = path.join(userDataPath, UPLOADS_DIR_NAME);
    let stagedDbPath = null;
    try {
      // 2. Read the archive and stage its database to a temp file. Everything
      //    that can fail is done BEFORE the live data is touched.
      const dbBuffer = dbEntry.asNodeBuffer();
      stagedDbPath = path.join(os.tmpdir(), `nickland-edusoft-restore-${Date.now()}.db`);
      fs.writeFileSync(stagedDbPath, dbBuffer);

      // 3. Refuse to restore something that is not a sound database. Without
      //    this, a corrupt archive replaced good data with an unopenable file.
      const check = verifyDatabaseFile(stagedDbPath);
      if (!check.ok) {
        return { ok: false, error: `This backup cannot be restored — ${check.error}. Your current data has not been changed.` };
      }

      // 4. Resolve upload + finance-workbook entries, rejecting any that would
      //    escape the data folder, before we delete the existing uploads.
      const WORKBOOK_DIR_NAME = require('./finance_workbook').WORKBOOK_DIR;
      const workbookPath = path.join(userDataPath, WORKBOOK_DIR_NAME);
      const uploadEntries = [];
      const workbookEntries = [];
      for (const name of Object.keys(zip.files)) {
        if (zip.files[name].dir) continue;
        const normalized = name.replace(/\\/g, '/');
        const isUpload = normalized.startsWith(UPLOADS_DIR_NAME + '/');
        const isWorkbook = normalized.startsWith(WORKBOOK_DIR_NAME + '/');
        if (!isUpload && !isWorkbook) continue;
        const dest = safeExtractPath(userDataPath, normalized);
        const root = path.resolve(isUpload ? uploadsPath : workbookPath) + path.sep;
        if (!dest || !dest.startsWith(root)) {
          recordAudit(db, 'restore_rejected', `Backup contains an unsafe file path: ${normalized}`, 'high');
          return { ok: false, error: 'This backup contains an unsafe file path and was rejected. Your current data has not been changed.' };
        }
        (isUpload ? uploadEntries : workbookEntries).push({ dest, buffer: zip.files[name].asNodeBuffer() });
      }

      // 5. Safety backup of the CURRENT data before we overwrite anything.
      const safety = await createBackup(db, userDataPath, { label: 'safety-before-restore' });
      if (!safety.ok) return { ok: false, error: 'Could not create a safety backup, restore aborted.' };

      recordAudit(db, 'restore', `Restoring from ${path.basename(backupPath)}; safety backup: ${safety.fileName}`, 'high');

      // 6. Close the live database so the file can be replaced safely (Windows-safe).
      //    From here on the app cannot keep running against the old handle, so
      //    every exit path below has to relaunch.
      try { db.close(); } catch (e) { /* already closed */ }

      try {
        // 7. Replace the database file (and clear stale WAL/SHM side files).
        const dbPath = path.join(userDataPath, DB_FILE);
        fs.copyFileSync(stagedDbPath, dbPath);
        for (const side of ['-wal', '-shm']) {
          const sp = dbPath + side;
          if (fs.existsSync(sp)) { try { fs.unlinkSync(sp); } catch (e) {} }
        }

        // 8. Replace the uploads folder with the backed-up files.
        try { fs.rmSync(uploadsPath, { recursive: true, force: true }); } catch (e) {}
        ensureDir(uploadsPath);
        for (const entry of uploadEntries) {
          ensureDir(path.dirname(entry.dest));
          fs.writeFileSync(entry.dest, entry.buffer);
        }

        // 8b. Restore the offline finance workbook that shipped with this
        //     backup, so the school's continuity copy matches the data they
        //     just restored rather than the position before it.
        for (const entry of workbookEntries) {
          ensureDir(path.dirname(entry.dest));
          fs.writeFileSync(entry.dest, entry.buffer);
        }
      } catch (e) {
        // The database handle is already closed, so the app cannot continue in
        // this state either way — restart so it reopens against whatever is on
        // disk, and tell the operator which safety backup to fall back to.
        scheduleRelaunch(app);
        return {
          ok: false, restartRequired: true, safetyBackup: safety.fileName,
          error: `Restore failed part-way: ${e.message || String(e)}. The app will restart; if data looks wrong, restore ${safety.fileName}.`,
        };
      }

      // 9. Relaunch so the app reopens against the restored data.
      scheduleRelaunch(app);
      return { ok: true, restartRequired: true, safetyBackup: safety.fileName };
    } catch (e) {
      return { ok: false, error: 'Restore failed: ' + (e.message || String(e)) };
    } finally {
      try { if (stagedDbPath && fs.existsSync(stagedDbPath)) fs.unlinkSync(stagedDbPath); } catch (_) {}
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
module.exports.runAutomaticBackup = runAutomaticBackup;

// Start the 60-second scheduler that runs due automatic backups.
module.exports.startScheduler = function startScheduler(db, userDataPath) {
  const tick = () => maybeRunScheduledBackup(db, userDataPath);
  const timer = setInterval(tick, 60 * 1000);
  if (timer.unref) timer.unref();
  return timer;
};
