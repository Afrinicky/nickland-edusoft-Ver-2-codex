// Nickland Edusoft — Mobile API host control (IPC)
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Starts/stops the embedded mobile API server and manages parent accounts and
// paired device tokens from Settings → Mobile App. The desktop stays the host;
// this just governs the LAN-facing API.

const os = require('os');
const { createApiServer } = require('../server/api');
const webapp = require('../server/webapp');
const tokens = require('../server/tokens');
const parents = require('../server/parents');
const { getSetting, setSetting } = require('../utils/idgen');
const logger = require('../utils/logger');

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
  if (serverInstance) return Promise.resolve({ ok: true, already: true, port: serverPort });
  const port = parseInt(getSetting(db, 'mobile_server_port', '4747'), 10) || 4747;
  const bind = getSetting(db, 'mobile_server_bind', 'lan') === 'localhost' ? '127.0.0.1' : '0.0.0.0';
  serverError = null;
  try {
    const srv = createApiServer(db);
    return new Promise((resolve) => {
      srv.once('error', (e) => {
        // A half-open server holds the port; close it or the next attempt on
        // this port fails too, and the operator sees "address in use" forever.
        try { srv.close(); } catch (_) {}
        serverError = e.code === 'EADDRINUSE'
          ? `Port ${port} is already in use. Choose a different port in Settings → Mobile App.`
          : e.message;
        serverInstance = null;
        resolve({ ok: false, error: serverError });
      });
      srv.listen(port, bind, () => {
        serverInstance = srv; serverPort = port;
        resolve({ ok: true, port, addresses: lanAddresses() });
      });
    });
  } catch (e) { serverError = e.message; return Promise.resolve({ ok: false, error: e.message }); }
}

// Resolves only once the listening socket is really closed. Returning before
// that made a port change fail with EADDRINUSE, because the restart tried to
// bind while the old socket was still shutting down.
function stopServer() {
  const srv = serverInstance;
  serverInstance = null; serverPort = null;
  if (!srv) return Promise.resolve({ ok: true, stopped: false });
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve({ ok: true, stopped: true }); } };
    try {
      srv.close(finish);
      // close() waits for in-flight connections; don't hang the UI on one.
      const t = setTimeout(finish, 3000);
      if (t.unref) t.unref();
    } catch (_) { finish(); }
  });
}

module.exports = function registerMobileHandlers(ipcMain, db) {
  const security = require('./_security');

  // Auto-start on boot if enabled.
  if (getSetting(db, 'mobile_server_enabled', 'false') === 'true') {
    startServer(db).then((res) => {
      if (res.ok) logger.info('mobile', `Mobile API listening on port ${res.port}`);
      // A silent failure here is why "the mobile app can't connect" was so hard
      // to diagnose — the toggle still read as ON with nothing listening.
      else logger.warn('mobile', 'Mobile API failed to start', res.error);
    }).catch((e) => logger.warn('mobile', 'Mobile API failed to start', (e && e.message) || String(e)));
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
    // Whether staff and parents can also just open the address in a browser,
    // rather than installing the app. Settings → Mobile App says so either way,
    // because "type this into Chrome" is the fastest way to get a teacher on.
    web_app: webapp.isAvailable(),
  }));

  ipcMain.handle('mobile:start', async () => {
    if (!security.checkPermission(db, 'settings', 'edit')) return { ok: false, error: 'Access denied.' };
    const res = await startServer(db);
    // Only remember "enabled" if it actually came up, so a failed start does
    // not leave the app trying (and failing) to bind on every launch.
    setSetting(db, 'mobile_server_enabled', !!res.ok, 'mobile');
    return res;
  });

  ipcMain.handle('mobile:stop', async () => {
    if (!security.checkPermission(db, 'settings', 'edit')) return { ok: false, error: 'Access denied.' };
    setSetting(db, 'mobile_server_enabled', false, 'mobile');
    return await stopServer();
  });

  ipcMain.handle('mobile:set-config', async (_e, { port, bind, selfRegister }) => {
    if (!security.checkPermission(db, 'settings', 'edit')) return { ok: false, error: 'Access denied.' };
    if (port !== undefined) {
      const p = parseInt(port, 10);
      if (!Number.isInteger(p) || p < 1024 || p > 65535) {
        return { ok: false, error: 'Port must be a number between 1024 and 65535.' };
      }
      setSetting(db, 'mobile_server_port', p, 'mobile');
    }
    if (bind !== undefined) {
      if (!['lan', 'localhost'].includes(bind)) return { ok: false, error: 'Bind must be "lan" or "localhost".' };
      setSetting(db, 'mobile_server_bind', bind, 'mobile');
    }
    if (selfRegister !== undefined) setSetting(db, 'mobile_parent_self_register', !!selfRegister, 'mobile');
    // Restart if running so new port/bind take effect. The stop must complete
    // before the new bind, or the restart fails with the port still in use.
    if (serverInstance) {
      await stopServer();
      return await startServer(db);
    }
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
    try { parents.enqueueParentAuth(db, parentId); } catch (_) {}
    return { ok: true };
  });

  // ── Matching helper: suggest students for a phone/email before provisioning ──
  ipcMain.handle('mobile:match-students', (_e, { phone, email }) => ({
    ok: true, matches: parents.matchStudentsByContact(db, { phone, email }),
  }));
};
