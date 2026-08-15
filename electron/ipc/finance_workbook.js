// Nickland Edusoft — Finance workbook IPC.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Export the all-in-one finance workbook, preview an import, run it, and see
// the history of what has come in from Excel. The workbook is the school's
// continuity plan: when the computer is down they keep trading in it, and when
// the system is back it comes home.

const fs = require('fs');
const path = require('path');
const security = require('./_security');
const { buildWorkbook } = require('./finance_workbook_export');
const { importWorkbook } = require('./finance_workbook_import');

const WORKBOOK_DIR = 'finance-workbook';
// A stable name so the backup routine and the "latest" lookup always agree.
const LATEST_NAME = 'Finance-Workbook-CURRENT.xlsx';

function workbookDir(userDataPath) {
  const dir = path.join(userDataPath, WORKBOOK_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function latestPath(userDataPath) {
  return path.join(workbookDir(userDataPath), LATEST_NAME);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function safeName(s) {
  return String(s || '').replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '-') || 'School';
}

// Regenerating the workbook is what keeps the offline copy worth having, so it
// runs on a schedule and before every backup as well as on demand.
async function refreshWorkbook(db, userDataPath, options = {}) {
  const dest = latestPath(userDataPath);
  const res = await buildWorkbook(db, dest, options);
  try {
    db.prepare(`
      INSERT INTO settings (key, value, category) VALUES ('finance_workbook_last_built', ?, 'finance')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(new Date().toISOString());
  } catch (_) {}
  return res;
}

module.exports = function registerFinanceWorkbookHandlers(ipcMain, db, app, userDataPath) {
  const canView = () => security.checkPermission(db, 'finance', 'view');
  const canEdit = () => security.checkPermission(db, 'finance', 'edit');

  // ── Status ───────────────────────────────────────────────────────────
  ipcMain.handle('workbook:status', () => {
    const p = latestPath(userDataPath);
    const exists = fs.existsSync(p);
    let lastImport = null;
    try {
      lastImport = db.prepare(`
        SELECT source_file, imported_at, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total
        FROM workbook_import_log
        GROUP BY source_file, date(imported_at)
        ORDER BY imported_at DESC LIMIT 1
      `).get() || null;
    } catch (_) {}
    let built = null;
    try {
      built = db.prepare("SELECT value FROM settings WHERE key = 'finance_workbook_last_built'").get();
    } catch (_) {}
    return {
      ok: true,
      folder: workbookDir(userDataPath),
      path: exists ? p : null,
      size: exists ? fs.statSync(p).size : 0,
      built_at: built ? built.value : null,
      last_import: lastImport,
      can_edit: canEdit(),
    };
  });

  // ── Export ───────────────────────────────────────────────────────────
  ipcMain.handle('workbook:export', async (_e, options = {}) => {
    if (!canView()) return { ok: false, error: 'Access denied. You do not have permission to view finance.' };
    try {
      // Always refresh the canonical copy (the one the backup picks up), then
      // optionally save a dated copy wherever the user asks.
      const res = await refreshWorkbook(db, userDataPath, options);
      let savedTo = res.path;

      if (options.saveAs) {
        const { dialog } = require('electron');
        const school = safeName(
          (db.prepare("SELECT value FROM settings WHERE key = 'school_name'").get() || {}).value
        );
        const suggested = `${school}-Finance-Workbook-${stamp()}.xlsx`;
        const picked = await dialog.showSaveDialog({
          title: 'Save the finance workbook',
          defaultPath: path.join(app.getPath('documents'), suggested),
          filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
        });
        if (picked.canceled || !picked.filePath) return { ok: false, cancelled: true };
        fs.copyFileSync(res.path, picked.filePath);
        savedTo = picked.filePath;
      }

      try {
        db.prepare(`
          INSERT INTO audit_log (entity_type, entity_id, action, user_id, justification, severity)
          VALUES ('finance_workbook', NULL, 'workbook_exported', ?, ?, 'normal')
        `).run(security.getCurrentUserId(), `Exported finance workbook (${res.students} pupils)`);
      } catch (_) {}

      return { ...res, path: savedTo, sheets: res.sheets };
    } catch (e) {
      return { ok: false, error: `The workbook could not be created: ${(e && e.message) || e}` };
    }
  });

  ipcMain.handle('workbook:open-folder', () => {
    try {
      require('electron').shell.openPath(workbookDir(userDataPath));
      return { ok: true };
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });

  ipcMain.handle('workbook:reveal', () => {
    const p = latestPath(userDataPath);
    if (!fs.existsSync(p)) return { ok: false, error: 'No workbook has been exported yet.' };
    try {
      require('electron').shell.showItemInFolder(p);
      return { ok: true };
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });

  // ── Import ───────────────────────────────────────────────────────────
  ipcMain.handle('workbook:pick-file', async () => {
    try {
      const { dialog } = require('electron');
      const picked = await dialog.showOpenDialog({
        title: 'Choose the finance workbook to import',
        properties: ['openFile'],
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx', 'xlsm'] }],
      });
      if (picked.canceled || !picked.filePaths.length) return { ok: false, cancelled: true };
      return { ok: true, path: picked.filePaths[0] };
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });

  // Preview: runs the entire import — parsing, validation, duplicate detection —
  // and reports what it would do, writing nothing. Money should never move on a
  // click the user has not seen the consequences of.
  ipcMain.handle('workbook:preview-import', async (_e, { filePath } = {}) => {
    if (!canEdit()) return { ok: false, error: 'Access denied. You do not have permission to change finance records.' };
    if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: 'That file no longer exists.' };
    try {
      return await importWorkbook(db, filePath, { dryRun: true });
    } catch (e) {
      return { ok: false, error: `The workbook could not be read: ${(e && e.message) || e}` };
    }
  });

  ipcMain.handle('workbook:import', async (_e, { filePath } = {}) => {
    if (!canEdit()) return { ok: false, error: 'Access denied. You do not have permission to change finance records.' };
    if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: 'That file no longer exists.' };
    try {
      const report = await importWorkbook(db, filePath, { dryRun: false });
      // The workbook the school holds is now out of date — refresh the canonical
      // copy so the next offline stint starts from the true position.
      if (report.ok && report.totals.imported > 0) {
        try { await refreshWorkbook(db, userDataPath); } catch (_) {}
      }
      return report;
    } catch (e) {
      return { ok: false, error: `The import failed: ${(e && e.message) || e}` };
    }
  });

  // ── History ──────────────────────────────────────────────────────────
  ipcMain.handle('workbook:import-history', (_e, limit = 200) => {
    try {
      return db.prepare(`
        SELECT wl.*, u.full_name AS imported_by_name
        FROM workbook_import_log wl
        LEFT JOIN users u ON u.id = wl.imported_by
        ORDER BY wl.imported_at DESC, wl.id DESC LIMIT ?
      `).all(limit);
    } catch (_) { return []; }
  });
};

module.exports.refreshWorkbook = refreshWorkbook;
module.exports.latestPath = latestPath;
module.exports.workbookDir = workbookDir;
module.exports.WORKBOOK_DIR = WORKBOOK_DIR;
module.exports.LATEST_NAME = LATEST_NAME;
