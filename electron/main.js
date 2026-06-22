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
const registerDashboardHandlers = require('./ipc/dashboard');
const registerStudentAttendanceHandlers = require('./ipc/students_attendance');
const registerStudentsSheetHandlers = require('./ipc/students_sheet');
const registerAcademicsHandlers = require('./ipc/academics');
const registerFeesExtraHandlers = require('./ipc/fees_extra');
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
const registerStubHandlers = require('./ipc/_stubs');

const isDev = !app.isPackaged;
let mainWindow;

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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  const userDataPath = getUserDataPath();
  if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });
  const uploadsPath = path.join(userDataPath, 'uploads');
  if (!fs.existsSync(uploadsPath)) fs.mkdirSync(uploadsPath, { recursive: true });

  const db = initDatabase(userDataPath, getResourcePath);

  // Register all IPC handlers
  registerAuthHandlers(ipcMain, db);
  registerDashboardHandlers(ipcMain, db);
  registerStudentAttendanceHandlers(ipcMain, db, userDataPath, getResourcePath);
  registerStudentsSheetHandlers(ipcMain, db);
  registerAcademicsHandlers(ipcMain, db);
  registerFeesExtraHandlers(ipcMain, db);
  registerCanteenExtraHandlers(ipcMain, db);
  registerStaffHrHandlers(ipcMain, db, userDataPath);
  registerPayrollHandlers(ipcMain, db);
  registerMobileSyncHandlers(ipcMain, db);
  registerDiscountsHandlers(ipcMain, db);
  registerBooksHandlers(ipcMain, db);
  registerFeesBulkPayHandlers(ipcMain, db);
  registerInventoryHandlers(ipcMain, db);
  registerAuditLogHandlers(ipcMain, db);
  registerReceiptTemplatesHandlers(ipcMain, db, userDataPath);
  registerPhotosHandlers(ipcMain, db, userDataPath);
  registerStaffActivitiesHandlers(ipcMain, db);
  registerStudentHandlers(ipcMain, db, userDataPath);
  registerStaffHandlers(ipcMain, db, userDataPath);
  registerFeesHandlers(ipcMain, db);
  registerScoresHandlers(ipcMain, db);
  registerCanteenHandlers(ipcMain, db);
  registerFinanceHandlers(ipcMain, db);
  registerSettingsHandlers(ipcMain, db, getResourcePath);
  registerReportsHandlers(ipcMain, db, userDataPath, getResourcePath);
  registerNotificationsHandlers(ipcMain, db);
  registerBackupHandlers(ipcMain, db, app, userDataPath);

  // Stubs LAST — only register channels not already taken
  registerStubHandlers(ipcMain, db);

  ipcMain.handle('app:get-paths', () => ({
    userData: userDataPath,
    uploads: uploadsPath,
    resources: isDev
      ? path.join(__dirname, '..', 'resources')
      : path.join(process.resourcesPath, 'resources'),
  }));

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
    const win = new BrowserWindow({ show: false });
    await win.loadURL(options.url);
    const pdf = await win.webContents.printToPDF({ printBackground: true });
    win.close();
    return pdf;
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

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
