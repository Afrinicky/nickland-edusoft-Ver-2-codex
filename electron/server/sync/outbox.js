// Nickland Edusoft — Cloud sync outbox
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Records the small "thin-cloud" projections that get pushed to the portal.
// The local SQLite remains the source of truth; these are overwrite-on-sync
// read snapshots + link rows, not the full dataset. Enqueue is a no-op when
// cloud sync is disabled, so it costs nothing for offline-only schools.

const crypto = require('crypto');
const { getSetting } = require('../../utils/idgen');

function syncEnabled(db) {
  return getSetting(db, 'cloud_sync_enabled', 'false') === 'true';
}

// Append an outbox record. Collapses an un-synced duplicate of the same
// (entity_type, entity_key) so repeated balance changes don't pile up — the
// cloud only wants the latest snapshot.
function postToOutbox(db, { entity_type, entity_key, op = 'upsert', payload }) {
  if (!syncEnabled(db)) return null;
  try {
    const uuid = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
    const json = payload == null ? null : JSON.stringify(payload);
    if (entity_key) {
      const existing = db.prepare(
        'SELECT id, version FROM sync_outbox WHERE entity_type = ? AND entity_key = ? AND synced_at IS NULL ORDER BY id DESC LIMIT 1'
      ).get(entity_type, String(entity_key));
      if (existing) {
        db.prepare('UPDATE sync_outbox SET payload_json = ?, op = ?, version = version + 1, uuid = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(json, op, uuid, existing.id);
        return existing.id;
      }
    }
    const r = db.prepare(`
      INSERT INTO sync_outbox (uuid, entity_type, entity_key, op, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(uuid, entity_type, entity_key != null ? String(entity_key) : null, op, json);
    return r.lastInsertRowid;
  } catch (_) { return null; }
}

function listUnsynced(db, limit = 100) {
  return db.prepare('SELECT * FROM sync_outbox WHERE synced_at IS NULL ORDER BY id ASC LIMIT ?').all(limit);
}

function markSynced(db, ids) {
  if (!ids || !ids.length) return;
  const stmt = db.prepare("UPDATE sync_outbox SET synced_at = datetime('now'), last_error = NULL WHERE id = ?");
  const tx = db.transaction(() => { for (const id of ids) stmt.run(id); });
  tx();
}

function markFailed(db, ids, err) {
  if (!ids || !ids.length) return;
  const stmt = db.prepare('UPDATE sync_outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?');
  const tx = db.transaction(() => { for (const id of ids) stmt.run(String(err || 'error').slice(0, 300), id); });
  tx();
}

function pendingCount(db) {
  try { return db.prepare('SELECT COUNT(*) c FROM sync_outbox WHERE synced_at IS NULL').get().c; }
  catch (_) { return 0; }
}

// Build + enqueue the thin snapshot for one student (current balances). This is
// the read model the parent portal serves when the desktop is offline.
function enqueueStudentSnapshot(db, studentId) {
  if (!syncEnabled(db)) return null;
  try {
    const s = db.prepare(`
      SELECT s.id, s.index_number, s.surname, s.first_name, s.other_names, c.name AS class_name
      FROM students s LEFT JOIN class_groups c ON c.id = s.current_class_id WHERE s.id = ?
    `).get(studentId);
    if (!s) return null;
    const term = db.prepare('SELECT id, label FROM terms WHERE is_current = 1').get();
    const bill = term ? db.prepare('SELECT total_billed, total_paid, balance FROM student_bills WHERE student_id = ? AND term_id = ?').get(studentId, term.id) : null;
    const rate = parseFloat(getSetting(db, 'canteen_daily_rate', '5'));
    const canteenUnpaid = term ? db.prepare(`
      SELECT COUNT(*) c FROM school_calendar sc
      LEFT JOIN canteen_day_status cds ON cds.date = sc.date AND cds.student_id = ?
      WHERE sc.term_id = ? AND sc.day_type = 'school_day' AND (cds.status IS NULL OR cds.status = 'unpaid')
    `).get(studentId, term.id).c : 0;
    return postToOutbox(db, {
      entity_type: 'student_snapshot',
      entity_key: `student:${studentId}`,
      payload: {
        student_id: studentId,
        index_number: s.index_number,
        name: `${s.surname} ${s.first_name} ${s.other_names || ''}`.trim(),
        class_name: s.class_name,
        term: term ? term.label : null,
        fees: { billed: bill?.total_billed || 0, paid: bill?.total_paid || 0, balance: bill?.balance || 0 },
        canteen: { unpaid_days: canteenUnpaid, amount_owed: canteenUnpaid * rate },
        updated_at: new Date().toISOString(),
      },
    });
  } catch (_) { return null; }
}

module.exports = {
  syncEnabled, postToOutbox, listUnsynced, markSynced, markFailed, pendingCount, enqueueStudentSnapshot,
};
