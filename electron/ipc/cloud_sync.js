// Nickland Edusoft — Cloud sync control (IPC)
// Copyright © 2026 Nickland Sales. All rights reserved.
// Configure + drive the thin-cloud sync from Settings. The desktop stays the
// source of truth; this pushes small projections up and pulls portal changes.

const client = require('../server/sync/client');
const outbox = require('../server/sync/outbox');
const { httpJson } = require('../server/gateways/http');
const { getSetting, setSetting } = require('../utils/idgen');

let timer = null;

// Unreviewed conflicts. Cheap enough to answer on every status poll, and the
// number is the whole point: a school that is never told keeps the mark it does
// not know was disputed.
function conflictCount(db) {
  try {
    return db.prepare('SELECT COUNT(*) AS n FROM sync_conflicts WHERE reviewed_at IS NULL').get().n;
  } catch (_) { return 0; }
}

function startScheduler(db) {
  if (timer) return;
  const tick = async () => {
    try {
      if (client.blockedReason(db)) return;
      await client.syncOnce(db);
    } catch (_) {}
  };
  timer = setInterval(tick, 5 * 60 * 1000); // every 5 minutes
  if (timer.unref) timer.unref();
}

module.exports = function registerCloudSyncHandlers(ipcMain, db) {
  const security = require('./_security');

  if (getSetting(db, 'cloud_sync_enabled', 'false') === 'true') startScheduler(db);

  ipcMain.handle('cloud:status', () => {
    const blocked = client.blockedReason(db);
    return {
      ok: true,
      enabled: getSetting(db, 'cloud_sync_enabled', 'false') === 'true',
      configured: client.configured(db),
      base_url: getSetting(db, 'cloud_base_url', ''),
      school_id: getSetting(db, 'cloud_school_id', ''),
      pending: outbox.pendingCount(db),
      // Records that exhausted their retries. These are invisible failures the
      // operator otherwise has no way to notice.
      stuck: outbox.deadCount(db),
      blocked: blocked,
      blocked_message: blocked === 'insecure_url'
        ? 'The cloud address must start with https:// — the school key and parent credentials travel over this link.'
        : null,
      last_push_at: getSetting(db, 'cloud_last_push_at', '') || null,
      last_pull_at: getSetting(db, 'cloud_last_pull_at', '') || null,
      // Work a teacher did off-LAN that the school's own database had already
      // moved past. The desktop kept its own value; somebody should still be
      // told, or "the mark I entered is not there" becomes a support call with
      // no answer.
      conflicts: conflictCount(db),
    };
  });

  // What the desktop kept, and what it kept it instead of. Read-only: resolving
  // one means opening the mark or the remark and deciding, which is the ordinary
  // screen's job, not a second editor bolted onto the sync page.
  ipcMain.handle('cloud:conflicts', (_e, { limit = 100, includeReviewed = false } = {}) => {
    if (!security.checkPermission(db, 'settings', 'view')) return { ok: false, error: 'Access denied.' };
    try {
      const rows = db.prepare(`
        SELECT c.*, s.index_number, TRIM(s.surname || ' ' || s.first_name) AS student_name,
               sub.name AS subject_name, u.full_name AS user_name
          FROM sync_conflicts c
          LEFT JOIN students s ON s.id = c.student_id
          LEFT JOIN subjects sub ON sub.id = c.subject_id
          LEFT JOIN users u ON u.id = c.user_id
         WHERE (? = 1 OR c.reviewed_at IS NULL)
         ORDER BY c.created_at DESC, c.id DESC
         LIMIT ?
      `).all(includeReviewed ? 1 : 0, Math.max(1, Math.min(500, limit)));
      return { ok: true, conflicts: rows, open: conflictCount(db) };
    } catch (_) { return { ok: true, conflicts: [], open: 0 }; }
  });

  // Marking one seen is not the same as changing anything: the mark stays what
  // the school says it is. This only takes it off the list.
  ipcMain.handle('cloud:conflict-reviewed', (_e, { id } = {}) => {
    if (!security.checkPermission(db, 'settings', 'edit')) return { ok: false, error: 'Access denied.' };
    try {
      db.prepare('UPDATE sync_conflicts SET reviewed_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
      return { ok: true, open: conflictCount(db) };
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });

  ipcMain.handle('cloud:configure', (_e, patch) => {
    if (!security.checkPermission(db, 'settings', 'edit')) return { ok: false, error: 'Access denied.' };
    const map = { enabled: 'cloud_sync_enabled', baseUrl: 'cloud_base_url', apiKey: 'school_api_key', schoolId: 'cloud_school_id' };
    for (const [k, key] of Object.entries(map)) {
      if (patch[k] !== undefined) setSetting(db, key, patch[k], 'cloud');
    }
    const base = getSetting(db, 'cloud_base_url', '');
    if (base && client.insecureBase(base)) {
      setSetting(db, 'cloud_sync_enabled', false, 'cloud');
      return { ok: false, error: 'The cloud address must start with https://. Sync has been switched off.' };
    }

    let backfilled = null;
    if (getSetting(db, 'cloud_sync_enabled', 'false') === 'true') {
      startScheduler(db);
      // First time this school is connected, seed the portal with the data it
      // already has. Otherwise the school's page stays empty until individual
      // records happen to change, and no parent can sign in.
      if (!getSetting(db, 'cloud_backfilled_at', '')) {
        const r = outbox.backfillAll(db);
        if (r.ok) {
          setSetting(db, 'cloud_backfilled_at', new Date().toISOString(), 'cloud');
          backfilled = r.counts;
        }
      }
    }
    return { ok: true, backfilled };
  });

  // Re-project everything on demand — after importing a class list, or if the
  // portal ever looks out of step with the desktop.
  ipcMain.handle('cloud:backfill', () => {
    if (!security.checkPermission(db, 'settings', 'edit')) return { ok: false, error: 'Access denied.' };
    const r = outbox.backfillAll(db);
    if (r.ok) setSetting(db, 'cloud_backfilled_at', new Date().toISOString(), 'cloud');
    return r;
  });

  ipcMain.handle('cloud:push-now', async () => {
    if (!security.checkPermission(db, 'settings', 'edit')) return { ok: false, error: 'Access denied.' };
    // An explicit push is also the operator's "try again": clear any backoff and
    // un-park records that gave up, so a fixed cause takes effect immediately.
    outbox.retryAll(db);
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
