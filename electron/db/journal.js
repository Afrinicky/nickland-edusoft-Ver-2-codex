// Nickland Edusoft — reading the transaction journal.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The triggers in db/sync_schema.js write the journal. This reads it, and it is
// deliberately the ONLY module that is allowed to mark or remove an entry:
// append-only is a property somebody has to keep, and keeping it in one file
// is how it stays kept.
//
// What the sync client needs from a journal, and why each matters:
//
//   pending()      what this machine has not yet handed to the cloud, oldest
//                  first. Order is the point — a payment cannot be applied
//                  before the pupil it is against exists.
//   markPushed()   an acknowledgement, by entry id, for exactly the entries
//                  the cloud confirmed. NOT "everything up to here": a partial
//                  acceptance is the normal case on a bad connection, and
//                  advancing past an entry the cloud did not take is how a
//                  morning's work disappears.
//   prune()        entries both acknowledged AND aged out. Both, for the
//                  reason the cloud's own queue keeps ninety days: a machine
//                  restored from a backup comes back with an older cursor, and
//                  a journal trimmed to the last receipt has nothing left to
//                  give it.

const crypto = require('crypto');
const { isFinancial } = require('./sync_tables');

// How far behind a machine is allowed to get before the sync screen stops
// saying "catching up" and starts saying something is wrong.
const BACKLOG_WARN = 5000;

// Entries kept after acknowledgement. See prune().
const RETAIN_DAYS = 90;

/** Everything this machine still owes the cloud, oldest first. */
function pending(db, limit = 500) {
  try {
    return db.prepare(`
      SELECT seq, entry_uid, record_uid, table_name, op,
             before_json, after_json, device_id, user_id, txn_id, source,
             idempotency_key, happened_at
        FROM sync_journal
       WHERE pushed_at IS NULL
       ORDER BY seq ASC
       LIMIT ?
    `).all(Math.max(1, Math.min(5000, limit)));
  } catch (_) { return []; }
}

function pendingCount(db) {
  try { return db.prepare('SELECT COUNT(*) c FROM sync_journal WHERE pushed_at IS NULL').get().c; }
  catch (_) { return 0; }
}

/**
 * Acknowledge entries the cloud has confirmed, by their own ids.
 *
 * By id and not by sequence number, deliberately. The cloud accepts a batch
 * entry by entry — one may be deferred because a record it depends on has not
 * arrived yet — so "accepted everything below seq N" is a claim that is often
 * false. Marking exactly what was accepted leaves the rest pending, which is
 * what resumability means.
 */
function markPushed(db, entryUids = []) {
  if (!entryUids.length) return 0;
  const stmt = db.prepare("UPDATE sync_journal SET pushed_at = datetime('now') WHERE entry_uid = ? AND pushed_at IS NULL");
  let n = 0;
  const tx = db.transaction(() => { for (const uid of entryUids) n += stmt.run(uid).changes; });
  tx();
  return n;
}

/**
 * Drop entries that are both acknowledged and older than the retention window.
 *
 * Append-only does not mean kept forever — it means never rewritten. An entry
 * the cloud has had for three months is history the cloud now holds.
 */
function prune(db, days = RETAIN_DAYS) {
  try {
    const r = db.prepare(`
      DELETE FROM sync_journal
       WHERE pushed_at IS NOT NULL
         AND happened_at < datetime('now', ?)
    `).run(`-${Math.max(1, days)} days`);
    return r.changes || 0;
  } catch (_) { return 0; }
}

/** Everything the journal knows about one record, oldest first — the answer to
 *  "who changed this mark, and when, and from which machine". */
function history(db, recordUid, limit = 100) {
  try {
    return db.prepare(`
      SELECT seq, op, before_json, after_json, device_id, user_id, source, happened_at
        FROM sync_journal WHERE record_uid = ? ORDER BY seq ASC LIMIT ?
    `).all(recordUid, limit);
  } catch (_) { return []; }
}

// ── Idempotency ─────────────────────────────────────────────────────────────
//
// The key is DERIVED, not random, and that is the whole mechanism: the same
// logical act computes the same key on every machine and every replay, so the
// unique index on the cloud side refuses the second copy without having to
// recognise it as a duplicate.
//
// Random keys would be useless here — a replayed batch would carry a new one
// and the payment would be taken twice.
function idempotencyKey({ deviceId, table, recordUid, op, amount = null }) {
  const material = [deviceId || 'unknown', table, recordUid, op, amount == null ? '' : String(amount)].join('|');
  return crypto.createHash('sha256').update(material).digest('hex').slice(0, 40);
}

/**
 * Stamp idempotency keys onto the financial entries that do not have one.
 *
 * Run as part of a push rather than in the trigger, because SQLite triggers
 * have no SHA-256 and a key computed from a weaker hash in SQL would be a
 * different key on the two sides of the sync. The entries are append-only in
 * every respect that matters — the key is metadata about the entry, derived
 * from the entry's own immutable contents, not a change to what it records.
 */
function stampFinancialKeys(db) {
  let n = 0;
  try {
    const rows = db.prepare(`
      SELECT seq, entry_uid, record_uid, table_name, op, device_id, after_json
        FROM sync_journal
       WHERE idempotency_key IS NULL AND pushed_at IS NULL
    `).all();
    const upd = db.prepare('UPDATE sync_journal SET idempotency_key = ? WHERE seq = ?');
    const tx = db.transaction(() => {
      for (const r of rows) {
        if (!isFinancial(r.table_name)) continue;
        let amount = null;
        try {
          const after = r.after_json ? JSON.parse(r.after_json) : null;
          if (after) amount = after.amount ?? after.total_billed ?? after.net_salary ?? null;
        } catch (_) { /* an entry with unreadable json still gets a key */ }
        upd.run(idempotencyKey({
          deviceId: r.device_id, table: r.table_name, recordUid: r.record_uid, op: r.op, amount,
        }), r.seq);
        n++;
      }
    });
    tx();
  } catch (_) { /* a missing key is caught by the cloud's own unique index */ }
  return n;
}

/** What the sync screen shows. */
function status(db) {
  const pendingN = pendingCount(db);
  let oldest = null;
  try {
    const row = db.prepare("SELECT happened_at FROM sync_journal WHERE pushed_at IS NULL ORDER BY seq ASC LIMIT 1").get();
    oldest = row ? row.happened_at : null;
  } catch (_) {}
  return {
    pending: pendingN,
    oldest_pending_at: oldest,
    backlog_warning: pendingN >= BACKLOG_WARN,
  };
}

module.exports = {
  pending, pendingCount, markPushed, prune, history,
  idempotencyKey, stampFinancialKeys, status,
  BACKLOG_WARN, RETAIN_DAYS,
};
