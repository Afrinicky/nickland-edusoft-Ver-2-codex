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

// Retry policy for records the cloud would not accept. Without this a record
// that can never succeed was re-sent on every 5-minute tick forever.
const MAX_ATTEMPTS = 12;                       // then park it as dead
const BACKOFF_SECONDS = [60, 300, 900, 3600, 10800, 21600];  // 1m → 6h, then 6h

function backoffSeconds(attempts) {
  return BACKOFF_SECONDS[Math.min(attempts, BACKOFF_SECONDS.length - 1)];
}

// Allocate the next version for an entity. Versions must increase monotonically
// FOREVER per entity_key: both cloud stores drop an incoming snapshot whose
// version is not greater than the stored one, so a version that restarts at 1
// on each new outbox row silently froze the parent portal on stale data. The
// counter lives in its own table so pruning synced rows can't reset it.
function nextVersion(db, entityKey) {
  if (entityKey == null) return 1;
  const key = String(entityKey);
  const row = db.prepare('SELECT version FROM sync_versions WHERE entity_key = ?').get(key);
  // No counter yet (fresh entity, or an install upgrading mid-flight): start
  // above anything this entity has already published from the outbox history.
  const base = row
    ? row.version
    : (db.prepare('SELECT COALESCE(MAX(version), 0) v FROM sync_outbox WHERE entity_key = ?').get(key).v || 0);
  const next = base + 1;
  db.prepare(`
    INSERT INTO sync_versions (entity_key, version, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (entity_key) DO UPDATE SET version = excluded.version, updated_at = CURRENT_TIMESTAMP
  `).run(key, next);
  return next;
}

// Append an outbox record. Collapses an un-synced duplicate of the same
// (entity_type, entity_key) so repeated balance changes don't pile up — the
// cloud only wants the latest snapshot.
function postToOutbox(db, { entity_type, entity_key, op = 'upsert', payload }) {
  if (!syncEnabled(db)) return null;
  try {
    const uuid = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
    const json = payload == null ? null : JSON.stringify(payload);
    const version = nextVersion(db, entity_key);
    if (entity_key) {
      const existing = db.prepare(
        'SELECT id FROM sync_outbox WHERE entity_type = ? AND entity_key = ? AND synced_at IS NULL AND dead = 0 ORDER BY id DESC LIMIT 1'
      ).get(entity_type, String(entity_key));
      if (existing) {
        // Replace the queued payload and re-arm it for an immediate attempt.
        db.prepare(`
          UPDATE sync_outbox
             SET payload_json = ?, op = ?, version = ?, uuid = ?,
                 created_at = CURRENT_TIMESTAMP, attempts = 0, next_attempt_at = NULL
           WHERE id = ?
        `).run(json, op, version, uuid, existing.id);
        return existing.id;
      }
    }
    const r = db.prepare(`
      INSERT INTO sync_outbox (uuid, entity_type, entity_key, op, payload_json, version)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uuid, entity_type, entity_key != null ? String(entity_key) : null, op, json, version);
    return r.lastInsertRowid;
  } catch (_) { return null; }
}

// Records that are due for a push attempt: never synced, not parked, and past
// their backoff window.
function listUnsynced(db, limit = 100) {
  return db.prepare(`
    SELECT * FROM sync_outbox
     WHERE synced_at IS NULL AND COALESCE(dead, 0) = 0
       AND (next_attempt_at IS NULL OR next_attempt_at <= datetime('now'))
     ORDER BY id ASC LIMIT ?
  `).all(limit);
}

function markSynced(db, ids) {
  if (!ids || !ids.length) return;
  const stmt = db.prepare("UPDATE sync_outbox SET synced_at = datetime('now'), last_error = NULL, next_attempt_at = NULL WHERE id = ?");
  const tx = db.transaction(() => { for (const id of ids) stmt.run(id); });
  tx();
}

// Record a failed attempt and schedule the next one. A record that has failed
// MAX_ATTEMPTS times is parked (dead = 1) so it stops blocking the queue and
// stops generating traffic; it stays in the table for inspection.
function markFailed(db, ids, err) {
  if (!ids || !ids.length) return;
  const msg = String(err || 'error').slice(0, 300);
  const stmt = db.prepare(`
    UPDATE sync_outbox
       SET attempts = attempts + 1,
           last_error = ?,
           next_attempt_at = datetime('now', '+' || ? || ' seconds'),
           dead = CASE WHEN attempts + 1 >= ? THEN 1 ELSE 0 END
     WHERE id = ?
  `);
  const read = db.prepare('SELECT attempts FROM sync_outbox WHERE id = ?');
  const tx = db.transaction(() => {
    for (const id of ids) {
      const row = read.get(id);
      stmt.run(msg, backoffSeconds(row ? row.attempts : 0), MAX_ATTEMPTS, id);
    }
  });
  tx();
}

// Un-park every dead record and clear backoff — used by an explicit "Push now"
// so an operator who has fixed the cause isn't left waiting on a timer.
function retryAll(db) {
  try {
    const r = db.prepare("UPDATE sync_outbox SET dead = 0, attempts = 0, next_attempt_at = NULL WHERE synced_at IS NULL").run();
    return r.changes;
  } catch (_) { return 0; }
}

function pendingCount(db) {
  try { return db.prepare('SELECT COUNT(*) c FROM sync_outbox WHERE synced_at IS NULL AND COALESCE(dead, 0) = 0').get().c; }
  catch (_) { return 0; }
}

function deadCount(db) {
  try { return db.prepare('SELECT COUNT(*) c FROM sync_outbox WHERE synced_at IS NULL AND dead = 1').get().c; }
  catch (_) { return 0; }
}

// Drop successfully-synced rows after a retention window. The outbox otherwise
// grew without bound for the life of the installation. Version counters live in
// sync_versions, so pruning cannot regress an entity's version.
function pruneSynced(db, days = 14) {
  try {
    const r = db.prepare("DELETE FROM sync_outbox WHERE synced_at IS NOT NULL AND synced_at < datetime('now', ?)")
      .run(`-${Math.max(1, days)} days`);
    return r.changes;
  } catch (_) { return 0; }
}

// Build + enqueue the thin snapshot for one student (current balances). This is
// the read model the parent portal serves when the desktop is offline.

// ── the school's own identity, projected ──────────────────────────────────
// A parent on the internet portal was shown a generic blue page with the
// school's name in small type and no way to contact anybody — because the
// crest and the phone numbers only ever existed on the desktop's hard disk.
// One small snapshot fixes both: the portal draws the same crest as the app on
// the school Wi-Fi, and the "Message the school" button has a number to use.
//
// The crest is sent as a data URI, and only if it is small enough to be one.
// This projection is pushed on backfill and whenever branding is saved, not on
// a timer: a school changes its logo about once.
function enqueueSchoolProfile(db) {
  try {
    if (!syncEnabled(db)) return null;
    const { getSetting } = require('../../utils/idgen');
    const media = require('../media');
    const phone = getSetting(db, 'school_phone_1', '');
    return postToOutbox(db, {
      entity_type: 'school_profile',
      entity_key: 'school:profile',
      payload: {
        school: {
          name: getSetting(db, 'school_name', 'School'),
          short_name: getSetting(db, 'school_abbreviation', ''),
          motto: getSetting(db, 'school_motto', ''),
          type: getSetting(db, 'school_type', ''),
          address: getSetting(db, 'school_address', '') || getSetting(db, 'school_location', ''),
          digital_address: getSetting(db, 'school_digital_address', ''),
          website: getSetting(db, 'school_website', ''),
        },
        contact: {
          phone,
          phone_alt: getSetting(db, 'school_phone_2', ''),
          email: getSetting(db, 'school_email', ''),
          whatsapp: getSetting(db, 'school_whatsapp', '') || phone,
        },
        logo: media.logoUri(db, getSetting),
        currency: getSetting(db, 'payment_currency', 'GHS'),
        // The school's chosen colours travel with its crest, so the hosted
        // portal draws the same school the desktop does rather than a stock
        // violet page carrying somebody's badge.
        theme: {
          school_color_primary:    getSetting(db, 'school_color_primary', ''),
          school_color_accent:     getSetting(db, 'school_color_accent', ''),
          school_color_background: getSetting(db, 'school_color_background', ''),
          school_color_foreground: getSetting(db, 'school_color_foreground', ''),
          ui_font_family:          getSetting(db, 'ui_font_family', ''),
          ui_font_size_base:       getSetting(db, 'ui_font_size_base', ''),
        },
      },
    });
  } catch (_) { return null; }
}

function enqueueStudentSnapshot(db, studentId) {
  if (!syncEnabled(db)) return null;
  try {
    const s = db.prepare(`
      SELECT s.id, s.index_number, s.surname, s.first_name, s.other_names, s.current_class_id, c.name AS class_name
      FROM students s LEFT JOIN class_groups c ON c.id = s.current_class_id WHERE s.id = ?
    `).get(studentId);
    if (!s) return null;
    const term = db.prepare('SELECT id, label FROM terms WHERE is_current = 1').get();
    // A voided bill is not money owed, so it must not be projected into the
    // cloud snapshot the parent portal reads.
    const bill = term ? db.prepare("SELECT total_billed, total_paid, balance FROM student_bills WHERE student_id = ? AND term_id = ? AND COALESCE(status, 'active') = 'active'").get(studentId, term.id) : null;
    const rate = parseFloat(getSetting(db, 'canteen_daily_rate', '5'));
    const canteenUnpaid = term ? db.prepare(`
      SELECT COUNT(*) c FROM school_calendar sc
      LEFT JOIN canteen_day_status cds ON cds.date = sc.date AND cds.student_id = ?
      WHERE sc.term_id = ? AND sc.day_type = 'school_day' AND (cds.status IS NULL OR cds.status = 'unpaid')
    `).get(studentId, term.id).c : 0;
    // Attendance summary (current term).
    let attendance = { present: 0, absent: 0, total: 0 };
    try {
      attendance = db.prepare(`
        SELECT COUNT(*) FILTER (WHERE status='present') AS present,
               COUNT(*) FILTER (WHERE status='absent')  AS absent,
               COUNT(*) AS total
        FROM student_attendance WHERE student_id = ?${term ? ' AND term_id = ?' : ''}
      `).get(...(term ? [studentId, term.id] : [studentId]));
    } catch (_) {}

    // Academic performance (current term): per-subject scores + summary.
    let report = null;
    try {
      if (term) {
        const subjects = db.prepare(`
          SELECT sub.name AS subject, sc.total_score, sc.grade_remark
          FROM scores sc JOIN subjects sub ON sub.id = sc.subject_id
          WHERE sc.student_id = ? AND sc.term_id = ? ORDER BY sub.name
        `).all(studentId, term.id);
        const summary = db.prepare('SELECT average_score, class_rank, number_on_roll, teacher_remarks FROM student_term_summary WHERE student_id = ? AND term_id = ?').get(studentId, term.id);
        if (subjects.length || summary) {
          report = {
            term: term.label,
            subjects: subjects.map(x => ({ subject: x.subject, total: x.total_score, grade: x.grade_remark })),
            average: summary?.average_score ?? null,
            rank: summary?.class_rank ?? null,
            number_on_roll: summary?.number_on_roll ?? null,
            remarks: summary?.teacher_remarks ?? null,
          };
        }
      }
    } catch (_) {}

    // Class timetable (so the portal can show it off-LAN). Small enough for the
    // thin cloud; refreshed whenever this student's snapshot is rebuilt.
    let timetable = null;
    try {
      if (s.current_class_id) {
        const tt = require('../../ipc/timetable');
        const grid = tt.getClassTimetable(db, s.current_class_id);
        if (grid && (grid.periods || []).length) timetable = grid;
      }
    } catch (_) {}

    // Upcoming homework for the child's class.
    let homework = [];
    try {
      const hw = require('../../ipc/homework');
      homework = hw.listForStudent(db, studentId).slice(0, 10);
    } catch (_) {}

    // Transport: route, stop, pickup time and the term fee balance.
    let transport = null;
    try {
      const tr = require('../../ipc/transport');
      transport = tr.transportForStudent(db, studentId);
    } catch (_) {}

    return postToOutbox(db, {
      entity_type: 'student_snapshot',
      entity_key: `student:${studentId}`,
      payload: {
        student_id: studentId,
        index_number: s.index_number,
        name: `${s.surname} ${s.first_name} ${s.other_names || ''}`.trim(),
        // The class the pupil sits in, not only its name. The cloud's staff
        // surface checks "is this teacher the class teacher here" against it
        // before letting a canteen collection through; without the id that
        // check read `undefined` and let every teacher collect from every
        // pupil in the school.
        class_id: s.current_class_id || null,
        class_name: s.class_name,
        term: term ? term.label : null,
        fees: { billed: bill?.total_billed || 0, paid: bill?.total_paid || 0, balance: bill?.balance || 0 },
        canteen: { unpaid_days: canteenUnpaid, amount_owed: canteenUnpaid * rate },
        attendance,
        report,
        timetable,
        homework,
        transport,
        updated_at: new Date().toISOString(),
      },
    });
  } catch (_) { return null; }
}

// Enqueue everything the portal needs to serve a school that already has data.
//
// Every other enqueue in the app is event-driven: a payment, a score entry, an
// attendance mark. That means switching cloud sync on for an existing school
// projected NOTHING — "Push now" reported 0 records, the school's portal page
// stayed empty, and parents could not sign in at all, because their auth record
// is only projected when the parent is created or edited. A school would only
// trickle into the portal as individual records happened to change.
//
// Safe to run repeatedly: each entity collapses onto its queued row, and the
// version counter keeps moving forward.
function backfillAll(db, { receiptLimit = 200 } = {}) {
  const counts = {
    students: 0, parents: 0, announcements: 0, receipts: 0,
    staff: 0, timetables: 0, classes: 0, metrics: 0, debtors: 0, school: 0,
  };
  if (!syncEnabled(db)) return { ok: false, error: 'Cloud sync is switched off.' };

  const { enqueueParentAuth } = require('../parents');

  try {
    const students = db.prepare("SELECT id FROM students WHERE status = 'Active'").all();
    for (const s of students) { if (enqueueStudentSnapshot(db, s.id)) counts.students++; }
  } catch (_) {}

  try {
    const rows = db.prepare('SELECT id FROM parents').all();
    for (const p of rows) { if (enqueueParentAuth(db, p.id)) counts.parents++; }
  } catch (_) {}

  try {
    const rows = db.prepare('SELECT id, title, body, audience, target_student_id, created_at, is_active FROM announcements WHERE is_active = 1').all();
    for (const a of rows) {
      const posted = postToOutbox(db, {
        entity_type: 'announcement',
        entity_key: `announcement:${a.id}`,
        payload: {
          id: a.id, title: a.title, body: a.body, audience: a.audience,
          student_id: a.target_student_id || null, student_name: null,
          created_at: a.created_at, is_active: a.is_active,
        },
      });
      if (posted) counts.announcements++;
    }
  } catch (_) {}

  // Recent receipts only — the cloud is a thin read model, not an archive.
  try {
    const rows = db.prepare(`
      SELECT receipt_number, student_id, amount, payment_method, payment_date
      FROM payments
      WHERE is_reversed = 0 AND receipt_number IS NOT NULL
      ORDER BY id DESC LIMIT ?
    `).all(receiptLimit);
    for (const r of rows) {
      const posted = postToOutbox(db, {
        entity_type: 'receipt',
        entity_key: `receipt:${r.receipt_number}`,
        payload: {
          receipt_number: r.receipt_number, student_id: r.student_id, amount: r.amount,
          category: 'fees', payment_method: r.payment_method, date: r.payment_date,
        },
      });
      if (posted) counts.receipts++;
    }
  } catch (_) {}

  // The staff read model — accounts, class rosters, dashboard numbers, debtors.
  // Without this a teacher cannot sign in off-LAN at all, for exactly the
  // reason parents could not before backfill existed: their record is only
  // projected when something happens to change it.
  // Every kind has to be counted, not just the interesting two: `total` is
  // meant to equal the number of rows now sitting in the outbox, and the
  // "Push now" dialog shows it. An undercount reads as records having been
  // dropped.
  try { if (enqueueSchoolProfile(db)) counts.school = 1; } catch (_) {}

  try { Object.assign(counts, require('./staff_projection').enqueueAllStaff(db)); } catch (_) {}
  try { Object.assign(counts, require('./office_projection').enqueueOffice(db)); } catch (_) {}

  return { ok: true, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

module.exports = {
  syncEnabled, postToOutbox, listUnsynced, markSynced, markFailed, pendingCount, enqueueStudentSnapshot,
  enqueueSchoolProfile,
  nextVersion, retryAll, deadCount, pruneSynced, backoffSeconds, MAX_ATTEMPTS, backfillAll,
};
