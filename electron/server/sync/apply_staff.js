// Nickland Edusoft — applying a teacher's off-LAN work to the desktop.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// A teacher marking a register from home writes to the cloud's change queue,
// because the school desktop may well be switched off. This is the other end:
// the desktop pulls those changes and applies them to the real database,
// through the SAME functions the LAN API calls — `saveExamMark`,
// `recordCanteenPayment`, the homework module — so an off-LAN write cannot
// take a different path from an on-LAN one and quietly diverge from it.
//
// Three rules govern everything here, and they are not negotiable:
//
//   1. Re-check the permission. The cloud checks it too, but the cloud's copy
//      of a teacher's permissions is a projection that can be stale — an
//      account revoked this morning may still look valid in a snapshot pushed
//      last night. The desktop holds the truth and gets the last word.
//
//   2. Be idempotent. A change can be delivered twice: the desktop can apply a
//      batch and then fail before its cursor is saved. Every write here is an
//      upsert or is de-duplicated, so replaying is harmless. The one exception
//      is money — see `canteen_collect`.
//
//   3. Never invent authority. Each change carries the user_id the cloud
//      authenticated; the write is attributed to that teacher, and if the
//      account no longer exists or is inactive the change is dropped.

const { getSetting } = require('../../utils/idgen');

// Resolve the acting user, or null if they may no longer act. Deliberately
// re-reads from the desktop rather than trusting anything in the payload.
function actor(db, payload) {
  const id = parseInt(payload && payload.user_id, 10);
  if (!id) return null;
  try {
    const u = db.prepare('SELECT id, username, staff_id, is_active, designation_id FROM users WHERE id = ?').get(id);
    return u && u.is_active ? u : null;
  } catch (_) { return null; }
}

function allowed(db, userId, module, action) {
  try {
    const perms = require('../../ipc/auth').resolveEffectivePermissions(db, userId);
    const p = perms[module];
    if (!p) return false;
    return !!p[{ view: 'canView', create: 'canCreate', edit: 'canEdit', delete: 'canDelete' }[action]];
  } catch (_) { return false; }
}

function currentTermId(db) {
  try { return db.prepare('SELECT id FROM terms WHERE is_current = 1').get()?.id ?? null; }
  catch (_) { return null; }
}

// ── attendance ──────────────────────────────────────────────────────────────
// Naturally idempotent: one row per (student, date), upserted.
function applyAttendance(db, payload) {
  const user = actor(db, payload);
  if (!user) return false;
  if (!allowed(db, user.id, 'students', 'edit') && !allowed(db, user.id, 'academics', 'edit')) return false;

  const date = payload.date;
  const marks = Array.isArray(payload.marks) ? payload.marks : [];
  if (!date || !marks.length) return false;

  const termId = payload.term_id ?? currentTermId(db);
  const up = db.prepare(`
    INSERT INTO student_attendance (student_id, date, status, marked_by, term_id, notes)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (student_id, date) DO UPDATE SET
      status = excluded.status, marked_by = excluded.marked_by, notes = excluded.notes
  `);
  const touched = [];
  const tx = db.transaction(() => {
    for (const m of marks) {
      const sid = parseInt(m.student_id, 10);
      if (!sid) continue;
      const status = m.status || 'present';
      up.run(sid, date, status, user.id, termId, status === 'absent' ? (m.notes || null) : null);
      touched.push(sid);
    }
  });
  tx();
  refresh(db, touched);
  return touched.length > 0;
}

// ── scores ──────────────────────────────────────────────────────────────────
// `saveExamMark` upserts on (student, term, subject) and recomputes the total,
// so replaying a batch lands on the same numbers.
function applyScores(db, payload) {
  const user = actor(db, payload);
  if (!user) return false;
  if (!allowed(db, user.id, 'academics', 'edit')) return false;

  const subjectId = parseInt(payload.subject_id, 10);
  const marks = Array.isArray(payload.marks) ? payload.marks : [];
  if (!subjectId || !marks.length) return false;

  const termId = payload.term_id ?? currentTermId(db);
  if (!termId) return false;

  const { saveExamMark } = require('../../ipc/scores');
  const touched = [];
  const tx = db.transaction(() => {
    for (const m of marks) {
      const sid = parseInt(m.student_id, 10);
      if (!sid || m.exam_score === '' || m.exam_score == null) continue;
      const v = Number(m.exam_score);
      // A score outside 0–100 is dropped rather than thrown: one bad number
      // must not block the rest of the class, and the change is not coming
      // back for a retry.
      if (!Number.isFinite(v) || v < 0 || v > 100) continue;
      saveExamMark(db, { studentId: sid, subjectId, termId, examScore: v });
      touched.push(sid);
    }
  });
  tx();
  refresh(db, touched);
  return touched.length > 0;
}

// ── canteen ─────────────────────────────────────────────────────────────────
// The one that takes money, and the one place where replaying a change would
// do real harm: applying it twice issues two receipts and marks twice as many
// days paid. The cloud stamps each collection with a uuid; we record the ones
// we have applied and refuse a repeat.
function applyCanteen(db, payload) {
  const user = actor(db, payload);
  if (!user) return false;
  if (!allowed(db, user.id, 'canteen', 'create')) return false;

  const sid = parseInt(payload.student_id, 10);
  const ref = payload.uuid || payload.reference;
  if (!sid || !ref) return false;
  if (alreadyApplied(db, ref)) return true;   // already done — report success, do nothing

  const { recordCanteenPayment } = require('../../ipc/canteen');
  const result = recordCanteenPayment(db, {
    student_id: sid,
    amount: payload.amount,
    payment_method: payload.payment_method || 'Cash',
    notes: payload.notes || '',
    received_by: user.id,
  });
  if (!result || !result.ok) return false;
  markApplied(db, ref);
  refresh(db, [sid]);
  return true;
}

// ── homework ────────────────────────────────────────────────────────────────
// Creating the same homework twice would give a class two copies of one
// assignment, so this is de-duplicated on the cloud's uuid as well.
function applyHomework(db, payload) {
  const user = actor(db, payload);
  if (!user) return false;
  if (!allowed(db, user.id, 'academics', 'edit')) return false;

  const ref = payload.uuid;
  if (!ref) return false;
  if (alreadyApplied(db, ref)) return true;

  const hw = require('../../ipc/homework');
  const r = hw.saveHomework(db, {
    classId: parseInt(payload.class_id, 10),
    subjectId: payload.subject_id || null,
    teacherId: user.staff_id || null,
    title: payload.title,
    description: payload.description,
    dueDate: payload.due_date,
    maxMarks: payload.max_marks,
  });
  if (!r || !r.ok) return false;
  markApplied(db, ref);
  try { require('./staff_projection').enqueueClassRoster(db, parseInt(payload.class_id, 10)); } catch (_) {}
  return true;
}

// ── applied-change ledger ───────────────────────────────────────────────────
// ── password changes made away from the school ──────────────────────────────
// The cloud verified the current password against the projected hash and
// computed the new one; what arrives here is a bcrypt hash, never a password.
// The desktop still re-reads the account, because the projection the cloud
// checked against could have been pushed before the account was disabled.
//
// Idempotent by nature: writing the same hash twice leaves the same row.
function applyPasswordChange(db, payload) {
  const user = actor(db, payload);
  if (!user) return false;
  const hash = String((payload && payload.new_hash) || '');
  // Only ever a bcrypt digest. A payload carrying anything else is malformed,
  // and storing it would lock the account out of every surface at once.
  if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash)) return false;
  try {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
      .run(hash, user.id);
  } catch (_) { return false; }

  try {
    db.prepare(`
      INSERT INTO audit_log (entity_type, entity_id, action, user_id, justification, severity)
      VALUES ('user', ?, 'password_changed_remotely', ?, ?, 'high')
    `).run(user.id, user.id, `${user.username} changed their password from the ${payload.source || 'mobile'} app`);
  } catch (_) {}

  try { require('./staff_projection').enqueueStaffAuth(db, user.id); } catch (_) {}
  return true;
}

// ── a reset asked for from a phone ──────────────────────────────────────────
// Recorded as a pending request for an Administrator to approve on the
// desktop, exactly as if it had been raised at the sign-in screen. Nothing is
// granted here — the whole point of the flow is that a person approves it.
//
// Not naturally idempotent (a redelivery would queue a second request), so it
// is guarded by the one-open-request rule rather than by the ledger.
function applyPasswordResetRequest(db, payload) {
  const username = String((payload && payload.username) || '').trim();
  if (!username) return false;
  let u;
  try { u = db.prepare('SELECT id, username FROM users WHERE username = ? AND is_active = 1').get(username); }
  catch (_) { return false; }
  // Silently dropped for an unknown account: the cloud already answered the
  // phone without saying whether the username was real, and nothing here
  // should turn that into a record that says otherwise.
  if (!u) return true;

  try {
    const open = db.prepare(`
      SELECT id FROM password_reset_requests
      WHERE user_id = ? AND status IN ('pending', 'approved')
    `).get(u.id);
    if (open) return true;
    db.prepare(`
      INSERT INTO password_reset_requests (user_id, username, status, reason, requested_from)
      VALUES (?, ?, 'pending', ?, ?)
    `).run(u.id, u.username, String((payload && payload.reason) || '').slice(0, 500) || null,
           payload && payload.source === 'web' ? 'web' : 'mobile');
  } catch (_) { return false; }
  return true;
}

// A tiny table so a redelivered change that is NOT naturally idempotent — a
// canteen collection, a homework assignment — is applied exactly once. Kept
// here rather than in the main schema because it belongs to sync, and created
// on demand so an older database needs no migration to receive its first
// off-LAN write.
function ensureLedger(db) {
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS cloud_applied_changes (
      reference  TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    return true;
  } catch (_) { return false; }
}

function alreadyApplied(db, ref) {
  if (!ensureLedger(db)) return false;
  try { return !!db.prepare('SELECT 1 FROM cloud_applied_changes WHERE reference = ?').get(String(ref)); }
  catch (_) { return false; }
}

function markApplied(db, ref) {
  if (!ensureLedger(db)) return;
  try { db.prepare('INSERT OR IGNORE INTO cloud_applied_changes (reference) VALUES (?)').run(String(ref)); } catch (_) {}
}

// Push the affected read models straight back up, so the teacher who made the
// change sees the desktop's version of it rather than their own pending copy.
function refresh(db, studentIds) {
  try {
    const outbox = require('./outbox');
    const staff = require('./staff_projection');
    const unique = [...new Set(studentIds)];
    for (const sid of unique) outbox.enqueueStudentSnapshot(db, sid);
    staff.enqueueRostersForStudents(db, unique);
    staff.enqueueSchoolMetrics(db);
    staff.enqueueDebtors(db);
  } catch (_) {}
}

// The change types this module owns, for the sync client's dispatcher.
const HANDLERS = {
  attendance_mark: applyAttendance,
  score_entry: applyScores,
  canteen_collect: applyCanteen,
  homework_create: applyHomework,
  staff_password_change: applyPasswordChange,
  staff_password_reset_request: applyPasswordResetRequest,
};

function applyStaffChange(db, change) {
  const fn = HANDLERS[change && change.type];
  if (!fn) return null;                       // not ours — let the caller carry on
  try { return !!fn(db, change.payload || {}); } catch (_) { return false; }
}

module.exports = { applyStaffChange, HANDLERS, ensureLedger, alreadyApplied, markApplied };
