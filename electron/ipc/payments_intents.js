// Nickland Edusoft — Mobile payment intents (desktop review)
// Copyright © 2026 Nickland Sales. All rights reserved.
// The accounts office reviews payments parents submit from the app and either
// acknowledges them (records the payment + sends the receipt) or rejects them.

const service = require('../server/payments_service');

module.exports = function registerPaymentsIntentsHandlers(ipcMain, db) {
  const security = require('./_security');

  ipcMain.handle('payments:list-intents', (_e, status = 'pending') => {
    return { ok: true, intents: service.listIntents(db, status) };
  });

  ipcMain.handle('payments:pending-count', () => {
    return db.prepare("SELECT COUNT(*) c FROM payment_intents WHERE status = 'pending'").get().c;
  });

  ipcMain.handle('payments:acknowledge-intent', (_e, { intentId, method }) => {
    if (!security.checkPermission(db, 'fees', 'edit')) {
      return { ok: false, error: 'Access denied. You do not have permission to record fee payments.' };
    }
    return service.acknowledgeIntent(db, intentId, { actorUserId: security.getCurrentUserId(), method });
  });

  ipcMain.handle('payments:reject-intent', (_e, { intentId, reason }) => {
    if (!security.checkPermission(db, 'fees', 'edit')) {
      return { ok: false, error: 'Access denied.' };
    }
    return service.rejectIntent(db, intentId, { actorUserId: security.getCurrentUserId(), reason });
  });
};
