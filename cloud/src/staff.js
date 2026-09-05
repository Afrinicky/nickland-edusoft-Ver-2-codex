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

const WRITE_TYPES = [
  'attendance_mark', 'score_entry', 'assessment_entry', 'term_remarks',
  'canteen_collect', 'homework_create', 'lesson_note_save',
  'leave_request', 'staff_clock', 'message_reply', 'announcement_create',
];

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

// ── teaching scope ──────────────────────────────────────────────────────────
// Permissions say whether a teacher may edit scores at all; this says whose.
// The desktop resolves it (electron/ipc/_scope.js) and projects the answer, so
// there is one implementation of "which classes are mine" rather than two that
// drift. Without it the cloud served every class in the school to every
// teacher — the desktop's rule, ignored the moment they picked up a phone.
function scopeOf(rec) {
  const s = (rec && rec.scope) || {};
  return {
    unrestricted: !!s.unrestricted || !!(rec && rec.is_admin),
    wholeClasses: new Set((s.whole_classes || []).map(Number)),
    classSubjects: new Map(Object.entries(s.class_subjects || {})
      .map(([k, v]) => [Number(k), new Set((v || []).map(Number))])),
    anyClassSubjects: new Set((s.any_class_subjects || []).map(Number)),
    classTeacherOf: new Set((s.class_teacher_of || []).map(Number)),
  };
}

function inScopeClass(rec, classId) {
  const sc = scopeOf(rec);
  if (sc.unrestricted) return true;
  const cid = Number(classId);
  if (!cid) return false;
  return sc.wholeClasses.has(cid) || sc.classSubjects.has(cid) || sc.anyClassSubjects.size > 0;
}

function inScopeSubject(rec, classId, subjectId) {
  const sc = scopeOf(rec);
  if (sc.unrestricted) return true;
  const cid = Number(classId); const sid = Number(subjectId);
  if (!cid || !sid) return false;
  if (sc.wholeClasses.has(cid)) return true;
  if (sc.anyClassSubjects.has(sid)) return true;
  const set = sc.classSubjects.get(cid);
  return !!(set && set.has(sid));
}

// The register and the canteen sheet belong to the one teacher answerable for
// the class, not to everyone who takes a subject in it.
function isClassTeacherOf(rec, classId) {
  const sc = scopeOf(rec);
  return sc.unrestricted || sc.classTeacherOf.has(Number(classId));
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

// The snapshot ROW, not just its payload. Anything that writes a projection
// back needs the row's version: the store keeps the higher version and drops
// the rest, and `payload.version` does not exist — reading it there yields
// undefined, so every write went up as version 2 and was silently ignored once
// the desktop had pushed a third.
async function snapshotRow(store, school_id, type, key) {
  const rows = await store.listSnapshots(school_id, type);
  return rows.find(r => r.entity_key === key) || null;
}

async function snapshotPayload(store, school_id, type, key) {
  const rows = await store.listSnapshots(school_id, type);
  const hit = key ? rows.find(r => r.entity_key === key) : rows[0];
  return hit ? hit.payload : null;
}

// `rec` filters the result to the teacher's own classes. Every staff read is
// built on this, so one filter here covers the class list, the students list,
// the registers and the score sheets alike.
async function allRosters(store, school_id, rec) {
  const rows = await store.listSnapshots(school_id, 'class_roster');
  let out = rows.map(r => r.payload).filter(Boolean);
  if (rec) out = out.filter(r => inScopeClass(rec, r.class_id));
  return out.sort((a, b) => (a.level_order || 0) - (b.level_order || 0) || String(a.name).localeCompare(String(b.name)));
}

// `rec` given, a class outside the teacher's scope resolves to nothing at all
// — the same answer as a class that does not exist, which is the answer a
// teacher who may not see it should get.
async function roster(store, school_id, classId, rec) {
  if (rec && !inScopeClass(rec, classId)) return null;
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

async function students(store, school_id, classId, rec) {
  const rosters = await allRosters(store, school_id, rec);
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

async function classes(store, school_id, rec) {
  const rosters = await allRosters(store, school_id, rec);
  return { ok: true, classes: rosters.map(r => ({ id: r.class_id, name: r.name, short_code: r.short_code })) };
}

// The register for a class on a date: what the desktop last projected, with
// anything this school has queued since merged over the top.
async function attendanceSheet(store, school_id, classId, date, rec) {
  const r = await roster(store, school_id, classId, rec);
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

async function scoreSubjects(store, school_id, classId, rec) {
  const r = await roster(store, school_id, classId, rec);
  let subjects = (r && r.subjects) || [];
  // A teacher who visits a class for one subject is offered that subject and
  // no other — being shown the rest and refused on choosing one is exactly
  // what the school asked us to stop doing.
  if (rec) subjects = subjects.filter(sub => inScopeSubject(rec, classId, sub.id));
  return { ok: true, subjects };
}

async function scoreSheet(store, school_id, classId, subjectId, rec) {
  if (rec && !inScopeSubject(rec, classId, subjectId)) return { ok: true, term: null, students: [] };
  const r = await roster(store, school_id, classId, rec);
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
async function canteenStudent(store, school_id, studentId, rec) {
  const s = await snapshotPayload(store, school_id, 'student_snapshot', `student:${studentId}`);
  if (!s) return { ok: false, status: 404, error: 'Student not found.' };
  // Taking canteen money is the class teacher's job, so a pupil outside their
  // class is not theirs to collect from. Answered as not-found rather than
  // forbidden: which pupils exist in another class is not their business
  // either.
  if (rec && s.class_id && !isClassTeacherOf(rec, s.class_id)) {
    return { ok: false, status: 404, error: 'Student not found.' };
  }
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

async function homeworkForClass(store, school_id, classId, rec) {
  const r = await roster(store, school_id, classId, rec);
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

// ── a pupil's record ────────────────────────────────────────────────────────
// Assembled from the two projections that already exist rather than a third:
// the class roster holds who is in the class and their guardians, and the
// parent-side student snapshot holds the fees, the canteen, the attendance
// summary and the report. Nothing new has to be kept in step.
async function studentProfile(store, school_id, studentId, rec) {
  const snap = await snapshotPayload(store, school_id, 'student_snapshot', `student:${studentId}`);
  if (!snap) return { ok: false, status: 404, error: 'Student not found.' };
  if (rec && !inScopeClass(rec, snap.class_id)) return { ok: false, status: 404, error: 'Student not found.' };

  const r = snap.class_id ? await roster(store, school_id, snap.class_id, rec) : null;
  const inRoster = r ? (r.students || []).find(s => String(s.id) === String(studentId)) : null;
  const summary = r && r.summaries ? r.summaries[studentId] : null;
  const rep = snap.report || null;

  return {
    ok: true,
    term: snap.term ? { label: snap.term } : null,
    student: {
      id: snap.student_id, index_number: snap.index_number, name: snap.name,
      class_id: snap.class_id || null, class_name: snap.class_name || (r ? r.name : null),
    },
    guardians: (inRoster && inRoster.guardians) || [],
    attendance: snap.attendance || { present: 0, absent: 0, total: 0 },
    recent_attendance: [],
    fees: can(rec, 'fees', 'view') ? (snap.fees || null) : null,
    canteen: can(rec, 'canteen', 'view') ? (snap.canteen || null) : null,
    subjects: rep ? (rep.subjects || []).map(x => ({ subject: x.subject, total_score: x.total, grade_remark: x.grade })) : [],
    summary: summary || (rep ? {
      average_score: rep.average, class_rank: rep.rank,
      number_on_roll: rep.number_on_roll, teacher_remarks: rep.remarks,
    } : null),
    homework: snap.homework || [],
    stale: true,
  };
}

// ── register history ────────────────────────────────────────────────────────
// The roster carries a fortnight of registers, which is what the projection
// deliberately keeps. Anything queued but not yet applied is merged over it, so
// a teacher who marked yesterday from home sees yesterday marked.
async function attendanceHistory(store, school_id, classId, days, rec) {
  const r = await roster(store, school_id, classId, rec);
  if (!r) return { ok: true, days: [], students: [], marked_days: 0 };

  const byDate = {};
  for (const [date, marks] of Object.entries(r.attendance || {})) byDate[date] = { ...marks };
  for (const ch of await pending(store, school_id, ['attendance_mark'])) {
    const p = ch.payload || {};
    if (!p.date) continue;
    const bucket = (byDate[p.date] ||= {});
    for (const m of p.marks || []) bucket[m.student_id] = { status: m.status, notes: m.notes || null };
  }

  const perStudent = new Map((r.students || []).map(
    s => [String(s.id), { present: 0, absent: 0, late: 0, total: 0, reasons: [] }]));
  const dayRows = [];
  // Newest day first, so the capped list of reasons below is the recent ones.
  for (const [date, marks] of Object.entries(byDate).sort((a, b) => (a[0] < b[0] ? 1 : -1))) {
    const row = { date, present: 0, absent: 0, late: 0, total: 0 };
    for (const [sid, m] of Object.entries(marks)) {
      row.total++;
      const key = m.status === 'absent' ? 'absent' : m.status === 'late' ? 'late' : 'present';
      row[key]++;
      const p = perStudent.get(String(sid));
      if (p) {
        p.total++; p[key]++;
        // The reason travels with the count. Capturing why a child was away is
        // only worth doing if somebody can read it back afterwards.
        if (m.notes && p.reasons.length < 6) p.reasons.push({ date, status: m.status, reason: m.notes });
      }
    }
    dayRows.push(row);
  }
  const limited = days ? dayRows.slice(0, days) : dayRows;

  return {
    ok: true,
    marked_days: limited.length,
    window_days: r.attendance_days || null,
    days: limited,
    students: (r.students || []).map(s => ({
      id: s.id, index_number: s.index_number, name: s.name, ...perStudent.get(String(s.id)),
    })),
  };
}

// ── continuous assessment ───────────────────────────────────────────────────
async function assessmentSheet(store, school_id, classId, subjectId, rec) {
  if (rec && !inScopeSubject(rec, classId, subjectId)) return { ok: true, term: null, columns: [], students: [] };
  const r = await roster(store, school_id, classId, rec);
  if (!r) return { ok: true, term: null, columns: [], students: [] };
  const bucket = (r.assessments || {})[subjectId] || { columns: [], marks: {} };

  const marks = {};
  for (const [sid, cols] of Object.entries(bucket.marks || {})) marks[sid] = { ...cols };
  const queued = new Set();
  for (const ch of await pending(store, school_id, ['assessment_entry'])) {
    const p = ch.payload || {};
    if (String(p.class_id) !== String(classId) || String(p.subject_id) !== String(subjectId)) continue;
    for (const m of p.marks || []) {
      const row = (marks[m.student_id] ||= {});
      if (m.marks === '' || m.marks == null) delete row[m.column_id];
      else row[m.column_id] = m.marks;
      queued.add(String(m.student_id));
    }
  }

  return {
    ok: true,
    term: r.term || null,
    weights: r.weights || null,
    // Columns are created on the desktop: a new one has to exist before marks
    // can hang off it, and inventing an id here would leave the desktop with
    // marks pointing at nothing.
    can_add_columns: false,
    columns: bucket.columns || [],
    students: (r.students || []).map(s => ({
      id: s.id, index_number: s.index_number, name: s.name,
      marks: marks[s.id] || {},
      pending: queued.has(String(s.id)) || undefined,
    })),
  };
}

// ── the broadsheet ──────────────────────────────────────────────────────────
async function resultsBroadsheet(store, school_id, classId, rec) {
  const r = await roster(store, school_id, classId, rec);
  if (!r) return { ok: true, term: null, subjects: [], students: [] };
  let subjects = r.subjects || [];
  if (rec) subjects = subjects.filter(sub => inScopeSubject(rec, classId, sub.id));
  const summaries = r.summaries || {};
  const scores = r.scores || {};

  return {
    ok: true,
    term: r.term || null,
    subjects,
    students: (r.students || []).map(s => {
      const sum = summaries[s.id] || null;
      return {
        id: s.id, index_number: s.index_number, name: s.name,
        scores: Object.fromEntries(subjects.map(sub => [sub.id, (scores[sub.id] || {})[s.id] || null])),
        total: sum ? sum.total_score_all : null,
        average: sum ? sum.average_score : null,
        rank: sum ? sum.class_rank : null,
        number_on_roll: sum ? sum.number_on_roll : null,
      };
    }),
    stale: true,
  };
}

async function studentReport(store, school_id, studentId, rec) {
  const p = await studentProfile(store, school_id, studentId, rec);
  if (!p.ok) return p;
  const r = p.student.class_id ? await roster(store, school_id, p.student.class_id, rec) : null;
  return {
    ok: true,
    term: p.term,
    student: p.student,
    subjects: p.subjects,
    summary: p.summary,
    attendance: p.attendance,
    grading_bands: (r && r.grading_bands) || [],
    stale: true,
  };
}

// ── the canteen sheet ───────────────────────────────────────────────────────
async function canteenClass(store, school_id, classId, rec) {
  if (rec && !isClassTeacherOf(rec, classId)) {
    return { ok: false, status: 403, error: 'The canteen sheet belongs to the class teacher.' };
  }
  const r = await roster(store, school_id, classId, rec);
  if (!r) return { ok: true, students: [], totals: { owing: 0, amount: 0 } };
  const owed = r.canteen || {};
  const rows = (r.students || []).map(s => ({
    id: s.id, index_number: s.index_number, name: s.name,
    unpaid_days: (owed[s.id] || {}).unpaid_days || 0,
    amount_owed: (owed[s.id] || {}).amount_owed || 0,
    today_status: null,
  }));
  return {
    ok: true,
    date: new Date().toISOString().slice(0, 10),
    daily_rate: r.daily_rate || null,
    term: r.term || null,
    students: rows,
    totals: { owing: rows.filter(x => x.unpaid_days > 0).length, amount: rows.reduce((n, x) => n + x.amount_owed, 0) },
    stale: true,
  };
}

// ── subjects, for pickers that are not tied to one class ────────────────────
async function allSubjects(store, school_id, rec, classId) {
  if (classId) return scoreSubjects(store, school_id, classId, rec);
  const rosters = await allRosters(store, school_id, rec);
  const seen = new Map();
  for (const r of rosters) for (const sub of r.subjects || []) if (!seen.has(sub.id)) seen.set(sub.id, sub);
  return { ok: true, subjects: [...seen.values()].sort((a, b) => String(a.name).localeCompare(String(b.name))) };
}

// ── the teacher's own employment ────────────────────────────────────────────
// One projection, keyed by user, so the cloud can only ever serve a teacher
// their own record. Queued work is merged in so a leave request filed on the
// bus shows as pending rather than vanishing until the school syncs.
async function staffProfile(store, school_id, rec) {
  const p = await snapshotPayload(store, school_id, 'staff_profile', `profile:user:${rec.user_id}`);
  const base = p || { has_staff: false, staff: null, assignments: [], lesson_notes: [], leave: [], attendance: [], payslips: [] };
  const today = new Date().toISOString().slice(0, 10);

  const attendance = [...(base.attendance || [])];
  for (const ch of await pending(store, school_id, ['staff_clock'])) {
    const q = ch.payload || {};
    if (q.user_id !== rec.user_id || !q.date) continue;
    const hit = attendance.find(a => a.date === q.date);
    if (hit) {
      if (q.direction === 'out') hit.clock_out = hit.clock_out || q.at;
      else hit.clock_in = hit.clock_in || q.at;
      hit.pending = true;
    } else {
      attendance.unshift({
        date: q.date, status: 'present', pending: true,
        clock_in: q.direction === 'out' ? null : q.at,
        clock_out: q.direction === 'out' ? q.at : null,
      });
    }
  }

  const leave = [...(base.leave || [])];
  for (const ch of await pending(store, school_id, ['leave_request'])) {
    const q = ch.payload || {};
    if (q.user_id !== rec.user_id) continue;
    leave.unshift({
      id: null, leave_type: q.leave_type, start_date: q.start_date, end_date: q.end_date,
      days_requested: q.days_requested, justification: q.justification,
      status: 'pending', pending: true,
    });
  }

  return {
    ok: true,
    has_staff: !!base.has_staff,
    staff: base.staff || null,
    designation: rec.designation || null,
    is_admin: !!rec.is_admin,
    assignments: base.assignments || [],
    today: { date: today, attendance: attendance.find(a => a.date === today) || null },
    attendance,
    leave: { pending: leave.filter(l => l.status === 'pending').length, approved: leave.filter(l => l.status === 'approved').length },
    leave_requests: leave,
    payslips: base.payslips || [],
    updated_at: base.updated_at || null,
  };
}

async function lessonNotes(store, school_id, rec) {
  const p = await snapshotPayload(store, school_id, 'staff_profile', `profile:user:${rec.user_id}`);
  const notes = [...((p && p.lesson_notes) || [])];
  for (const ch of await pending(store, school_id, ['lesson_note_save'])) {
    const q = ch.payload || {};
    if (q.user_id !== rec.user_id) continue;
    const note = { id: q.local_id || null, ...(q.note || {}), pending: true, queue_ref: q.uuid };
    // An edit queued for a note that is already projected replaces it in the
    // list, rather than showing the teacher two copies of the same lesson.
    const at = q.local_id ? notes.findIndex(n => String(n.id) === String(q.local_id)) : -1;
    if (at >= 0) notes[at] = { ...notes[at], ...note };
    else notes.unshift(note);
  }
  return { ok: true, has_staff: !!(p && p.has_staff), notes };
}

async function lessonNote(store, school_id, rec, id) {
  const { notes } = await lessonNotes(store, school_id, rec);
  const note = notes.find(n => String(n.id) === String(id));
  return note ? { ok: true, note } : { ok: false, status: 404, error: 'Lesson note not found.' };
}

// ── messages and notices ────────────────────────────────────────────────────
// Threads are already projected for the parent portal; the staff side reads the
// same records. A reply is queued and shown at once, because a teacher who
// types a reply and sees nothing types it again.
async function staffThreads(store, school_id, rec) {
  if (!can(rec, 'notifications', 'view')) return { ok: false, status: 403, error: 'Access denied.' };
  const rows = await store.listSnapshots(school_id, 'message_thread');
  const threads = rows.map(r => r.payload).filter(Boolean).map(t => ({
    id: t.uuid, uuid: t.uuid, parent_id: t.parent_id, student_id: t.student_id,
    student_name: t.student_name, subject: t.subject,
    last_message_at: t.last_message_at, last_sender: t.last_sender,
    staff_unread: 0,
    preview: (t.messages && t.messages.length) ? String(t.messages[t.messages.length - 1].body).slice(0, 120) : '',
  }));
  threads.sort((a, b) => String(b.last_message_at || '').localeCompare(String(a.last_message_at || '')));
  return { ok: true, threads, unread: 0, stale: true };
}

async function staffThread(store, school_id, rec, uuid) {
  if (!can(rec, 'notifications', 'view')) return { ok: false, status: 403, error: 'Access denied.' };
  const t = await snapshotPayload(store, school_id, 'message_thread', `thread:${uuid}`);
  if (!t) return { ok: false, status: 404, error: 'Conversation not found.' };
  const messages = [...(t.messages || [])];
  for (const ch of await pending(store, school_id, ['message_reply'])) {
    const q = ch.payload || {};
    if (q.thread_uuid !== uuid) continue;
    messages.push({ sender_type: 'staff', sender_name: q.sender_name || 'You', body: q.body, created_at: null, pending: true });
  }
  return {
    ok: true,
    thread: { id: t.uuid, uuid: t.uuid, subject: t.subject, student_name: t.student_name, parent_id: t.parent_id },
    messages,
  };
}

async function submitMessage(store, school_id, rec, body) {
  if (!can(rec, 'notifications', 'create')) return { ok: false, status: 403, error: 'Access denied.' };
  if (!body.body || !String(body.body).trim()) return { ok: false, status: 400, error: 'Type a message first.' };
  // Starting a brand-new conversation needs a parent record the cloud does not
  // hold, so replying is what works off-LAN and the app says so.
  if (!body.threadUuid && !body.parentId) {
    return { ok: false, status: 400, error: "Starting a new conversation needs the school's own system. You can reply to any existing conversation from here." };
  }
  await store.enqueueChange(school_id, {
    type: 'message_reply',
    payload: {
      uuid: newRef(), user_id: rec.user_id, sender_name: rec.full_name || null,
      thread_uuid: body.threadUuid || null,
      parent_id: body.parentId || null, student_id: body.studentId || null,
      subject: body.subject || null, body: String(body.body).trim(),
    },
  });
  return { ok: true, queued: true };
}

async function announcements(store, school_id, rec) {
  if (!can(rec, 'notifications', 'view')) return { ok: false, status: 403, error: 'Access denied.' };
  const rows = await store.listSnapshots(school_id, 'announcement');
  const list = rows.map(r => r.payload).filter(a => a && a.is_active !== 0);
  for (const ch of await pending(store, school_id, ['announcement_create'])) {
    const q = ch.payload || {};
    list.unshift({ id: null, title: q.title, body: q.body, audience: q.audience, created_at: null, pending: true });
  }
  list.sort((a, b) => (a.pending ? -1 : b.pending ? 1 : String(b.created_at || '').localeCompare(String(a.created_at || ''))));
  return { ok: true, announcements: list };
}

async function submitAnnouncement(store, school_id, rec, body) {
  if (!can(rec, 'notifications', 'edit')) return { ok: false, status: 403, error: 'You cannot post announcements.' };
  if (!body.title || !body.body) return { ok: false, status: 400, error: 'A title and a message are required.' };
  await store.enqueueChange(school_id, {
    type: 'announcement_create',
    payload: {
      uuid: newRef(), user_id: rec.user_id,
      title: String(body.title).slice(0, 200), body: String(body.body).slice(0, 4000),
      audience: body.audience === 'student' ? 'student' : 'all',
      student_id: body.studentId || null,
    },
  });
  return { ok: true, queued: true };
}

// ── writes ──────────────────────────────────────────────────────────────────
// Each one appends to the change queue and returns immediately. Nothing here
// touches a read model: the desktop applies the change and re-projects, which
// is what keeps one implementation of "what marking a register means".

function newRef() {
  try { return crypto.randomUUID(); }
  catch (_) { return 'ref_' + crypto.randomBytes(16).toString('hex'); }
}

async function submitAttendance(store, school_id, rec, { date, marks, classId }) {
  // The register belongs to the class teacher. Queueing a write the desktop
  // will drop tells the teacher their work is safe when it is not.
  if (classId && !isClassTeacherOf(rec, classId)) {
    return { ok: false, status: 403, error: 'That register belongs to another class teacher.' };
  }
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

async function submitScores(store, school_id, rec, { subjectId, marks, classId }) {
  if (classId && !inScopeSubject(rec, classId, subjectId)) {
    return { ok: false, status: 403, error: 'That subject is not one of yours in that class.' };
  }
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
  if (classId && !inScopeClass(rec, classId)) {
    return { ok: false, status: 403, error: 'That class is not one of yours.' };
  }
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

async function submitAssessments(store, school_id, rec, { classId, subjectId, marks }) {
  const cid = parseInt(classId, 10); const sid = parseInt(subjectId, 10);
  if (!cid || !sid) return { ok: false, status: 400, error: 'classId and subjectId are required.' };
  if (!inScopeSubject(rec, cid, sid)) return { ok: false, status: 403, error: 'That subject is not one of yours in that class.' };
  if (!Array.isArray(marks) || !marks.length) return { ok: false, status: 400, error: 'No marks to save.' };

  // The column's total is on the roster, so an impossible mark is caught while
  // the teacher is still looking at the sheet rather than dropped in silence a
  // day later when the desktop applies the change.
  const r = await roster(store, school_id, cid, rec);
  const cols = Object.fromEntries((((r && r.assessments) || {})[sid] || { columns: [] }).columns.map(c => [String(c.id), c]));
  const clean = [];
  for (const m of marks) {
    const student = parseInt(m.student_id, 10);
    const col = cols[String(m.column_id)];
    if (!student || !col) continue;
    if (m.marks === '' || m.marks == null) { clean.push({ student_id: student, column_id: col.id, marks: null }); continue; }
    const v = Number(m.marks);
    if (!Number.isFinite(v) || v < 0) return { ok: false, status: 400, error: 'Marks cannot be negative.' };
    if (v > col.max_marks) return { ok: false, status: 400, error: `A mark of ${v} is above the ${col.max_marks} this assessment is out of.` };
    clean.push({ student_id: student, column_id: col.id, marks: v });
  }
  if (!clean.length) return { ok: false, status: 400, error: 'No marks to save.' };

  await store.enqueueChange(school_id, {
    type: 'assessment_entry',
    payload: { uuid: newRef(), user_id: rec.user_id, class_id: cid, subject_id: sid, marks: clean },
  });
  return { ok: true, saved: clean.length, queued: true };
}

async function submitRemarks(store, school_id, rec, body) {
  const sid = parseInt(body.studentId, 10);
  if (!sid) return { ok: false, status: 400, error: 'studentId is required.' };
  const snap = await snapshotPayload(store, school_id, 'student_snapshot', `student:${sid}`);
  if (!snap) return { ok: false, status: 404, error: 'Student not found.' };
  if (!isClassTeacherOf(rec, snap.class_id)) {
    return { ok: false, status: 403, error: 'Only the class teacher can write end-of-term remarks for this class.' };
  }
  const trim = (v, n) => (v == null ? null : String(v).slice(0, n));
  await store.enqueueChange(school_id, {
    type: 'term_remarks',
    payload: {
      uuid: newRef(), user_id: rec.user_id, student_id: sid,
      conduct: trim(body.conduct, 500), interests: trim(body.interests, 500),
      talents: trim(body.talents, 500), remarks: trim(body.remarks, 1000),
    },
  });
  return { ok: true, queued: true };
}

// A lesson note written on the way home. `local_id` is the desktop's own id
// when the note already exists there — an edit updates it rather than filing a
// second copy of the same lesson.
async function submitLessonNote(store, school_id, rec, body) {
  if (!body.topic || !String(body.topic).trim()) return { ok: false, status: 400, error: 'A topic is required.' };
  const classId = body.classId ? parseInt(body.classId, 10) : null;
  if (classId && !inScopeClass(rec, classId)) return { ok: false, status: 403, error: 'That class is not one of yours.' };
  const note = {
    class_group_id: classId,
    subject_id: body.subjectId ? parseInt(body.subjectId, 10) : null,
    week_number: body.weekNumber ? parseInt(body.weekNumber, 10) : null,
    lesson_date: body.lessonDate || null,
    duration_minutes: body.durationMinutes ? parseInt(body.durationMinutes, 10) : null,
    topic: String(body.topic).trim().slice(0, 300),
    sub_topic: body.subTopic || null,
    references_text: body.references || null,
    tlms: body.tlms || null,
    objectives: body.objectives || null,
    rpk: body.rpk || null,
    introduction: body.introduction || null,
    presentation: body.presentation || null,
    activity: body.activity || null,
    evaluation: body.evaluation || null,
    closure: body.closure || null,
    assignment: body.assignment || null,
    remarks: body.remarks || null,
    status: body.status === 'submitted' ? 'submitted' : 'draft',
  };
  await store.enqueueChange(school_id, {
    type: 'lesson_note_save',
    payload: { uuid: newRef(), user_id: rec.user_id, local_id: body.id ? parseInt(body.id, 10) : null, note },
  });
  return { ok: true, queued: true };
}

async function submitLeave(store, school_id, rec, body) {
  const { leaveType, startDate, endDate, justification } = body;
  if (!leaveType || !startDate || !endDate) return { ok: false, status: 400, error: 'Leave type and both dates are required.' };
  if (!justification || !String(justification).trim()) return { ok: false, status: 400, error: 'A reason is required.' };
  const start = new Date(startDate); const end = new Date(endDate);
  if (isNaN(start) || isNaN(end)) return { ok: false, status: 400, error: 'Those dates could not be read. Use YYYY-MM-DD.' };
  if (end < start) return { ok: false, status: 400, error: 'The end date cannot be before the start date.' };
  const days = Math.round((end - start) / 86400000) + 1;
  if (days > 365) return { ok: false, status: 400, error: 'A single request cannot cover more than a year.' };
  await store.enqueueChange(school_id, {
    type: 'leave_request',
    payload: {
      uuid: newRef(), user_id: rec.user_id, leave_type: String(leaveType).slice(0, 60),
      start_date: startDate, end_date: endDate, days_requested: days,
      justification: String(justification).trim().slice(0, 1000),
    },
  });
  return { ok: true, queued: true, days_requested: days };
}

async function submitClock(store, school_id, rec, body) {
  const direction = body.direction === 'out' ? 'out' : 'in';
  const now = new Date();
  await store.enqueueChange(school_id, {
    type: 'staff_clock',
    payload: {
      uuid: newRef(), user_id: rec.user_id, direction,
      date: now.toISOString().slice(0, 10), at: now.toTimeString().slice(0, 8),
    },
  });
  return { ok: true, queued: true };
}

// ── passwords ───────────────────────────────────────────────────────────────
// A teacher away from the school still has to be able to change a password, and
// still forgets one. Both are handled here, and both keep the desktop as the
// authority:
//
//   • Changing one is verified against the projected hash and applied to the
//     projection at once, so the new password works on the next request rather
//     than after the school's computer next syncs. The change is queued for the
//     desktop as a bcrypt hash — never a password.
//
//   • Forgetting one raises a request for the Super Admin to approve ON THE
//     DESKTOP. The cloud cannot approve anything: approval is a person
//     recognising another person. Once approved, the desktop projects the hash
//     of the six-digit code, and only then can the cloud check one.

const BCRYPT_ROUNDS = 10;

function hashPassword(password) {
  return bcrypt().hashSync(String(password), BCRYPT_ROUNDS);
}

function sha256(v) { return crypto.createHash('sha256').update(String(v)).digest('hex'); }

// Reflect a new hash into the read model so the account keeps working over the
// internet, and queue the same change for the desktop to apply for real.
async function persistNewPassword(store, school_id, rec, newHash, source) {
  const key = `user:${rec.user_id}`;
  const row = await snapshotRow(store, school_id, 'staff_auth', key);
  await store.upsertSnapshot(school_id, {
    entity_type: 'staff_auth',
    entity_key: key,
    uuid: row ? row.uuid : undefined,
    op: 'upsert',
    version: ((row && row.version) || 1) + 1,
    payload: { ...rec, password_hash: newHash, must_change_password: false },
  });
  await store.enqueueChange(school_id, {
    type: 'staff_password_change',
    payload: { uuid: newRef(), user_id: rec.user_id, new_hash: newHash, source },
  });
}

async function changePassword(store, school_id, rec, { currentPassword, newPassword }, source) {
  if (!newPassword || String(newPassword).length < 6) {
    return { ok: false, status: 400, error: 'New password must be at least 6 characters.' };
  }
  if (!verifyStaffPassword(currentPassword, rec.password_hash)) {
    return { ok: false, status: 401, error: 'Your current password is not correct.' };
  }
  if (String(currentPassword) === String(newPassword)) {
    return { ok: false, status: 400, error: 'The new password must be different from the current one.' };
  }
  await persistNewPassword(store, school_id, rec, hashPassword(newPassword), source || 'mobile');
  return { ok: true, queued: true };
}

async function requestPasswordReset(store, school_id, { username, reason }, source) {
  const u = String(username || '').trim();
  if (!u) return { ok: false, status: 400, error: 'Enter your username.' };
  // Queued whether or not the account exists. The answer must not tell an
  // anonymous caller which usernames are real, and the desktop drops the ones
  // that match nothing.
  await store.enqueueChange(school_id, {
    type: 'staff_password_reset_request',
    payload: {
      uuid: newRef(), username: u,
      reason: String(reason || '').slice(0, 500),
      source: source === 'web' ? 'web' : 'mobile',
    },
  });
  return { ok: true, submitted: true };
}

// Redeem a code the Super Admin approved on the desktop. The claim reaches the
// cloud only as a hash, so a code cannot be read out of the projection.
async function completePasswordReset(store, school_id, { username, code, newPassword }, source) {
  const u = String(username || '').trim();
  if (!u || !code) return { ok: false, status: 400, error: 'Enter your username and the approval code.' };
  if (!newPassword || String(newPassword).length < 6) {
    return { ok: false, status: 400, error: 'Password must be at least 6 characters.' };
  }

  const claim = await snapshotPayload(store, school_id, 'staff_reset_claim', `claim:${u}`);
  const generic = { ok: false, status: 400, error: 'That approval code is not correct, or has expired.' };
  if (!claim || !claim.claim_hash) return generic;
  if (claim.expires_at && new Date(String(claim.expires_at).replace(' ', 'T') + 'Z') < new Date()) return generic;

  const given = sha256(String(code).trim());
  let match = false;
  try {
    const a = Buffer.from(given, 'hex');
    const b = Buffer.from(String(claim.claim_hash), 'hex');
    match = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) { match = false; }
  if (!match) return generic;

  const rec = await loadStaff(store, school_id, claim.user_id);
  if (!rec) return { ok: false, status: 401, error: 'That account is not available.' };

  await persistNewPassword(store, school_id, rec, hashPassword(newPassword), source || 'mobile');
  // Spend the claim here too. The desktop retires its own copy when it applies
  // the change; withdrawing the projection now stops the same code being used
  // twice in the meantime — which it only does if the version moves past the
  // one the desktop pushed, or the store keeps the live claim and the code
  // stays a standing key to the account.
  const claimRow = await snapshotRow(store, school_id, 'staff_reset_claim', `claim:${u}`);
  await store.upsertSnapshot(school_id, {
    entity_type: 'staff_reset_claim', entity_key: `claim:${u}`,
    uuid: claimRow ? claimRow.uuid : undefined,
    op: 'delete', version: ((claimRow && claimRow.version) || 1) + 1,
    payload: { username: u, user_id: claim.user_id, claim_hash: null, expires_at: null },
  });
  return { ok: true };
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
  studentProfile, attendanceHistory, assessmentSheet, resultsBroadsheet, studentReport,
  canteenClass, allSubjects, staffProfile, lessonNotes, lessonNote,
  staffThreads, staffThread, announcements,
  submitAttendance, submitScores, submitCanteen, submitHomework, pendingSummary,
  submitAssessments, submitRemarks, submitLessonNote, submitLeave, submitClock,
  submitMessage, submitAnnouncement,
  changePassword, requestPasswordReset, completePasswordReset,
  inScopeClass, inScopeSubject, isClassTeacherOf,
};
