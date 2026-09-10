// Nickland Edusoft — Onboarding workbook IPC.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Hand a school a template, take it back filled in, and show them exactly what
// it would do before it does it.
//
// Access is `settings` rather than any one module's, and deliberately: this one
// workbook writes pupils, staff, classes, the fee schedule and the school's own
// identity. An account that may raise a bill has no business rewriting the
// grading scale, so the permission that governs it is the one that governs the
// school's configuration as a whole.

const fs = require('fs');
const path = require('path');
const security = require('./_security');
const { buildWorkbook } = require('./onboarding_export');
const { importWorkbook } = require('./onboarding_import');
const S = require('./_onboarding_schema');

const DIR = 'onboarding';
const TEMPLATE_NAME = 'Onboarding-Workbook-TEMPLATE.xlsx';
const SNAPSHOT_NAME = 'Onboarding-Workbook-CURRENT.xlsx';

function dir(userDataPath) {
  const d = path.join(userDataPath, DIR);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function safeName(s) {
  return String(s || '').replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '-') || 'School';
}

module.exports = function registerOnboardingHandlers(ipcMain, db, app, userDataPath) {
  const canView = () => security.checkPermission(db, 'settings', 'view');
  const canEdit = () => security.checkPermission(db, 'settings', 'edit');
  const denied = (what) => ({ ok: false, error: `Access denied. You do not have permission to ${what}.` });

  // ── Status ───────────────────────────────────────────────────────────
  // Also answers "has this school actually been set up?", which is what the
  // screen leads with — a school with no classes and no pupils needs telling
  // where to start, not a list of buttons.
  ipcMain.handle('onboarding:status', () => {
    const n = (sql) => { try { return db.prepare(sql).get().n; } catch (_) { return 0; } };
    const template = path.join(dir(userDataPath), TEMPLATE_NAME);
    let lastImport = null;
    try {
      lastImport = db.prepare(`
        SELECT justification, created_at FROM audit_log
         WHERE action = 'onboarding_imported' ORDER BY id DESC LIMIT 1
      `).get() || null;
    } catch (_) {}
    return {
      ok: true,
      folder: dir(userDataPath),
      template: fs.existsSync(template) ? template : null,
      sheets: S.SHEET_ORDER.map(name => ({ sheet: name, title: S.IMPORT_SHEETS[name].title,
                                           help: S.IMPORT_SHEETS[name].help })),
      holdings: {
        classes: n('SELECT COUNT(*) AS n FROM class_groups'),
        subjects: n('SELECT COUNT(*) AS n FROM subjects'),
        students: n('SELECT COUNT(*) AS n FROM students'),
        staff: n('SELECT COUNT(*) AS n FROM staff'),
        parents: n('SELECT COUNT(*) AS n FROM parents'),
        fee_templates: n('SELECT COUNT(*) AS n FROM fee_templates'),
      },
      last_import: lastImport,
      can_edit: canEdit(),
    };
  });

  // ── Export ───────────────────────────────────────────────────────────
  // `filled: true` writes out what the school already holds, which is how an
  // office corrects four hundred phone numbers in the one tool that is good at
  // it. `filled: false` is the blank template a new school is handed.
  ipcMain.handle('onboarding:export', async (_e, options = {}) => {
    if (!canView()) return denied('view settings');
    const filled = !!options.filled;
    try {
      const dest = path.join(dir(userDataPath), filled ? SNAPSHOT_NAME : TEMPLATE_NAME);
      const res = await buildWorkbook(db, dest, { filled });
      let savedTo = res.path;

      if (options.saveAs) {
        const { dialog } = require('electron');
        const school = safeName(
          (db.prepare("SELECT value FROM settings WHERE key = 'school_name'").get() || {}).value);
        const picked = await dialog.showSaveDialog({
          title: filled ? 'Save the school\'s data as a workbook' : 'Save the onboarding template',
          defaultPath: path.join(app.getPath('documents'),
            `${school}-Onboarding-${filled ? 'Data' : 'Template'}-${stamp()}.xlsx`),
          filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
        });
        if (picked.canceled || !picked.filePath) return { ok: false, cancelled: true };
        fs.copyFileSync(res.path, picked.filePath);
        savedTo = picked.filePath;
      }

      try {
        db.prepare(`
          INSERT INTO audit_log (entity_type, entity_id, action, user_id, justification, severity)
          VALUES ('onboarding_workbook', NULL, 'onboarding_exported', ?, ?, 'normal')
        `).run(security.getCurrentUserId(),
          filled ? 'Exported the school\'s data as an onboarding workbook'
                 : 'Exported a blank onboarding template');
      } catch (_) {}

      return { ...res, path: savedTo };
    } catch (e) {
      return { ok: false, error: `The workbook could not be created: ${(e && e.message) || e}` };
    }
  });

  ipcMain.handle('onboarding:open-folder', () => {
    try { require('electron').shell.openPath(dir(userDataPath)); return { ok: true }; }
    catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });

  ipcMain.handle('onboarding:pick-file', async () => {
    try {
      const { dialog } = require('electron');
      const picked = await dialog.showOpenDialog({
        title: 'Choose the filled-in onboarding workbook',
        properties: ['openFile'],
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx', 'xlsm'] }],
      });
      if (picked.canceled || !picked.filePaths.length) return { ok: false, cancelled: true };
      return { ok: true, path: picked.filePaths[0] };
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });

  // ── Import ───────────────────────────────────────────────────────────
  // Preview first, always. Onboarding is the one moment a school has no earlier
  // state to go back to, so the consequences are shown before they are applied.
  ipcMain.handle('onboarding:preview', async (_e, { filePath } = {}) => {
    if (!canEdit()) return denied('change the school\'s settings');
    if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: 'That file no longer exists.' };
    try {
      return await importWorkbook(db, filePath, { dryRun: true, userDataPath });
    } catch (e) {
      return { ok: false, error: `The workbook could not be read: ${(e && e.message) || e}` };
    }
  });

  ipcMain.handle('onboarding:import', async (_e, { filePath } = {}) => {
    if (!canEdit()) return denied('change the school\'s settings');
    if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: 'That file no longer exists.' };
    try {
      return await importWorkbook(db, filePath, { dryRun: false, userDataPath });
    } catch (e) {
      return { ok: false, error: `The import failed: ${(e && e.message) || e}` };
    }
  });
};

module.exports.TEMPLATE_NAME = TEMPLATE_NAME;
module.exports.SNAPSHOT_NAME = SNAPSHOT_NAME;
module.exports.onboardingDir = dir;
