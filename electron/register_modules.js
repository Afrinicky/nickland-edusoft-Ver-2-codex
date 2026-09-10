// Nickland Edusoft — every module the school has, mounted once.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// One list, read by both machines that run this application:
//
//   electron/main.js   the office PC, in its own window
//   host/server.js     a server, with no window at all
//
// It exists for the same reason electron/api-surface.js does. A module added
// to one and forgotten in the other is a feature that works in the office and
// silently does not work online — and nobody finds out for months, because
// nothing anywhere says the two lists were supposed to match.
//
// Registration order matters and is preserved exactly:
//
//   ipcMain  ←  the recorder  ←  the guard  ←  a module
//
// so the permission and scope policy is inside everything the network can
// reach, and the recorder remembers the guarded handler rather than the bare
// one. Auth and Access register through the recorder but NOT the guard: those
// channels are how a person signs in, so they cannot require being signed in.
// They do their own checks — see electron/ipc/auth.js.

const registry = require('./ipc/_registry');
const { guardedIpcMain } = require('./ipc/_guard');

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
const registerSchoolFeesHandlers = require('./ipc/fees_schoolfees');
const registerPaymentDeskHandlers = require('./ipc/payments_desk');
const registerFinanceWorkbookHandlers = require('./ipc/finance_workbook');
const registerOnboardingHandlers = require('./ipc/onboarding');
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

/**
 * Mount every module of the school onto `ipcMain`.
 *
 * Returns the names of any that failed. One module failing to register should
 * cost that module's features, not the whole application — but it is recorded
 * rather than swallowed, so a feature that "does nothing" is traceable.
 *
 * `app` is only ever asked for two things, both of which belong to a machine
 * somebody is sitting at: relaunching after a factory reset, and the Documents
 * folder a save dialog opens in. A server passes a stub.
 */
function registerModules({ ipcMain, db, userDataPath, getResourcePath, app, logger }) {
  const failedModules = [];
  const log = logger || { error: () => {}, warn: () => {}, info: () => {} };

  const recording = registry.recordingIpcMain(ipcMain);
  const guarded = guardedIpcMain(recording, db);

  // Auth is not optional — without it nobody can sign in at all — so unlike
  // every module below it is NOT wrapped in the tolerance. It throws, and each
  // machine decides what that means: the office PC shows the person a failure
  // box, a server writes it and exits so the platform restarts it.
  registerAuthHandlers(recording, db);
  registerAccessHandlers(recording, db);

  const mount = (name, fn) => {
    try { fn(); } catch (e) {
      failedModules.push(name);
      log.error('startup', `Module "${name}" failed to register`, (e && e.stack) || String(e));
    }
  };

  mount('dashboard', () => registerDashboardHandlers(guarded, db));
  mount('students.attendance', () => registerStudentAttendanceHandlers(guarded, db, userDataPath, getResourcePath));
  mount('students.sheet', () => registerStudentsSheetHandlers(guarded, db));
  mount('academics', () => registerAcademicsHandlers(guarded, db));
  mount('fees.extra', () => registerFeesExtraHandlers(guarded, db));
  mount('fees.billing', () => registerFeesBillingHandlers(guarded, db));
  // Raising the term's school fees is one action, so it has one module.
  mount('fees.schoolfees', () => registerSchoolFeesHandlers(guarded, db, require('./ipc/fees')));
  // One counter for every purpose a school takes money for. It dispatches to
  // each module's own recorder rather than reimplementing any of them.
  mount('payments.desk', () => registerPaymentDeskHandlers(guarded, db, {
    fees: require('./ipc/fees'),
    books: require('./ipc/books'),
    canteen: require('./ipc/canteen'),
    transport: require('./ipc/transport'),
  }));
  mount('finance.workbook', () => registerFinanceWorkbookHandlers(guarded, db, app, userDataPath));
  // Bringing a school's existing records onto the system from its own Excel.
  // Governed by the settings permission, not any one module's: one workbook
  // writes pupils, staff, classes, the fee schedule and the school's identity.
  mount('onboarding', () => registerOnboardingHandlers(guarded, db, app, userDataPath));
  mount('canteen.extra', () => registerCanteenExtraHandlers(guarded, db));
  mount('staff.hr', () => registerStaffHrHandlers(guarded, db, userDataPath));
  mount('payroll', () => registerPayrollHandlers(guarded, db));
  mount('mobile.sync', () => registerMobileSyncHandlers(guarded, db));
  mount('fees.discounts', () => registerDiscountsHandlers(guarded, db));
  mount('books', () => registerBooksHandlers(guarded, db));
  mount('fees.bulkPay', () => registerFeesBulkPayHandlers(guarded, db));
  mount('inventory', () => registerInventoryHandlers(guarded, db));
  mount('auditLog', () => registerAuditLogHandlers(guarded, db));
  mount('receiptTemplates', () => registerReceiptTemplatesHandlers(guarded, db, userDataPath, getResourcePath));
  mount('photos', () => registerPhotosHandlers(guarded, db, userDataPath));
  mount('staff.activities', () => registerStaffActivitiesHandlers(guarded, db));
  mount('students', () => registerStudentHandlers(guarded, db, userDataPath));
  mount('staff', () => registerStaffHandlers(guarded, db, userDataPath));
  mount('fees', () => registerFeesHandlers(guarded, db));
  mount('scores', () => registerScoresHandlers(guarded, db));
  mount('canteen', () => registerCanteenHandlers(guarded, db));
  mount('finance', () => registerFinanceHandlers(guarded, db));
  mount('settings', () => registerSettingsHandlers(guarded, db, getResourcePath));
  mount('reports', () => registerReportsHandlers(guarded, db, userDataPath, getResourcePath));
  mount('notifications', () => registerNotificationsHandlers(guarded, db));
  mount('backup', () => registerBackupHandlers(guarded, db, app, userDataPath));
  // Heal absolute upload paths (logo, signatures, photos) the moment the app
  // starts, so a data-folder move from an update — or a restore taken on
  // another PC — never leaves the logo showing broken.
  mount('backup.repair', () => require('./ipc/backup').repairUploadPathsOnStartup(db, userDataPath));
  mount('backup.scheduler', () => require('./ipc/backup').startScheduler(db, userDataPath));
  mount('session', () => registerSessionHandlers(guarded, db));
  mount('mobile', () => registerMobileHandlers(guarded, db));
  mount('payments.intents', () => registerPaymentsIntentsHandlers(guarded, db));
  mount('cloudSync', () => registerCloudSyncHandlers(guarded, db));
  mount('announcements', () => registerAnnouncementsHandlers(guarded, db));
  mount('timetable', () => registerTimetableHandlers(guarded, db));
  mount('transport', () => registerTransportHandlers(guarded, db));
  mount('messaging', () => registerMessagingHandlers(guarded, db));
  mount('homework', () => registerHomeworkHandlers(guarded, db));

  // Stubs LAST — only register channels not already taken. Guarded like the
  // rest: a stub is still a channel, and an unguarded one is a way round the
  // policy for whatever it stands in for.
  mount('stubs', () => registerStubHandlers(guarded, db));
  return { failed: failedModules, recording, guarded };
}

module.exports = { registerModules };
