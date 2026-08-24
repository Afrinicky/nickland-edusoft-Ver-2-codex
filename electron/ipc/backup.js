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
function defaultBackupDir(userDataPath) {
  return path.join(userDataPath, BACKUP_DIR_NAME);
}

// Where the FIRST copy of every backup is kept. Defaults to a folder beside the
// data on this PC; an operator can point it at a second disk or a network drive
// ("Where backups are kept · Change folder"). Falls back to the default the
// moment the chosen folder cannot be reached, so a missing network share can
// never stop a backup from being written somewhere safe.
function primaryFolder(db, userDataPath) {
  let chosen = '';
  try { const r = db.prepare("SELECT value FROM settings WHERE key = 'backup_primary_folder'").get(); chosen = (r && r.value || '').trim(); }
  catch (_) {}
  if (!chosen) return defaultBackupDir(userDataPath);
  try { ensureDir(chosen); return chosen; } catch (_) { return defaultBackupDir(userDataPath); }
}

// Back-compat shim: older code in this file called backupDir(userDataPath).
// It now resolves the configured primary folder when a db handle is in scope.
function backupDir(userDataPath) {
  return defaultBackupDir(userDataPath);
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

  const dir = primaryFolder(db, userDataPath);
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

// Copy a freshly-made backup out to every configured destination, remember any
// that could not be reached so they are retried later, update each
// destination's status, and prune old automatic backups everywhere.
function fanOutAndPrune(db, userDataPath, srcPath) {
  const cfg = engine.getConfig(db);
  const dests = cfg.destinations || [];
  const copies = srcPath ? engine.copyToDestinations(srcPath, dests) : [];

  // Record failures for retry, and stamp each destination with its outcome so
  // the screen can show a red or green dot without re-testing.
  const pending = engine.loadPending(db);
  const now = new Date().toISOString();
  const byId = new Map(dests.map(d => [d.id, d]));
  for (const r of copies) {
    const d = byId.get(r.id);
    if (!d || r.skipped) continue;
    if (r.ok) { d.lastCopiedAt = now; d.lastError = null; }
    else {
      d.lastError = r.error || 'copy failed';
      if (srcPath) pending.push({ destId: r.id, srcPath, queuedAt: now });
    }
  }
  engine.saveDestinations(db, dests, setSetting);
  engine.savePending(db, pending, setSetting);

  // Prune the default folder + every destination folder.
  engine.pruneRetention(primaryFolder(db, userDataPath), cfg.retention);
  for (const d of dests) engine.pruneRetention(d.path, cfg.retention);
  return copies;
}

// Retry the copies that never reached a destination. Called on the scheduler
// tick and from the "retry now" button.
function retryDeliveries(db) {
  const cfg = engine.getConfig(db);
  const dests = cfg.destinations || [];
  const res = engine.retryPending(db, dests, setSetting);
  // A destination that just took its backlog is no longer failing.
  if (res.delivered > 0) {
    const waiting = engine.waitingByDest(db);
    let changed = false;
    for (const d of dests) {
      if (d.lastError && !waiting[d.id]) { d.lastError = null; d.lastCopiedAt = new Date().toISOString(); changed = true; }
    }
    if (changed) engine.saveDestinations(db, dests, setSetting);
  }
  return res;
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
    // Always try to clear the retry backlog — a destination that was offline
    // when a backup ran should be filled the moment it comes back, whether or
    // not another backup is due.
    try { retryDeliveries(db); } catch (_) {}
    if (!cfg.scheduled) return;
    const last = cfg.lastAutoAt ? new Date(cfg.lastAutoAt) : null;
    if (engine.isBackupDue(cfg, new Date(), last)) {
      await runAutomaticBackup(db, userDataPath);
    }
  } catch (_) { /* never let the scheduler crash the app */ }
}

// The label prefixes used for the safety copies taken automatically before a
// restore or a factory reset. Kept as constants so the list view can label
// them "Pre-restore snapshot" / "Pre-reset snapshot" the way the operator reads
// them, while still matching copies made by older builds.
const PRE_RESTORE_LABEL = 'pre-restore-snapshot';
const PRE_RESET_LABEL = 'pre-reset-snapshot';

// Work out what a backup file IS from its name, for the restore list.
function backupMeta(fileName) {
  const n = String(fileName);
  if (/-pre-restore-snapshot-|-safety-before-restore-/.test(n)) return { kind: 'pre-restore', label: 'Pre-restore snapshot' };
  if (/-pre-reset-snapshot-|-safety-before-reset-/.test(n)) return { kind: 'pre-reset', label: 'Pre-reset snapshot' };
  if (/-auto-/.test(n)) return { kind: 'auto', label: 'Automatic backup' };
  return { kind: 'manual', label: 'Manual backup' };
}

// Heal the absolute upload paths in the live database so the logo, signatures
// and photos survive a data-folder move (an app update, a new PC). Cheap; safe
// to call on every launch. Uses the live handle, which is better-sqlite3 in the
// app but only needs `.prepare`.
function repairUploadPathsOnStartup(db, userDataPath) {
  try {
    const { repairUploadPaths } = require('./backup_archive');
    const r = repairUploadPaths(db, userDataPath);
    if (r.repaired > 0) {
      try {
        db.prepare("INSERT INTO system_log (level, source, message, detail) VALUES ('info','backup',?,?)")
          .run(`Repaired ${r.repaired} upload path(s) after a data-folder move`, JSON.stringify(r.details).slice(0, 800));
      } catch (_) {}
    }
    return r;
  } catch (_) { return { repaired: 0 }; }
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
    const dir = primaryFolder(db, userDataPath);
    let chosen = '';
    try { const r = db.prepare("SELECT value FROM settings WHERE key = 'backup_primary_folder'").get(); chosen = (r && r.value || '').trim(); } catch (_) {}
    const reachable = chosen ? engine.testDestination(chosen).ok : true;
    return {
      ok: true,
      folder: dir,
      configuredFolder: chosen || null,
      isDefault: !chosen,
      reachable,
      defaultFolder: defaultBackupDir(userDataPath),
      dbPath: path.join(userDataPath, DB_FILE),
      uploadsPath: path.join(userDataPath, UPLOADS_DIR_NAME),
      format: 'zip',
    };
  });

  // ── List previous backups ─────────────────────────────
  ipcMain.handle('backup:list', () => {
    const dir = primaryFolder(db, userDataPath);
    if (!fs.existsSync(dir)) return { ok: true, folder: dir, backups: [] };
    const backups = fs.readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.zip'))
      .map((f) => {
        const full = path.join(dir, f);
        const st = fs.statSync(full);
        return { fileName: f, path: full, size: st.size, modified: st.mtime.toISOString(), ...backupMeta(f) };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified));
    return { ok: true, folder: dir, backups };
  });

  // ── Open the backups folder in the OS file manager ────
  ipcMain.handle('backup:open-folder', () => {
    const dir = primaryFolder(db, userDataPath);
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
    return { ok: true, config: cfg, defaultFolder: primaryFolder(db, userDataPath) };
  });

  ipcMain.handle('backup:set-config', (_e, patch) => {
    if (!security.checkPermission(db, 'settings', 'edit')) return denied('change backup settings');
    const map = {
      mode: 'backup_schedule_mode', time: 'backup_time', time2: 'backup_time2',
      dayOfWeek: 'backup_day_of_week', retention: 'backup_retention',
      // Legacy keys, still accepted so nothing that writes them breaks.
      enabled: 'backup_auto_enabled', frequency: 'backup_frequency',
      folderPath: 'backup_folder_path', cloudPath: 'backup_cloud_path',
    };
    for (const [k, key] of Object.entries(map)) {
      if (patch[k] !== undefined) setSetting(db, key, patch[k], 'backup');
    }
    // Keep the legacy enabled flag consistent with the mode so an older code
    // path (or a downgrade) still reads the right on/off state.
    if (patch.mode !== undefined) setSetting(db, 'backup_auto_enabled', patch.mode !== 'manual', 'backup');
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
      const safety = await createBackup(db, userDataPath, { label: PRE_RESTORE_LABEL });
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

        // 8c. Re-point the absolute upload paths inside the RESTORED database at
        //     this machine's uploads folder. The backup carries the logo,
        //     signatures and photos, but their stored paths name wherever the
        //     backup was MADE — a different PC, or this one before an update
        //     moved the data folder. Without this the files are on disk but the
        //     database points elsewhere, and the logo shows broken. The live
        //     handle is already closed, so open the on-disk copy just for this.
        try {
          const { repairUploadPaths } = require('./backup_archive');
          let Database; try { Database = require('better-sqlite3'); } catch (_) { Database = null; }
          if (Database) {
            const restored = new Database(dbPath);
            try { repairUploadPaths(restored, userDataPath); } finally { restored.close(); }
          }
        } catch (_) { /* a heal failure must never fail an otherwise-good restore */ }
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

  // ── Where the first copy is kept (the primary folder) ──
  ipcMain.handle('backup:set-primary-folder', (_e, folder) => {
    if (!security.checkPermission(db, 'settings', 'edit')) return denied('change the backup folder');
    const chosen = (folder || '').trim();
    if (chosen) {
      const t = engine.testDestination(chosen);
      if (!t.ok) return { ok: false, error: `That folder cannot be used: ${t.error}` };
    }
    setSetting(db, 'backup_primary_folder', chosen, 'backup');
    recordAudit(db, 'backup_folder_changed', `Primary backup folder set to: ${chosen || '(default)'}`, 'normal');
    return { ok: true, folder: primaryFolder(db, userDataPath), isDefault: !chosen };
  });

  // ── Health status for the hero card ───────────────────
  ipcMain.handle('backup:status', () => {
    const cfg = engine.getConfig(db);
    const dir = primaryFolder(db, userDataPath);
    let lastBackupAt = null, lastBackupSize = 0, keptHere = 0, totalHereBytes = 0;
    try {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.zip'))
          .map(f => ({ f, st: fs.statSync(path.join(dir, f)) }))
          .sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
        keptHere = files.length;
        totalHereBytes = files.reduce((n, x) => n + x.st.size, 0);
        if (files.length) { lastBackupAt = files[0].st.mtime.toISOString(); lastBackupSize = files[0].st.size; }
      }
    } catch (_) {}
    const waiting = engine.waitingByDest(db);
    const waitingTotal = Object.values(waiting).reduce((a, b) => a + b, 0);
    const status = engine.computeStatus(cfg, { lastBackupAt, waitingTotal }, new Date());
    return {
      ok: true, status,
      lastBackupAt, lastBackupSize, keptHere, totalHereBytes,
      retention: cfg.retention, mode: cfg.mode, defaultFolder: dir,
    };
  });

  // ── Destinations (where copies go) ────────────────────
  ipcMain.handle('backup:list-destinations', () => {
    const cfg = engine.getConfig(db);
    const waiting = engine.waitingByDest(db);
    return { ok: true, destinations: cfg.destinations.map(d => ({ ...d, waiting: waiting[d.id] || 0 })) };
  });

  ipcMain.handle('backup:add-destination', (_e, { label, kind, path: destPath } = {}) => {
    if (!security.checkPermission(db, 'settings', 'edit')) return denied('add backup destinations');
    if (!destPath || !String(destPath).trim()) return { ok: false, error: 'A folder is required.' };
    const cfg = engine.getConfig(db);
    const list = cfg.destinations.concat([{
      id: engine.newId(),
      label: (label && String(label).trim()) || (kind === 'network' ? 'Network or shared folder' : 'Folder on this computer'),
      kind: kind === 'network' ? 'network' : 'local',
      path: String(destPath).trim(), paused: false,
    }]);
    engine.saveDestinations(db, list, setSetting);
    recordAudit(db, 'backup_destination_added', `Backup destination added: ${destPath}`, 'normal');
    return { ok: true, destinations: engine.loadDestinations(db) };
  });

  ipcMain.handle('backup:update-destination', (_e, { id, patch } = {}) => {
    if (!security.checkPermission(db, 'settings', 'edit')) return denied('change backup destinations');
    const cfg = engine.getConfig(db);
    const list = cfg.destinations.map(d => d.id === id ? { ...d, ...(patch || {}), id: d.id } : d);
    engine.saveDestinations(db, list, setSetting);
    return { ok: true, destinations: engine.loadDestinations(db) };
  });

  ipcMain.handle('backup:remove-destination', (_e, id) => {
    if (!security.checkPermission(db, 'settings', 'edit')) return denied('remove backup destinations');
    const cfg = engine.getConfig(db);
    engine.saveDestinations(db, cfg.destinations.filter(d => d.id !== id), setSetting);
    // Drop any queued copies for the removed destination.
    engine.savePending(db, engine.loadPending(db).filter(x => x.destId !== id), setSetting);
    recordAudit(db, 'backup_destination_removed', `Backup destination removed: ${id}`, 'normal');
    return { ok: true, destinations: engine.loadDestinations(db) };
  });

  // Test one destination (by id) or an ad-hoc folder path (before adding it).
  ipcMain.handle('backup:test-destination', (_e, { id, path: folder } = {}) => {
    let target = folder;
    if (id) { const d = engine.loadDestinations(db).find(x => x.id === id); target = d && d.path; }
    const res = engine.testDestination(target);
    if (id) {
      const cfg = engine.getConfig(db);
      const list = cfg.destinations.map(d => d.id === id
        ? { ...d, lastError: res.ok ? null : (res.error || 'unreachable'), lastCopiedAt: res.ok ? d.lastCopiedAt : d.lastCopiedAt }
        : d);
      engine.saveDestinations(db, list, setSetting);
    }
    return res;
  });

  // Retry any copies that never reached a destination.
  ipcMain.handle('backup:retry', () => {
    if (!security.checkPermission(db, 'settings', 'edit')) return denied('retry backups');
    return { ok: true, ...retryDeliveries(db) };
  });

  // Save a copy of a backup somewhere the operator chooses (a USB stick, a
  // shared drive) — the desktop equivalent of "download".
  ipcMain.handle('backup:save-copy', async (_e, backupPath) => {
    if (!backupPath || !fs.existsSync(backupPath)) return { ok: false, error: 'That backup no longer exists.' };
    const { dialog, BrowserWindow } = require('electron');
    const win = BrowserWindow.getFocusedWindow();
    const res = await dialog.showSaveDialog(win, {
      title: 'Save a copy of this backup',
      defaultPath: path.basename(backupPath),
      filters: [{ name: 'Backup ZIP', extensions: ['zip'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    try { fs.copyFileSync(backupPath, res.filePath); return { ok: true, path: res.filePath }; }
    catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
  });

  // Restore from a file the operator picks off disk (a backup kept elsewhere).
  ipcMain.handle('backup:pick-file', async () => {
    const { dialog, BrowserWindow } = require('electron');
    const win = BrowserWindow.getFocusedWindow();
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose a backup file to restore',
      properties: ['openFile'],
      filters: [{ name: 'Backup ZIP', extensions: ['zip'] }],
    });
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
    return { ok: true, path: res.filePaths[0] };
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
      const safety = await createBackup(db, userDataPath, { label: PRE_RESET_LABEL });
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
module.exports.repairUploadPathsOnStartup = repairUploadPathsOnStartup;

// Start the 60-second scheduler that runs due automatic backups.
module.exports.startScheduler = function startScheduler(db, userDataPath) {
  const tick = () => maybeRunScheduledBackup(db, userDataPath);
  const timer = setInterval(tick, 60 * 1000);
  if (timer.unref) timer.unref();
  return timer;
};
