// Nickland Edusoft — Main Process
// Copyright © 2026 Nickland Sales. All rights reserved.
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { initDatabase } = require('./db/database');
const registerStudentHandlers = require('./ipc/students');
const registerStaffHandlers = require('./ipc/staff');
const registerFeesHandlers = require('./ipc/fees');
const registerScoresHandlers = require('./ipc/scores');
const registerCanteenHandlers = require('./ipc/canteen');
const registerFinanceHandlers = require('./ipc/finance');
const registerSettingsHandlers = require('./ipc/settings');
const registerReportsHandlers = require('./ipc/reports');
const registerNotificationsHandlers = require('./ipc/notifications');
const registerAuthHandlers = require('./ipc/auth');
const registerAccessHandlers = require('./ipc/access');
const registerDashboardHandlers = require('./ipc/dashboard');
const registerStudentAttendanceHandlers = require('./ipc/students_attendance');
const registerStudentsSheetHandlers = require('./ipc/students_sheet');
const registerAcademicsHandlers = require('./ipc/academics');
const registerFeesExtraHandlers = require('./ipc/fees_extra');
const registerFeesBillingHandlers = require('./ipc/fees_billing');
const registerFinanceWorkbookHandlers = require('./ipc/finance_workbook');
const registerCanteenExtraHandlers = require('./ipc/canteen_extra');
const registerStaffHrHandlers = require('./ipc/staff_hr');
const registerPayrollHandlers = require('./ipc/payroll');
const registerMobileSyncHandlers = require('./ipc/mobile_sync');
const registerDiscountsHandlers = require('./ipc/fees_discounts');
const registerBooksHandlers = require('./ipc/books');
const registerFeesBulkPayHandlers = require('./ipc/fees_bulk_pay');
const registerInventoryHandlers = require('./ipc/inventory');
const registerAuditLogHandlers = require('./ipc/audit_log');
const registerReceiptTemplatesHandlers = require('./ipc/receipt_templates');
const registerPhotosHandlers = require('./ipc/photos');
const registerStaffActivitiesHandlers = require('./ipc/staff_activities');
const registerBackupHandlers = require('./ipc/backup');
const registerSessionHandlers = require('./ipc/session');
const registerMobileHandlers = require('./ipc/mobile');
const registerPaymentsIntentsHandlers = require('./ipc/payments_intents');
const registerAnnouncementsHandlers = require('./ipc/announcements');
const registerCloudSyncHandlers = require('./ipc/cloud_sync');
const registerTimetableHandlers = require('./ipc/timetable');
const registerTransportHandlers = require('./ipc/transport');
const registerMessagingHandlers = require('./ipc/messaging');
const registerHomeworkHandlers = require('./ipc/homework');
const registerStubHandlers = require('./ipc/_stubs');

const logger = require('./utils/logger');

const isDev = !app.isPackaged;
let mainWindow;

// ── Single instance ──────────────────────────────────────
// Two copies of the app would open the same SQLite file and both try to bind
// the mobile API port, which shows up as locked-database errors and a mobile
// server that "won't start". Hand the focus to the running copy instead.
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) {
  // app.quit() is asynchronous, so the whenReady handler below would still
  // run and open the database from this second process. It checks the flag.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ── Last-resort error handling ───────────────────────────
// Anything that escapes to here would otherwise kill the window silently, or
// leave the app running in a broken state with no trace of why.
process.on('uncaughtException', (err) => {
  logger.error('process', 'Uncaught exception', (err && err.stack) || String(err));
});
process.on('unhandledRejection', (reason) => {
  logger.error('process', 'Unhandled promise rejection', (reason && reason.stack) || String(reason));
});

// ── Background maintenance ───────────────────────────────
// Several tables previously grew for the life of the installation: expired and
// revoked mobile tokens, synced outbox rows, and the log mirror. On a school
// PC that runs for years this is the difference between a snappy database and
// a slow one. Runs once shortly after boot, then daily.
function startMaintenance(db) {
  const outbox = require('./server/sync/outbox');

  const sweep = () => {
    try {
      const tokens = db.prepare(
        "DELETE FROM api_tokens WHERE (expires_at IS NOT NULL AND expires_at < datetime('now')) " +
        "OR (revoked = 1 AND created_at < datetime('now', '-90 days'))"
      ).run().changes;
      const rows = outbox.pruneSynced(db, 14);
      const logs = logger.pruneDatabaseLog(30);
      if (tokens || rows || logs) {
        logger.info('maintenance', `Cleaned up: ${tokens} expired token(s), ${rows} synced outbox row(s), ${logs} old log entr(ies)`);
      }
      const stuck = outbox.deadCount(db);
      if (stuck) logger.warn('maintenance', `${stuck} cloud sync record(s) have stopped retrying — open Settings → Cloud and use "Push now" after fixing the cause.`);
    } catch (e) {
      logger.warn('maintenance', 'Cleanup pass failed', (e && e.message) || String(e));
    }
  };

  const first = setTimeout(sweep, 60 * 1000);
  if (first.unref) first.unref();
  const daily = setInterval(sweep, 24 * 60 * 60 * 1000);
  if (daily.unref) daily.unref();
}

// Show a startup failure instead of exiting with no window and no message.
function reportFatal(err, stage) {
  const detail = (err && err.stack) || String(err);
  logger.error('startup', `Startup failed during ${stage}`, detail);
  const where = logger.paths().file;
  try {
    dialog.showErrorBox(
      'Nickland Edusoft could not start',
      `Something went wrong while ${stage}.\n\n${(err && err.message) || String(err)}\n\n` +
      (where ? `Details were written to:\n${where}\n\n` : '') +
      'If this keeps happening, restore your most recent backup or contact Nickland Sales.'
    );
  } catch (_) {}
  app.exit(1);
}

function getResourcePath(relativePath) {
  if (isDev) return path.join(__dirname, '..', 'resources', relativePath);
  return path.join(process.resourcesPath, 'resources', relativePath);
}

function getUserDataPath() {
  // %APPDATA%/NicklandEdusoft on Windows
  return app.getPath('userData');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'Nickland Edusoft',
    icon: getResourcePath('logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#1B3A6B',
    show: false,
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Hand off external links to the browser — but only real web links.
  // Passing every scheme straight to the OS shell turns any injected markup
  // (a pasted student name, an imported spreadsheet cell) into a launcher for
  // file:, smb: or custom-protocol payloads.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const scheme = new URL(url).protocol;
      if (scheme === 'https:' || scheme === 'http:' || scheme === 'mailto:') {
        shell.openExternal(url);
      } else {
        logger.warn('window', `Blocked attempt to open a non-web link: ${String(url).slice(0, 200)}`);
      }
    } catch (_) { /* not a URL we can parse — ignore it */ }
    return { action: 'deny' };
  });

  // Same rule for in-page navigation: the window must stay on the app itself.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isAppUrl = isDev ? url.startsWith('http://localhost:5173') : url.startsWith('file://');
    if (!isAppUrl) {
      event.preventDefault();
      logger.warn('window', `Blocked navigation away from the app: ${String(url).slice(0, 200)}`);
    }
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logger.error('window', `Renderer process gone (${details.reason})`, JSON.stringify(details));
  });

  mainWindow.on('unresponsive', () => logger.warn('window', 'Window became unresponsive'));
}

app.whenReady().then(async () => {
  // Another copy is already running and owns the database — this process is on
  // its way out, so it must not touch anything.
  if (!gotInstanceLock) return;

  const userDataPath = getUserDataPath();
  if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });
  const uploadsPath = path.join(userDataPath, 'uploads');
  if (!fs.existsSync(uploadsPath)) fs.mkdirSync(uploadsPath, { recursive: true });

  logger.init(userDataPath);
  logger.info('startup', `Nickland Edusoft ${app.getVersion()} starting (${isDev ? 'dev' : 'packaged'})`);

  let db;
  try {
    db = initDatabase(userDataPath, getResourcePath);
    logger.attachDatabase(db);
  } catch (e) {
    return reportFatal(e, 'opening the database');
  }

  // Register all IPC handlers
  // Mount each module in isolation: one module failing to register should cost
  // that module's features, not the whole application. Failures are recorded
  // rather than swallowed, so a feature that "does nothing" is traceable.
  const failedModules = [];
  const mount = (name, fn) => {
    try { fn(); } catch (e) {
      failedModules.push(name);
      logger.error('startup', `Module "${name}" failed to register`, (e && e.stack) || String(e));
    }
  };

  // Auth is not optional — without it nobody can sign in at all.
  try {
    registerAuthHandlers(ipcMain, db);
    registerAccessHandlers(ipcMain, db);
  } catch (e) {
    return reportFatal(e, 'setting up sign-in');
  }

  mount('dashboard', () => registerDashboardHandlers(ipcMain, db));
  mount('students.attendance', () => registerStudentAttendanceHandlers(ipcMain, db, userDataPath, getResourcePath));
  mount('students.sheet', () => registerStudentsSheetHandlers(ipcMain, db));
  mount('academics', () => registerAcademicsHandlers(ipcMain, db));
  mount('fees.extra', () => registerFeesExtraHandlers(ipcMain, db));
  mount('fees.billing', () => registerFeesBillingHandlers(ipcMain, db));
  mount('finance.workbook', () => registerFinanceWorkbookHandlers(ipcMain, db, app, userDataPath));
  mount('canteen.extra', () => registerCanteenExtraHandlers(ipcMain, db));
  mount('staff.hr', () => registerStaffHrHandlers(ipcMain, db, userDataPath));
  mount('payroll', () => registerPayrollHandlers(ipcMain, db));
  mount('mobile.sync', () => registerMobileSyncHandlers(ipcMain, db));
  mount('fees.discounts', () => registerDiscountsHandlers(ipcMain, db));
  mount('books', () => registerBooksHandlers(ipcMain, db));
  mount('fees.bulkPay', () => registerFeesBulkPayHandlers(ipcMain, db));
  mount('inventory', () => registerInventoryHandlers(ipcMain, db));
  mount('auditLog', () => registerAuditLogHandlers(ipcMain, db));
  mount('receiptTemplates', () => registerReceiptTemplatesHandlers(ipcMain, db, userDataPath, getResourcePath));
  mount('photos', () => registerPhotosHandlers(ipcMain, db, userDataPath));
  mount('staff.activities', () => registerStaffActivitiesHandlers(ipcMain, db));
  mount('students', () => registerStudentHandlers(ipcMain, db, userDataPath));
  mount('staff', () => registerStaffHandlers(ipcMain, db, userDataPath));
  mount('fees', () => registerFeesHandlers(ipcMain, db));
  mount('scores', () => registerScoresHandlers(ipcMain, db));
  mount('canteen', () => registerCanteenHandlers(ipcMain, db));
  mount('finance', () => registerFinanceHandlers(ipcMain, db));
  mount('settings', () => registerSettingsHandlers(ipcMain, db, getResourcePath));
  mount('reports', () => registerReportsHandlers(ipcMain, db, userDataPath, getResourcePath));
  mount('notifications', () => registerNotificationsHandlers(ipcMain, db));
  mount('backup', () => registerBackupHandlers(ipcMain, db, app, userDataPath));
  // Heal absolute upload paths (logo, signatures, photos) the moment the app
  // starts, so a data-folder move from an update — or a restore taken on
  // another PC — never leaves the logo showing broken.
  mount('backup.repair', () => require('./ipc/backup').repairUploadPathsOnStartup(db, userDataPath));
  mount('backup.scheduler', () => require('./ipc/backup').startScheduler(db, userDataPath));
  mount('session', () => registerSessionHandlers(ipcMain, db));
  mount('mobile', () => registerMobileHandlers(ipcMain, db));
  mount('payments.intents', () => registerPaymentsIntentsHandlers(ipcMain, db));
  mount('cloudSync', () => registerCloudSyncHandlers(ipcMain, db));
  mount('announcements', () => registerAnnouncementsHandlers(ipcMain, db));
  mount('timetable', () => registerTimetableHandlers(ipcMain, db));
  mount('transport', () => registerTransportHandlers(ipcMain, db));
  mount('messaging', () => registerMessagingHandlers(ipcMain, db));
  mount('homework', () => registerHomeworkHandlers(ipcMain, db));

  // Stubs LAST — only register channels not already taken
  mount('stubs', () => registerStubHandlers(ipcMain, db));

  if (failedModules.length) {
    logger.warn('startup', `Started with ${failedModules.length} module(s) unavailable: ${failedModules.join(', ')}`);
  } else {
    logger.info('startup', 'All modules registered');
  }

  startMaintenance(db);

  ipcMain.handle('app:get-paths', () => ({
    userData: userDataPath,
    uploads: uploadsPath,
    logs: logger.paths().dir,
    resources: isDev
      ? path.join(__dirname, '..', 'resources')
      : path.join(process.resourcesPath, 'resources'),
  }));

  // ── Diagnostics, for supporting a school remotely ──
  ipcMain.handle('app:diagnostics', () => {
    const security = require('./ipc/_security');
    if (!security.checkPermission(db, 'settings', 'view')) {
      return { ok: false, error: 'Access denied.' };
    }
    let counts = {};
    try {
      counts = {
        students: db.prepare("SELECT COUNT(*) c FROM students WHERE status='Active'").get().c,
        users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
        pending_sync: require('./server/sync/outbox').pendingCount(db),
        stuck_sync: require('./server/sync/outbox').deadCount(db),
      };
    } catch (_) {}
    return {
      ok: true,
      version: app.getVersion(),
      electron: process.versions.electron,
      platform: `${process.platform} ${process.arch}`,
      packaged: !isDev,
      userData: userDataPath,
      logFile: logger.paths().file,
      failedModules,
      counts,
      recent: logger.recent(100),
    };
  });

  ipcMain.handle('app:open-logs', () => {
    const dir = logger.paths().dir;
    if (!dir) return { ok: false, error: 'No log folder available.' };
    shell.openPath(dir);
    return { ok: true, folder: dir };
  });

  ipcMain.handle('app:show-open-dialog', async (_e, options) =>
    dialog.showOpenDialog(mainWindow, options)
  );
  ipcMain.handle('app:show-save-dialog', async (_e, options) =>
    dialog.showSaveDialog(mainWindow, options)
  );
  ipcMain.handle('app:open-folder', async (_e, folderPath) => shell.openPath(folderPath));
  ipcMain.handle('app:open-file', async (_e, filePath) => {
    // Open the file with the OS default app (e.g., Word for .docx)
    const result = await shell.openPath(filePath);
    return result === '' ? { ok: true } : { ok: false, error: result };
  });

  ipcMain.handle('app:print-to-pdf', async (_e, options) => {
    // The rendering window is sandboxed and gets no preload/Node access — it
    // only ever renders a document we are about to print.
    const win = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true },
    });
    try {
      await win.loadURL(options.url);
      return await win.webContents.printToPDF({ printBackground: true });
    } catch (e) {
      logger.warn('print', 'printToPDF failed', (e && e.message) || String(e));
      throw e;
    } finally {
      try { win.destroy(); } catch (_) {}
    }
  });

  // Open a generated PDF in a preview window with native Chromium PDF viewer.
  // This gives the user a proper print preview with Print and Save buttons
  // (Chromium's built-in PDF viewer toolbar).
  ipcMain.handle('app:open-pdf-preview', async (_e, filePath) => {
    if (!filePath || !require('fs').existsSync(filePath)) {
      return { ok: false, error: 'PDF not found at ' + filePath };
    }
    const previewWin = new BrowserWindow({
      width: 980, height: 1100,
      title: 'Print Preview — ' + require('path').basename(filePath),
      autoHideMenuBar: true,
      webPreferences: {
        plugins: true,           // enables Chromium PDF viewer
        nodeIntegration: false,
        contextIsolation: true,
      },
      parent: mainWindow,
    });
    // Chromium handles file:// PDF URLs natively with print/save toolbar
    previewWin.loadURL('file://' + filePath);
    return { ok: true };
  });

  try {
    createWindow();
  } catch (e) {
    return reportFatal(e, 'opening the main window');
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((e) => reportFatal(e, 'starting up'));

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
