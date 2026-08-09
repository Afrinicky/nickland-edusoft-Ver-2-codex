// Nickland Edusoft — Cloud sync control (IPC)
// Copyright © 2026 Nickland Sales. All rights reserved.
// Configure + drive the thin-cloud sync from Settings. The desktop stays the
// source of truth; this pushes small projections up and pulls portal changes.

const client = require('../server/sync/client');
const outbox = require('../server/sync/outbox');
const { httpJson } = require('../server/gateways/http');
const { getSetting } = require('../utils/idgen');

let timer = null;

function startScheduler(db) {
  if (timer) return;
  const tick = async () => {
    try { if (getSetting(db, 'cloud_sync_enabled', 'false') === 'true' && client.configured(db)) await client.syncOnce(db); }
    catch (_) {}
  };
  timer = setInterval(tick, 5 * 60 * 1000); // every 5 minutes
  if (timer.unref) timer.unref();
}

module.exports = function registerCloudSyncHandlers(ipcMain, db) {
  const security = require('./_security');

  if (getSetting(db, 'cloud_sync_enabled', 'false') === 'true') startScheduler(db);

  ipcMain.handle('cloud:status', () => ({
    ok: true,
    enabled: getSetting(db, 'cloud_sync_enabled', 'false') === 'true',
    configured: client.configured(db),
    base_url: getSetting(db, 'cloud_base_url', ''),
    school_id: getSetting(db, 'cloud_school_id', ''),
    pending: outbox.pendingCount(db),
    last_push_at: getSetting(db, 'cloud_last_push_at', '') || null,
    last_pull_at: getSetting(db, 'cloud_last_pull_at', '') || null,
  }));

  ipcMain.handle('cloud:configure', (_e, patch) => {
    if (!security.checkPermission(db, 'settings', 'edit')) return { ok: false, error: 'Access denied.' };
    const map = { enabled: 'cloud_sync_enabled', baseUrl: 'cloud_base_url', apiKey: 'school_api_key', schoolId: 'cloud_school_id' };
    const up = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
    for (const [k, key] of Object.entries(map)) {
      if (patch[k] !== undefined) up.run(typeof patch[k] === 'boolean' ? (patch[k] ? 'true' : 'false') : String(patch[k]), key);
    }
    if (getSetting(db, 'cloud_sync_enabled', 'false') === 'true') startScheduler(db);
    return { ok: true };
  });

  ipcMain.handle('cloud:push-now', async () => {
    if (!security.checkPermission(db, 'settings', 'edit')) return { ok: false, error: 'Access denied.' };
    return await client.push(db);
  });

  ipcMain.handle('cloud:pull-now', async () => {
    if (!security.checkPermission(db, 'settings', 'edit')) return { ok: false, error: 'Access denied.' };
    return await client.pull(db);
  });

  ipcMain.handle('cloud:test', async () => {
    const base = (getSetting(db, 'cloud_base_url', '') || '').replace(/\/+$/, '');
    const key = getSetting(db, 'school_api_key', '');
    if (!base || !key) return { ok: false, error: 'Set the cloud URL and school key first.' };
    const res = await httpJson(`${base}/api/v1/sync/ping`, { headers: { 'x-school-key': key } });
    if (res.status >= 200 && res.status < 300 && res.json && res.json.ok) return { ok: true, school: res.json.school || null };
    return { ok: false, error: (res.json && res.json.error) || res.error || `Could not reach the cloud (${res.status}).` };
  });
};

module.exports.startScheduler = startScheduler;
