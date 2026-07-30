// Nickland Edusoft — Mobile API host control (IPC)
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Starts/stops the embedded mobile API server and manages parent accounts and
// paired device tokens from Settings → Mobile App. The desktop stays the host;
// this just governs the LAN-facing API.

const os = require('os');
const { createApiServer } = require('../server/api');
const tokens = require('../server/tokens');
const parents = require('../server/parents');
const { getSetting } = require('../utils/idgen');

let serverInstance = null;
let serverPort = null;
let serverError = null;

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

function startServer(db) {
  if (serverInstance) return { ok: true, already: true, port: serverPort };
  const port = parseInt(getSetting(db, 'mobile_server_port', '4747'), 10) || 4747;
  const bind = getSetting(db, 'mobile_server_bind', 'lan') === 'localhost' ? '127.0.0.1' : '0.0.0.0';
  serverError = null;
  try {
    const srv = createApiServer(db);
    return new Promise((resolve) => {
      srv.once('error', (e) => { serverError = e.message; serverInstance = null; resolve({ ok: false, error: e.message }); });
      srv.listen(port, bind, () => {
        serverInstance = srv; serverPort = port;
        resolve({ ok: true, port, addresses: lanAddresses() });
      });
    });
  } catch (e) { serverError = e.message; return { ok: false, error: e.message }; }
}

function stopServer() {
  if (!serverInstance) return { ok: true, stopped: false };
  try { serverInstance.close(); } catch (_) {}
  serverInstance = null; serverPort = null;
  return { ok: true, stopped: true };
}

module.exports = function registerMobileHandlers(ipcMain, db) {
  const security = require('./_security');

  // Auto-start on boot if enabled.
  if (getSetting(db, 'mobile_server_enabled', 'false') === 'true') {
    Promise.resolve(startServer(db)).catch(() => {});
  }

  ipcMain.handle('mobile:status', () => ({
    ok: true,
    running: !!serverInstance,
    port: serverPort || parseInt(getSetting(db, 'mobile_server_port', '4747'), 10),
    bind: getSetting(db, 'mobile_server_bind', 'lan'),
    enabled: getSetting(db, 'mobile_server_enabled', 'false') === 'true',
    self_register: getSetting(db, 'mobile_parent_self_register', 'true') === 'true',
    addresses: lanAddresses(),
    error: serverError,
    device_count: db.prepare('SELECT COUNT(*) c FROM api_tokens WHERE revoked = 0').get().c,
    parent_count: db.prepare('SELECT COUNT(*) c FROM parents').get().c,
  }));

  ipcMain.handle('mobile:start', async () => {
    if (!security.checkPermission(db, 'settings', 'edit')) return { ok: false, error: 'Access denied.' };
    db.prepare("UPDATE settings SET value = 'true' WHERE key = 'mobile_server_enabled'").run();
    return await startServer(db);
  });

  ipcMain.handle('mobile:stop', () => {
    if (!security.checkPermission(db, 'settings', 'edit')) return { ok: false, error: 'Access denied.' };
    db.prepare("UPDATE settings SET value = 'false' WHERE key = 'mobile_server_enabled'").run();
    return stopServer();
  });

  ipcMain.handle('mobile:set-config', (_e, { port, bind, selfRegister }) => {
    if (!security.checkPermission(db, 'settings', 'edit')) return { ok: false, error: 'Access denied.' };
    if (port) db.prepare("UPDATE settings SET value = ? WHERE key = 'mobile_server_port'").run(String(port));
    if (bind) db.prepare("UPDATE settings SET value = ? WHERE key = 'mobile_server_bind'").run(bind);
    if (selfRegister !== undefined) db.prepare("UPDATE settings SET value = ? WHERE key = 'mobile_parent_self_register'").run(selfRegister ? 'true' : 'false');
    // Restart if running so new port/bind take effect.
    if (serverInstance) { stopServer(); return startServer(db); }
    return { ok: true };
  });

  // ── Devices ──
  ipcMain.handle('mobile:list-devices', () => ({ ok: true, devices: tokens.listDevices(db) }));
  ipcMain.handle('mobile:revoke-device', (_e, id) => {
    if (!security.checkPermission(db, 'settings', 'edit')) return { ok: false, error: 'Access denied.' };
    return tokens.revokeToken(db, id);
  });

  // ── Parents ──
  ipcMain.handle('mobile:list-parents', () => ({ ok: true, parents: parents.listParents(db) }));
  ipcMain.handle('mobile:create-parent', (_e, data) => {
    if (!security.checkPermission(db, 'students', 'edit')) return { ok: false, error: 'Access denied.' };
    return parents.provisionParent(db, { ...data, createdBy: security.getCurrentUserId() });
  });
  ipcMain.handle('mobile:reset-parent', (_e, { parentId, newPassword }) => {
    if (!security.checkPermission(db, 'students', 'edit')) return { ok: false, error: 'Access denied.' };
    return parents.setParentPassword(db, parentId, newPassword);
  });
  ipcMain.handle('mobile:revoke-parent', (_e, parentId) => {
    if (!security.checkPermission(db, 'students', 'edit')) return { ok: false, error: 'Access denied.' };
    db.prepare('UPDATE parents SET is_active = 0 WHERE id = ?').run(parentId);
    tokens.revokeAllForSubject(db, 'parent', parentId);
    return { ok: true };
  });

  // ── Matching helper: suggest students for a phone/email before provisioning ──
  ipcMain.handle('mobile:match-students', (_e, { phone, email }) => ({
    ok: true, matches: parents.matchStudentsByContact(db, { phone, email }),
  }));
};
