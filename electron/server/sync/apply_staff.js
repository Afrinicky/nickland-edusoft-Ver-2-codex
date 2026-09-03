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

// ── continuous assessment ───────────────────────────────────────────────────
// Upserted on (column, student), so replaying lands on the same marks. The
// weighted class score is recomputed afterwards through the desktop's own
// `recomputeClassScore`, which is what the Class Scores sheet calls — an
// off-LAN mark and an on-LAN one cannot end up weighted differently.
function applyAssessments(db, payload) {
  const user = actor(db, payload);
  if (!user) return false;
  if (!allowed(db, user.id, 'academics', 'edit')) return false;

  const classId = parseInt(payload.class_id, 10);
  const subjectId = parseInt(payload.subject_id, 10);
  const entries = Array.isArray(payload.marks) ? payload.marks : [];
  if (!classId || !subjectId || !entries.length) return false;
  const termId = payload.term_id ?? currentTermId(db);
  if (!termId) return false;

  let columns;
  try {
    columns = Object.fromEntries(db.prepare(`
      SELECT id, max_marks FROM assessment_columns
      WHERE class_group_id = ? AND subject_id = ? AND term_id = ?
    `).all(classId, subjectId, termId).map(c => [String(c.id), c]));
  } catch (_) { return false; }

  const up = db.prepare(`
    INSERT INTO assessment_scores (assessment_column_id, student_id, marks) VALUES (?, ?, ?)
    ON CONFLICT (assessment_column_id, student_id) DO UPDATE SET marks = excluded.marks
  `);
  const clear = db.prepare('DELETE FROM assessment_scores WHERE assessment_column_id = ? AND student_id = ?');
  const touched = new Set();
  try {
    db.transaction(() => {
      for (const e of entries) {
        const col = columns[String(e.column_id)];
        const sid = parseInt(e.student_id, 10);
        if (!col || !sid) continue;
        if (e.marks === '' || e.marks == null) { clear.run(col.id, sid); touched.add(sid); continue; }
        const v = Number(e.marks);
        // One impossible mark must not block the rest of the class; the change
        // is not coming back for a retry.
        if (!Number.isFinite(v) || v < 0 || v > col.max_marks) continue;
        up.run(col.id, sid, v);
        touched.add(sid);
      }
    })();
  } catch (_) { return false; }

  try {
    const { recomputeClassScore, readWeights } = require('../../ipc/scores');
    const w = readWeights(db);
    for (const sid of touched) recomputeClassScore(db, classId, subjectId, termId, sid, w);
  } catch (_) {}
  refresh(db, [...touched]);
  return touched.size > 0;
}

// ── end-of-term remarks ─────────────────────────────────────────────────────
// Conduct, interests, talents and the class teacher's remark. Upserted on
// (student, term).
function applyTermRemarks(db, payload) {
  const user = actor(db, payload);
  if (!user) return false;
  if (!allowed(db, user.id, 'academics', 'edit')) return false;
  const sid = parseInt(payload.student_id, 10);
  if (!sid) return false;
  const termId = payload.term_id ?? currentTermId(db);
  if (!termId) return false;
  let classId = null;
  try { classId = db.prepare('SELECT current_class_id AS id FROM students WHERE id = ?').get(sid)?.id || null; } catch (_) { return false; }
  try {
    db.prepare(`
      INSERT INTO student_term_summary (student_id, term_id, class_group_id, conduct_traits, learner_interests, learner_talents, teacher_remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (student_id, term_id) DO UPDATE SET
        conduct_traits    = excluded.conduct_traits,
        learner_interests = excluded.learner_interests,
        learner_talents   = excluded.learner_talents,
        teacher_remarks   = excluded.teacher_remarks
    `).run(sid, termId, classId,
      payload.conduct || null, payload.interests || null, payload.talents || null, payload.remarks || null);
  } catch (_) { return false; }
  refresh(db, [sid]);
  return true;
}

// ── lesson notes ────────────────────────────────────────────────────────────
// A note written on the way home. Keyed by the cloud's uuid so a redelivery
// updates the same note rather than filing a second copy of it — the local id
// cannot be used, because the note did not exist locally when it was written.
const LESSON_COLUMNS = [
  'class_group_id', 'subject_id', 'week_number', 'lesson_date', 'duration_minutes',
  'topic', 'sub_topic', 'references_text', 'tlms', 'objectives', 'rpk',
  'introduction', 'presentation', 'activity', 'evaluation', 'closure',
  'assignment', 'remarks', 'status',
];

function applyLessonNote(db, payload) {
  const user = actor(db, payload);
  if (!user || !user.staff_id) return false;
  const note = payload.note || {};
  if (!note.topic || !String(note.topic).trim()) return false;
  const ref = payload.uuid;
  if (!ref) return false;

  const values = LESSON_COLUMNS.map(c => (note[c] === undefined ? null : note[c]));

  // An edit made off-LAN names the note it edits; a new one does not.
  const localId = parseInt(payload.local_id, 10) || null;
  try {
    if (localId) {
      const existing = db.prepare('SELECT id, staff_id, status FROM lesson_notes WHERE id = ?').get(localId);
      if (!existing || existing.staff_id !== user.staff_id) return true;   // not theirs — drop it
      if (existing.status === 'approved') return true;                     // reviewed; not theirs to rewrite
      db.prepare(`UPDATE lesson_notes SET ${LESSON_COLUMNS.map(c => `${c} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(...values, localId);
    } else {
      if (alreadyApplied(db, ref)) return true;
      const cols = ['staff_id', 'term_id', ...LESSON_COLUMNS];
      db.prepare(`INSERT INTO lesson_notes (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
        .run(user.staff_id, payload.term_id ?? currentTermId(db), ...values);
      markApplied(db, ref);
    }
  } catch (_) { return false; }
  try { require('./staff_projection').enqueueStaffProfile(db, user.id); } catch (_) {}
  return true;
}

// ── leave ───────────────────────────────────────────────────────────────────
// Filed as pending, for whoever reviews leave to decide on the desktop. Nothing
// here approves anything.
function applyLeaveRequest(db, payload) {
  const user = actor(db, payload);
  if (!user || !user.staff_id) return false;
  const ref = payload.uuid;
  if (!ref || alreadyApplied(db, ref)) return !!ref;
  const { leave_type, start_date, end_date, days_requested, justification } = payload;
  if (!leave_type || !start_date || !end_date || !justification) return false;
  try {
    db.prepare(`
      INSERT INTO leave_requests (staff_id, leave_type, start_date, end_date, days_requested, justification, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `).run(user.staff_id, leave_type, start_date, end_date, days_requested || 1, justification);
  } catch (_) { return false; }
  markApplied(db, ref);
  try { require('./staff_projection').enqueueStaffProfile(db, user.id); } catch (_) {}
  return true;
}

// ── clocking in from off site ───────────────────────────────────────────────
// Upserted on (staff, date). A second clock-in for a day already opened does
// not move the first stamp — the earliest arrival is the record.
function applyStaffClock(db, payload) {
  const user = actor(db, payload);
  if (!user || !user.staff_id) return false;
  const date = payload.date;
  const at = payload.at;
  if (!date || !at) return false;
  try {
    if (payload.direction === 'out') {
      db.prepare(`
        UPDATE staff_attendance SET clock_out = COALESCE(clock_out, ?)
        WHERE staff_id = ? AND date = ?
      `).run(at, user.staff_id, date);
    } else {
      db.prepare(`
        INSERT INTO staff_attendance (staff_id, date, clock_in, status) VALUES (?, ?, ?, 'present')
        ON CONFLICT (staff_id, date) DO UPDATE SET clock_in = COALESCE(staff_attendance.clock_in, excluded.clock_in), status = 'present'
      `).run(user.staff_id, date, at);
    }
  } catch (_) { return false; }
  try { require('./staff_projection').enqueueStaffProfile(db, user.id); } catch (_) {}
  return true;
}

// ── replying to a parent ────────────────────────────────────────────────────
// Goes through the desktop's own `postMessage`, so the reply is mirrored to the
// parent's SMS or email exactly as one typed at the school would be.
function applyMessageReply(db, payload) {
  const user = actor(db, payload);
  if (!user) return false;
  if (!allowed(db, user.id, 'notifications', 'create')) return false;
  const ref = payload.uuid;
  if (!ref) return false;
  if (alreadyApplied(db, ref)) return true;
  if (!payload.body || !String(payload.body).trim()) return false;

  // The cloud knows a thread by its uuid; the desktop by its row id.
  let threadId = null;
  if (payload.thread_uuid) {
    try { threadId = db.prepare('SELECT id FROM message_threads WHERE uuid = ?').get(payload.thread_uuid)?.id || null; } catch (_) {}
    if (!threadId) return false;
  }
  try {
    const r = require('../../ipc/messaging').postMessage(db, {
      threadId,
      parentId: payload.parent_id ? parseInt(payload.parent_id, 10) : null,
      studentId: payload.student_id ? parseInt(payload.student_id, 10) : null,
      subject: payload.subject || null,
      senderType: 'staff', senderId: user.id,
      senderName: db.prepare('SELECT full_name FROM users WHERE id = ?').get(user.id)?.full_name || null,
      body: payload.body,
    });
    if (!r || !r.ok) return false;
  } catch (_) { return false; }
  markApplied(db, ref);
  return true;
}

// ── posting a notice ────────────────────────────────────────────────────────
function applyAnnouncement(db, payload) {
  const user = actor(db, payload);
  if (!user) return false;
  if (!allowed(db, user.id, 'notifications', 'edit')) return false;
  const ref = payload.uuid;
  if (!ref) return false;
  if (alreadyApplied(db, ref)) return true;
  if (!payload.title || !payload.body) return false;
  const audience = payload.audience === 'student' ? 'student' : 'all';
  try {
    const r = db.prepare(`
      INSERT INTO announcements (title, body, audience, target_student_id, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(String(payload.title).slice(0, 200), String(payload.body).slice(0, 4000),
           audience, audience === 'student' ? (parseInt(payload.student_id, 10) || null) : null, user.id);
    require('../../ipc/announcements').project(db, r.lastInsertRowid);
  } catch (_) { return false; }
  markApplied(db, ref);
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

// ── decisions taken off-LAN ─────────────────────────────────────────────────
// A head teacher approving leave on the bus, or signing off a lesson note.
// Neither moves money, which is why they are the only two decisions the cloud
// is allowed to queue at all. Idempotent by state rather than by ledger: a
// request that is no longer pending is left exactly as the desktop has it,
// so a redelivered change cannot overturn a decision made since.
function applyLeaveDecision(db, payload) {
  const user = actor(db, payload);
  if (!user) return false;
  if (!allowed(db, user.id, 'staff', 'edit')) return false;
  const id = parseInt(payload.id, 10);
  const decision = String(payload.decision || '');
  if (!id || !['approved', 'rejected'].includes(decision)) return false;
  try {
    const lr = db.prepare('SELECT id, status, staff_id FROM leave_requests WHERE id = ?').get(id);
    if (!lr) return false;
    if (lr.status !== 'pending') return true;            // already settled here
    db.prepare(`
      UPDATE leave_requests SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'),
        reviewer_notes = ? WHERE id = ?
    `).run(decision, user.id, String(payload.notes || '').slice(0, 500) || null, id);
    try {
      const owner = db.prepare('SELECT id FROM users WHERE staff_id = ?').get(lr.staff_id);
      if (owner) require('./staff_projection').enqueueStaffProfile(db, owner.id);
    } catch (_) {}
    audit(db, user.id, 'leave_request', id, `leave_${decision}`, 'Decided in the app, off-LAN');
  } catch (_) { return false; }
  return true;
}

function applyLessonNoteDecision(db, payload) {
  const user = actor(db, payload);
  if (!user) return false;
  if (!allowed(db, user.id, 'academics', 'edit')) return false;
  const id = parseInt(payload.id, 10);
  const decision = String(payload.decision || '');
  if (!id || !['approved', 'rejected'].includes(decision)) return false;
  try {
    const note = db.prepare("SELECT id, COALESCE(status,'draft') status FROM lesson_notes WHERE id = ?").get(id);
    if (!note) return false;
    if (note.status !== 'submitted') return true;        // already settled here
    db.prepare(`
      UPDATE lesson_notes SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'),
        review_comments = ? WHERE id = ?
    `).run(decision, user.id, String(payload.notes || '').slice(0, 500) || null, id);
    audit(db, user.id, 'lesson_note', id, `lesson_note_${decision}`, 'Decided in the app, off-LAN');
  } catch (_) { return false; }
  return true;
}

// ── money that arrived while the school was closed ──────────────────────────
// A fee paid through the gateway on the portal. The cloud confirmed it with
// the gateway and could not record it — it has no receipt counter and no
// ledger — so this is where it becomes a payment in the school's books, through
// the same function the counter uses.
//
// There is no `user_id` here and there must not be: nobody in the school
// authorised this, the gateway did. What stands in for authority is the
// gateway reference, which is de-duplicated twice over — against the ledger of
// applied changes, and against the payments table itself — so a redelivered
// change, a re-verified charge and a second pull all resolve to one receipt.
function applyGatewayPayment(db, payload) {
  const reference = String(payload.gateway_reference || '').trim();
  const studentId = parseInt(payload.student_id, 10);
  const amount = Number(payload.amount);
  if (!reference || !studentId || !(amount > 0)) return false;

  const ref = `fee_payment:${reference}`;
  if (alreadyApplied(db, ref)) return true;
  try {
    const dup = db.prepare('SELECT id FROM payments WHERE reference = ?').get(reference);
    if (dup) { markApplied(db, ref); return true; }
  } catch (_) { /* fall through to the write, which is itself guarded */ }

  let result;
  try {
    result = require('../payments_service').recordFeePayment(db, {
      student_id: studentId,
      amount,
      payment_date: String(payload.paid_at || '').slice(0, 10) || undefined,
      payment_method: payload.gateway === 'paystack' ? 'Paystack' : 'Mobile Money',
      reference,
      received_by: null,                      // the gateway, not a person
      notes: `Paid online through ${payload.gateway || 'the gateway'}`,
      source: 'online_payment',
    });
  } catch (_) { return false; }
  if (!result || !result.ok) return false;

  markApplied(db, ref);
  try {
    db.prepare(`
      INSERT INTO audit_log (entity_type, entity_id, action, user_id, justification, severity)
      VALUES ('payment', ?, 'online_payment_settled', NULL, ?, 'normal')
    `).run(result.payment_id, `${reference} → receipt ${result.receipt_number}`);
  } catch (_) {}
  refresh(db, [studentId]);
  return true;
}

// A payment a parent says they made at the bank. Not a payment: an intent,
// which somebody in the office confirms against the school's own statement
// before a penny is posted. De-duplicated on the reference the parent gave,
// so declaring twice does not give the office the same slip twice.
function applyDeclaredPayment(db, payload) {
  const studentId = parseInt(payload.student_id, 10);
  const amount = Number(payload.amount);
  const reference = String(payload.reference || '').trim();
  if (!studentId || !(amount > 0) || !reference) return false;
  const ref = `payment_declared:${studentId}:${reference}`;
  if (alreadyApplied(db, ref)) return true;
  try {
    const r = require('../payments_service').createIntent(db, {
      student_id: studentId,
      parent_id: payload.parent_id ? parseInt(payload.parent_id, 10) : null,
      amount,
      channel: payload.channel || 'bank',
      reference,
      notes: String(payload.notes || '').slice(0, 300) || 'Declared by the parent in the app',
    });
    if (!r || !r.ok) return false;
  } catch (_) { return false; }
  markApplied(db, ref);
  return true;
}

function audit(db, userId, entityType, entityId, action, note, severity = 'normal') {
  try {
    db.prepare(`
      INSERT INTO audit_log (entity_type, entity_id, action, user_id, justification, severity)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(entityType, entityId, action, userId, String(note || '').slice(0, 500), severity);
  } catch (_) {}
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
  assessment_entry: applyAssessments,
  term_remarks: applyTermRemarks,
  canteen_collect: applyCanteen,
  homework_create: applyHomework,
  lesson_note_save: applyLessonNote,
  leave_request: applyLeaveRequest,
  staff_clock: applyStaffClock,
  message_reply: applyMessageReply,
  announcement_create: applyAnnouncement,
  staff_password_change: applyPasswordChange,
  staff_password_reset_request: applyPasswordResetRequest,
  leave_decision: applyLeaveDecision,
  lesson_note_decision: applyLessonNoteDecision,
  fee_payment: applyGatewayPayment,
  payment_declared: applyDeclaredPayment,
};

function applyStaffChange(db, change) {
  const fn = HANDLERS[change && change.type];
  if (!fn) return null;                       // not ours — let the caller carry on
  try { return !!fn(db, change.payload || {}); } catch (_) { return false; }
}

module.exports = { applyStaffChange, HANDLERS, ensureLedger, alreadyApplied, markApplied };
