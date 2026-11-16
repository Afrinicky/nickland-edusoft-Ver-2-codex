// Nickland Edusoft — telling the journal who is writing.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The journalling triggers (db/sync_schema.js) stamp a device and a user onto
// every entry, because "who changed this pupil's mark, from which machine" is
// the question the brief asks the audit trail to answer once work can happen
// in three places at once.
//
// A SQLite trigger cannot read a session variable — SQLite has no such thing —
// so the acting identity is parked in a one-row table and the triggers read it
// back. This module owns that row.
//
// ── Where it is stamped, and why only there ─────────────────────────────────
//
// Two places, both of which already establish identity for the permission
// check and the audit log, so neither is a new concept:
//
//   ipc/_guard.js        every one of the 408 IPC channels passes through it
//   server/api.js        the LAN dispatcher, for every authenticated request
//
// Stamping at the write sites instead would be 1,736 opportunities to forget.
// Stamping here means a handler that knows nothing about the journal still
// produces correctly attributed entries.
//
// ── What happens when nothing is stamped ────────────────────────────────────
//
// The entry records no user. That is deliberate and it is the honest answer: a
// migration, the licence refresh, a backup restore and the nightly sync are
// not people. An entry claiming they were somebody would be worse than one
// admitting it was the system.

const { uuidv7 } = require('../utils/uid');

// This installation's own identity, generated once and then never changed.
// Cached per database handle because the triggers read it on every single
// write and a query per write would be a tax on everything.
const deviceCache = new WeakMap();

function deviceId(db, { kind = 'desktop', label = null } = {}) {
  if (deviceCache.has(db)) return deviceCache.get(db);
  let id = null;
  try {
    const row = db.prepare('SELECT device_id FROM sync_device WHERE id = 1').get();
    if (row && row.device_id) {
      id = row.device_id;
    } else {
      id = uuidv7();
      db.prepare(`INSERT OR REPLACE INTO sync_device (id, device_id, label, kind)
                  VALUES (1, ?, ?, ?)`).run(id, label, kind);
    }
  } catch (_) {
    // A database that predates the migration, or one opened read-only. The
    // journal still records what changed; it just cannot say from where.
    id = null;
  }
  if (id) deviceCache.set(db, id);
  return id;
}

/**
 * Say who is writing, for the entries the next statements produce.
 *
 * Cheap on purpose: one UPSERT of one row, called once per request rather than
 * once per write. Never throws — a failure to stamp must not fail the work
 * being stamped, and an unattributed entry is recoverable where a refused
 * payment is not.
 */
function stamp(db, { userId = null, source = null, txnId = null } = {}) {
  try {
    db.prepare(`
      INSERT INTO sync_context (id, device_id, user_id, txn_id, source)
      VALUES (1, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        device_id = excluded.device_id,
        user_id   = excluded.user_id,
        txn_id    = excluded.txn_id,
        source    = excluded.source
    `).run(deviceId(db), userId == null ? null : Number(userId), txnId, source);
    return true;
  } catch (_) { return false; }
}

/** Forget who was writing. Used after a request so a background task does not
 *  inherit the last person's name. */
function clear(db) {
  try {
    db.prepare(`UPDATE sync_context SET user_id = NULL, txn_id = NULL, source = NULL WHERE id = 1`).run();
    return true;
  } catch (_) { return false; }
}

function current(db) {
  try { return db.prepare('SELECT * FROM sync_context WHERE id = 1').get() || null; }
  catch (_) { return null; }
}

module.exports = { stamp, clear, current, deviceId };
