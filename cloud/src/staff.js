// Nickland Edusoft Cloud — the staff surface.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// What lets a teacher do their job from home with the school's desktop
// switched off. The parent side of the cloud is a read model; this is a read
// model AND a write queue, because a register has to go somewhere.
//
// Reads come from projections the desktop pushes (staff_auth, class_roster,
// school_metrics, debtor_list, staff_timetable — see
// electron/server/sync/staff_projection.js). Writes are appended to the same
// cloud→desktop change queue that parent profile edits already use, and the
// desktop applies them through the very functions its own LAN API calls.
//
// Two things make that honest rather than a trick:
//
//   • A teacher sees their own pending work. Marks that are queued but not yet
//     applied are merged over the projected register before it is served, and
//     flagged `pending`. Without that, marking a register and reloading would
//     show a blank sheet, and the teacher would mark it again.
//
//   • The desktop has the last word. Permissions are checked here from the
//     projection, and checked AGAIN on the desktop before anything is written,
//     against the live account. A projection is a copy; a copy can be stale.
//
// It stays a thin cloud. There is no fee posting, no payroll, no reports —
// only the screens a teacher uses day to day.

const crypto = require('crypto');
const pauth = require('./portal_auth');

// Staff passwords are bcrypt on the desktop (electron/ipc/auth.js), unlike
// parents, which are scrypt. Rather than force every teacher to re-enrol so
// their password could be re-hashed, the cloud verifies bcrypt directly.
let bcryptLib = null;
function bcrypt() {
  if (bcryptLib) return bcryptLib;
  try { bcryptLib = require('bcryptjs'); }
  catch (_) { throw new Error("The 'bcryptjs' package is required for staff sign-in. Run: npm install"); }
  return bcryptLib;
}

const WRITE_TYPES = ['attendance_mark', 'score_entry', 'canteen_collect', 'homework_create'];

function verifyStaffPassword(password, stored) {
  if (!stored || !String(stored).startsWith('$2')) return false;
  try { return bcrypt().compareSync(String(password), String(stored)); } catch (_) { return false; }
}

function signStaffToken(school_id, user_id, ttlSeconds) {
  return pauth.signToken({ school_id, user_id, role: 'staff' }, ttlSeconds);
}

// Claims for a staff token, or null. A parent token has no `role`, so it can
// never satisfy this — and the reverse is covered on the parent side, which
// looks a record up by `parent_id` that a staff token does not carry.
function staffClaims(token) {
  const c = pauth.verifyToken(token);
  return c && c.role === 'staff' && c.user_id ? c : null;
}

async function loadStaff(store, school_id, user_id) {
  const rows = await store.listSnapshots(school_id, 'staff_auth');
  const rec = rows.map(r => r.payload).find(p => p && p.user_id === user_id);
  return rec && rec.is_active ? rec : null;
}

async function findStaffByUsername(store, school_id, username) {
  const u = String(username || '').trim().toLowerCase();
  if (!u) return null;
  const rows = await store.listSnapshots(school_id, 'staff_auth');
  return rows.map(r => r.payload)
    .find(p => p && p.is_active && String(p.username || '').toLowerCase() === u) || null;
}

const ACTION_KEY = { view: 'canView', create: 'canCreate', edit: 'canEdit', delete: 'canDelete' };

function can(rec, module, action) {
  if (!rec) return false;
  if (rec.is_admin) return true;
  const p = (rec.permissions || {})[module];
  return !!(p && p[ACTION_KEY[action]]);
}
const canAny = (rec, pairs) => pairs.some(([m, a]) => can(rec, m, a));

// ── projection readers ──────────────────────────────────────────────────────

async function snapshotPayload(store, school_id, type, key) {
  const rows = await store.listSnapshots(school_id, type);
  const hit = key ? rows.find(r => r.entity_key === key) : rows[0];
  return hit ? hit.payload : null;
}

async function allRosters(store, school_id) {
  const rows = await store.listSnapshots(school_id, 'class_roster');
  return rows.map(r => r.payload).filter(Boolean)
    .sort((a, b) => (a.level_order || 0) - (b.level_order || 0) || String(a.name).localeCompare(String(b.name)));
}

async function roster(store, school_id, classId) {
  return snapshotPayload(store, school_id, 'class_roster', `class:${classId}`);
}

// ── pending writes ──────────────────────────────────────────────────────────
// Everything a teacher has submitted that the desktop has not taken yet. The
// store tracks how far the desktop has pulled, so this shrinks to nothing once
// the school's machine comes back and syncs.
async function pending(store, school_id, types) {
  if (typeof store.pendingChanges !== 'function') return [];
  try { return await store.pendingChanges(school_id, { types }); } catch (_) { return []; }
}

// ── reads ───────────────────────────────────────────────────────────────────

async function dashboard(store, school_id, rec) {
  const m = await snapshotPayload(store, school_id, 'school_metrics', 'metrics:school');
  const empty = { students: 0, staff: 0, fees_collected: 0, fees_outstanding: 0 };
  if (!m) return { ok: true, term: null, metrics: empty, stale: true };
  // The dashboard shows money; a teacher who cannot see fees does not get the
  // fee numbers, exactly as on the desktop.
  const metrics = { ...empty, ...m.metrics };
  if (!can(rec, 'fees', 'view')) { metrics.fees_collected = 0; metrics.fees_outstanding = 0; }
  return { ok: true, term: m.term || null, metrics, updated_at: m.updated_at || null };
}

async function students(store, school_id, classId) {
  const rosters = await allRosters(store, school_id);
  const wanted = classId ? rosters.filter(r => String(r.class_id) === String(classId)) : rosters;
  const out = [];
  for (const r of wanted) {
    for (const s of r.students || []) {
      // Split back into the shape the LAN API returns, so the same screen
      // renders either way.
      const [surname, ...rest] = String(s.name || '').split(' ');
      out.push({
        id: s.id, index_number: s.index_number,
        surname, first_name: rest.join(' '), gender: null, class_name: r.name,
      });
    }
  }
  return { ok: true, students: out };
}

async function debtors(store, school_id) {
  const d = await snapshotPayload(store, school_id, 'debtor_list', 'debtors:school');
  return { ok: true, debtors: (d && d.debtors) || [], updated_at: d ? d.updated_at : null };
}

async function classes(store, school_id) {
  const rosters = await allRosters(store, school_id);
  return { ok: true, classes: rosters.map(r => ({ id: r.class_id, name: r.name, short_code: r.short_code })) };
}

// The register for a class on a date: what the desktop last projected, with
// anything this school has queued since merged over the top.
async function attendanceSheet(store, school_id, classId, date) {
  const r = await roster(store, school_id, classId);
  if (!r) return { ok: true, students: [] };

  const marked = { ...(((r.attendance || {})[date]) || {}) };
  const queued = new Set();
  for (const ch of await pending(store, school_id, ['attendance_mark'])) {
    const p = ch.payload || {};
    if (p.date !== date) continue;
    for (const m of p.marks || []) {
      marked[m.student_id] = { status: m.status, notes: m.notes || null };
      queued.add(String(m.student_id));
    }
  }

  return {
    ok: true,
    students: (r.students || []).map(s => ({
      id: s.id, index_number: s.index_number, name: s.name,
      status: marked[s.id]?.status || null,
      notes: marked[s.id]?.notes || null,
      pending: queued.has(String(s.id)) || undefined,
    })),
  };
}

async function scoreSubjects(store, school_id, classId) {
  const r = await roster(store, school_id, classId);
  return { ok: true, subjects: (r && r.subjects) || [] };
}

async function scoreSheet(store, school_id, classId, subjectId) {
  const r = await roster(store, school_id, classId);
  if (!r) return { ok: true, term: null, students: [] };

  const marks = { ...(((r.scores || {})[subjectId]) || {}) };
  const queued = new Set();
  for (const ch of await pending(store, school_id, ['score_entry'])) {
    const p = ch.payload || {};
    if (String(p.subject_id) !== String(subjectId)) continue;
    for (const m of p.marks || []) {
      // A queued mark has no computed total yet — that is the desktop's job,
      // and showing a stale total next to a fresh exam score would be a lie.
      marks[m.student_id] = { exam_score: m.exam_score, total_score: null };
      queued.add(String(m.student_id));
    }
  }

  return {
    ok: true,
    term: r.term || null,
    students: (r.students || []).map(s => ({
      id: s.id, index_number: s.index_number, name: s.name,
      exam_score: marks[s.id]?.exam_score ?? null,
      total_score: marks[s.id]?.total_score ?? null,
      pending: queued.has(String(s.id)) || undefined,
    })),
  };
}

// Canteen reads come from the parent-side student snapshot, which already
// carries the unpaid-day count — there is no second projection to keep in step.
async function canteenStudent(store, school_id, studentId) {
  const s = await snapshotPayload(store, school_id, 'student_snapshot', `student:${studentId}`);
  if (!s) return { ok: false, status: 404, error: 'Student not found.' };
  const c = s.canteen || { unpaid_days: 0, amount_owed: 0 };
  const rate = c.unpaid_days ? (c.amount_owed / c.unpaid_days) : null;
  return {
    ok: true,
    student: { id: s.student_id, index_number: s.index_number, name: s.name, class_name: s.class_name },
    daily_rate: rate, unpaid_days: c.unpaid_days || 0, amount_owed: c.amount_owed || 0,
    term: s.term ? { label: s.term } : null,
  };
}

async function timetableMine(store, school_id, rec) {
  const t = await snapshotPayload(store, school_id, 'staff_timetable', `timetable:user:${rec.user_id}`);
  if (!t) return { ok: true, has_staff: false, days: [], today: null };
  const jsDay = new Date().getDay();
  const todayVal = (jsDay >= 1 && jsDay <= 5) ? jsDay : null;
  const today = todayVal ? ((t.days || []).find(d => d.value === todayVal) || null) : null;
  return { ok: true, has_staff: !!t.has_staff, days: t.days || [], today };
}

async function homeworkForClass(store, school_id, classId) {
  const r = await roster(store, school_id, classId);
  const set = [...((r && r.homework) || [])];
  for (const ch of await pending(store, school_id, ['homework_create'])) {
    const p = ch.payload || {};
    if (String(p.class_id) !== String(classId)) continue;
    set.unshift({
      id: null, title: p.title, description: p.description,
      due_date: p.due_date, max_marks: p.max_marks ?? null, pending: true,
    });
  }
  return { ok: true, homework: set };
}

// ── writes ──────────────────────────────────────────────────────────────────
// Each one appends to the change queue and returns immediately. Nothing here
// touches a read model: the desktop applies the change and re-projects, which
// is what keeps one implementation of "what marking a register means".

function newRef() {
  try { return crypto.randomUUID(); }
  catch (_) { return 'ref_' + crypto.randomBytes(16).toString('hex'); }
}

async function submitAttendance(store, school_id, rec, { date, marks }) {
  if (!date || !Array.isArray(marks) || !marks.length) {
    return { ok: false, status: 400, error: 'date and marks[] are required.' };
  }
  const clean = marks
    .map(m => ({ student_id: parseInt(m.student_id, 10), status: m.status || 'present', notes: m.notes || null }))
    .filter(m => m.student_id);
  if (!clean.length) return { ok: false, status: 400, error: 'No valid marks.' };
  await store.enqueueChange(school_id, {
    type: 'attendance_mark',
    payload: { uuid: newRef(), user_id: rec.user_id, date, marks: clean },
  });
  return { ok: true, saved: clean.length, queued: true };
}

async function submitScores(store, school_id, rec, { subjectId, marks }) {
  const sid = parseInt(subjectId, 10);
  if (!sid || !Array.isArray(marks)) return { ok: false, status: 400, error: 'subjectId and marks[] are required.' };
  const clean = [];
  for (const m of marks) {
    const student = parseInt(m.student_id, 10);
    if (!student || m.exam_score === '' || m.exam_score == null) continue;
    const v = Number(m.exam_score);
    // Rejected here rather than silently dropped on the desktop, so the
    // teacher finds out while they are still looking at the sheet.
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      return { ok: false, status: 400, error: 'Exam scores must be between 0 and 100.' };
    }
    clean.push({ student_id: student, exam_score: v });
  }
  if (!clean.length) return { ok: false, status: 400, error: 'No marks to save.' };
  await store.enqueueChange(school_id, {
    type: 'score_entry',
    payload: { uuid: newRef(), user_id: rec.user_id, subject_id: sid, marks: clean },
  });
  return { ok: true, saved: clean.length, queued: true };
}

async function submitCanteen(store, school_id, rec, body) {
  const sid = parseInt(body.student_id, 10);
  const amount = Number(body.amount);
  if (!sid) return { ok: false, status: 400, error: 'student_id is required.' };
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, status: 400, error: 'A positive amount is required.' };
  // The uuid is what stops a redelivered change taking the money twice; the
  // desktop keeps a ledger of the ones it has applied.
  await store.enqueueChange(school_id, {
    type: 'canteen_collect',
    payload: {
      uuid: newRef(), user_id: rec.user_id, student_id: sid, amount,
      payment_method: body.payment_method || 'Cash', notes: body.notes || '',
    },
  });
  // No receipt number: the desktop issues those, and inventing one here would
  // put a number on a parent's phone that the school's books do not have.
  return { ok: true, queued: true, receipt_number: null };
}

async function submitHomework(store, school_id, rec, body) {
  const classId = parseInt(body.classId, 10);
  if (!classId || !body.title || !String(body.title).trim()) {
    return { ok: false, status: 400, error: 'Class and title are required.' };
  }
  await store.enqueueChange(school_id, {
    type: 'homework_create',
    payload: {
      uuid: newRef(), user_id: rec.user_id, class_id: classId,
      subject_id: body.subjectId || null, title: String(body.title).trim(),
      description: body.description || '', due_date: body.dueDate || null,
      max_marks: body.maxMarks === '' || body.maxMarks == null ? null : Number(body.maxMarks),
    },
  });
  return { ok: true, queued: true };
}

// How much of a teacher's work is still waiting for the school's desktop. Shown
// on their account screen: "3 changes waiting to reach the school" is the
// difference between trusting the app and wondering whether it saved anything.
async function pendingSummary(store, school_id, rec) {
  const items = await pending(store, school_id, WRITE_TYPES);
  const mine = items.filter(i => (i.payload || {}).user_id === rec.user_id);
  const byType = {};
  for (const i of mine) byType[i.type] = (byType[i.type] || 0) + 1;
  return { ok: true, pending: mine.length, by_type: byType };
}

module.exports = {
  WRITE_TYPES,
  verifyStaffPassword, signStaffToken, staffClaims, loadStaff, findStaffByUsername,
  can, canAny,
  dashboard, students, debtors, classes, attendanceSheet, scoreSubjects, scoreSheet,
  canteenStudent, timetableMine, homeworkForClass,
  submitAttendance, submitScores, submitCanteen, submitHomework, pendingSummary,
};
