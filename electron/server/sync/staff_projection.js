// Nickland Edusoft — projecting the STAFF read model to the cloud.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The parent read model (student_snapshot, receipt, announcement, parent_auth)
// lets a parent check a fee balance while the school desktop is off. This is
// the same idea for teachers: enough for a teacher to sign in from home, see
// their classes, and mark a register — with the desktop switched off — and have
// the work land in the school's database when it next syncs.
//
// What is projected, and deliberately nothing more:
//
//   staff_auth        user:<id>      who may sign in, and what they may do
//   class_roster      class:<id>     the class, its pupils, subjects, the marks
//                                    already entered, and recent attendance
//   school_metrics    metrics:school the dashboard's four numbers
//   debtor_list       debtors:school outstanding fees
//   staff_timetable   timetable:<id> one teacher's week
//
// This stays a THIN read model. It carries what a teacher's screens display,
// not the school's database: no financial ledger, no payroll, no history beyond
// the current term, and attendance only as far back as a register is realistically
// corrected. The desktop remains the source of truth, and every write a teacher
// makes off-LAN goes back through the change queue for the desktop to apply.

const { postToOutbox, syncEnabled } = require('./outbox');
const { getSetting } = require('../../utils/idgen');

// How much attendance history a teacher can see and correct from off-LAN. Two
// school weeks: enough to fix last week's register, small enough that a class
// snapshot stays a few kilobytes.
const ATTENDANCE_DAYS = 14;

function currentTerm(db) {
  try { return db.prepare('SELECT id, label FROM terms WHERE is_current = 1').get() || null; }
  catch (_) { return null; }
}

function fullName(s) {
  return `${s.surname} ${s.first_name} ${s.other_names || ''}`.trim();
}

// ── staff_auth ──────────────────────────────────────────────────────────────
// The account itself: the bcrypt hash the desktop already stores (never the
// password), plus the resolved permission map so the cloud enforces exactly
// what the desktop would. Permissions are resolved here rather than in the
// cloud because designation defaults, per-user overrides and the module list
// all live on the desktop — projecting the *answer* keeps one implementation.
// The teaching scope, flattened for the cloud: plain arrays, because a Set
// does not survive JSON and the cloud has no database to resolve ids against.
function teachingScope(db, u) {
  const unrestricted = ['Proprietor', 'Administrator', 'Head Teacher'].includes(u.designation);
  const scope = {
    unrestricted,
    whole_classes: [], class_subjects: {}, any_class_subjects: [], class_teacher_of: [],
  };
  if (unrestricted || !u.staff_id) return scope;

  let rows = [];
  try {
    rows = db.prepare(`
      SELECT class_group_id, subject_id, is_class_teacher
      FROM staff_assignments WHERE staff_id = ?
    `).all(u.staff_id);
  } catch (_) { return scope; }

  for (const r of rows) {
    const cid = r.class_group_id == null ? null : Number(r.class_group_id);
    const sid = r.subject_id == null ? null : Number(r.subject_id);
    if (cid && !sid) scope.whole_classes.push(cid);
    else if (cid && sid) (scope.class_subjects[cid] ||= []).push(sid);
    else if (!cid && sid) scope.any_class_subjects.push(sid);
    if (cid && r.is_class_teacher) scope.class_teacher_of.push(cid);
  }
  return scope;
}

function enqueueStaffAuth(db, userId) {
  try {
    if (!syncEnabled(db)) return null;
    const u = db.prepare(`
      SELECT u.id, u.username, u.full_name, u.password_hash, u.is_active, u.staff_id,
             u.must_change_password, d.name AS designation
      FROM users u LEFT JOIN designations d ON d.id = u.designation_id
      WHERE u.id = ?
    `).get(userId);
    if (!u) return null;

    let permissions = {};
    try { permissions = require('../../ipc/auth').resolveEffectivePermissions(db, userId); } catch (_) {}
    const isAdmin = ['Administrator', 'Proprietor'].includes(u.designation);

    return postToOutbox(db, {
      entity_type: 'staff_auth',
      entity_key: `user:${userId}`,
      op: u.is_active ? 'upsert' : 'delete',
      payload: {
        user_id: u.id,
        username: u.username,
        full_name: u.full_name,
        staff_id: u.staff_id || null,
        designation: u.designation || null,
        is_admin: isAdmin,
        // bcrypt, exactly as the desktop stores it. Both cloud twins verify
        // bcrypt directly, so a teacher's password is unchanged and nobody has
        // to be re-enrolled to work off-LAN.
        password_hash: u.password_hash,
        is_active: !!u.is_active,
        // Set when an administrator chose the password. The phone app asks for
        // a new one before it will go any further, exactly as the desktop does.
        must_change_password: !!u.must_change_password,
        // Which classes and subjects this account may reach. Without it the
        // cloud served every class in the school to every teacher — the same
        // rule the desktop enforces, ignored the moment they picked up a
        // phone. Shape matches electron/ipc/_scope.js.
        scope: teachingScope(db, u),
        permissions,
      },
    });
  } catch (_) { return null; }
}

// ── staff_reset_claim ───────────────────────────────────────────────────────
// A teacher who forgets their password while away from the school cannot be
// approved by anyone in the cloud — approval is a person recognising another
// person, and that happens on the desktop. What the cloud needs is only the
// ability to CHECK a code that has already been approved there, so an approved
// claim is projected: the hash of the code and when it stops working. The code
// itself is never here, and an unapproved request projects nothing at all.
function enqueueResetClaim(db, requestId) {
  try {
    if (!syncEnabled(db)) return null;
    const r = db.prepare('SELECT * FROM password_reset_requests WHERE id = ?').get(requestId);
    if (!r) return null;
    const live = r.status === 'approved' && r.claim_hash;
    return postToOutbox(db, {
      entity_type: 'staff_reset_claim',
      entity_key: `claim:${r.username}`,
      // Used, denied, expired: the projection is withdrawn, so a code that has
      // done its job on the desktop cannot still be spent over the internet.
      op: live ? 'upsert' : 'delete',
      payload: {
        username: r.username,
        user_id: r.user_id,
        claim_hash: live ? r.claim_hash : null,
        expires_at: live ? r.claim_expires_at : null,
        updated_at: new Date().toISOString(),
      },
    });
  } catch (_) { return null; }
}

// ── class_roster ────────────────────────────────────────────────────────────
// Everything the register, the score sheet and the class pickers need, in one
// record per class. One record rather than several because a teacher opening a
// class wants all of it at once, and because it keeps the number of projected
// entities proportional to classes rather than to pupils × subjects.
function enqueueClassRoster(db, classId) {
  try {
    if (!syncEnabled(db)) return null;
    const cls = db.prepare('SELECT id, name, short_code, level_order FROM class_groups WHERE id = ?').get(classId);
    if (!cls) return null;
    const term = currentTerm(db);

    const students = db.prepare(`
      SELECT id, index_number, surname, first_name, other_names
      FROM students WHERE current_class_id = ? AND status = 'Active'
      ORDER BY surname, first_name
    `).all(classId);
    const ids = students.map(s => s.id);
    const ph = ids.map(() => '?').join(',') || 'NULL';

    let subjects = [];
    try {
      subjects = db.prepare(`
        SELECT s.id, s.name, s.code FROM subjects s
        JOIN class_subjects cs ON cs.subject_id = s.id
        WHERE cs.class_group_id = ? AND s.is_active = 1 ORDER BY s.name
      `).all(classId);
      if (!subjects.length) subjects = db.prepare('SELECT id, name, code FROM subjects WHERE is_active = 1 ORDER BY name').all();
    } catch (_) {}

    // Marks already entered this term, as { subjectId: { studentId: score } } —
    // so a teacher sees what is already in before typing over it.
    const scores = {};
    try {
      if (term && ids.length) {
        const rows = db.prepare(`
          SELECT subject_id, student_id, exam_score, total_score
          FROM scores WHERE term_id = ? AND student_id IN (${ph})
        `).all(term.id, ...ids);
        for (const r of rows) {
          (scores[r.subject_id] ||= {})[r.student_id] = {
            exam_score: r.exam_score ?? null, total_score: r.total_score ?? null,
          };
        }
      }
    } catch (_) {}

    // Recent registers, as { 'YYYY-MM-DD': { studentId: {status, notes} } }.
    const attendance = {};
    try {
      if (ids.length) {
        const rows = db.prepare(`
          SELECT date, student_id, status, notes FROM student_attendance
          WHERE student_id IN (${ph}) AND date >= date('now', ?)
        `).all(...ids, `-${ATTENDANCE_DAYS} days`);
        for (const r of rows) {
          (attendance[r.date] ||= {})[r.student_id] = { status: r.status, notes: r.notes || null };
        }
      }
    } catch (_) {}

    let homework = [];
    try { homework = require('../../ipc/homework').listForClass(db, classId, { all: false }) || []; } catch (_) {}

    let timetable = null;
    try {
      const grid = require('../../ipc/timetable').getClassTimetable(db, classId);
      if (grid && (grid.periods || []).length) timetable = grid;
    } catch (_) {}

    return postToOutbox(db, {
      entity_type: 'class_roster',
      entity_key: `class:${classId}`,
      payload: {
        class_id: cls.id, name: cls.name, short_code: cls.short_code, level_order: cls.level_order,
        term: term ? { id: term.id, label: term.label } : null,
        students: students.map(s => ({ id: s.id, index_number: s.index_number, name: fullName(s) })),
        subjects, scores, attendance, homework, timetable,
        attendance_days: ATTENDANCE_DAYS,
        updated_at: new Date().toISOString(),
      },
    });
  } catch (_) { return null; }
}

// ── school_metrics ──────────────────────────────────────────────────────────
// The staff dashboard's four numbers. Projected whole rather than computed in
// the cloud, because the cloud has no bills, payments or staff table.
function enqueueSchoolMetrics(db) {
  try {
    if (!syncEnabled(db)) return null;
    const term = currentTerm(db);
    const students = db.prepare("SELECT COUNT(*) c FROM students WHERE status='Active'").get().c;
    let staff = 0;
    try { staff = db.prepare("SELECT COUNT(*) c FROM staff WHERE status='Active'").get().c; } catch (_) {}
    let collected = 0, outstanding = 0;
    if (term) {
      try { collected = db.prepare('SELECT COALESCE(SUM(amount),0) t FROM payments WHERE term_id=? AND is_reversed=0').get(term.id).t; } catch (_) {}
      try { outstanding = db.prepare("SELECT COALESCE(SUM(balance),0) t FROM student_bills WHERE term_id=? AND COALESCE(status,'active')='active'").get(term.id).t; } catch (_) {}
    }
    return postToOutbox(db, {
      entity_type: 'school_metrics',
      entity_key: 'metrics:school',
      payload: {
        term: term ? { id: term.id, label: term.label } : null,
        metrics: { students, staff, fees_collected: collected, fees_outstanding: outstanding },
        updated_at: new Date().toISOString(),
      },
    });
  } catch (_) { return null; }
}

// ── debtor_list ─────────────────────────────────────────────────────────────
function enqueueDebtors(db, limit = 300) {
  try {
    if (!syncEnabled(db)) return null;
    const term = currentTerm(db);
    let debtors = [];
    if (term) {
      debtors = db.prepare(`
        SELECT s.index_number, s.surname, s.first_name, c.name AS class_name, b.balance
        FROM student_bills b JOIN students s ON s.id = b.student_id
        LEFT JOIN class_groups c ON c.id = s.current_class_id
        WHERE b.term_id = ? AND b.balance > 0 AND s.status='Active'
          AND COALESCE(b.status, 'active') = 'active'
        ORDER BY b.balance DESC LIMIT ?
      `).all(term.id, limit);
    }
    return postToOutbox(db, {
      entity_type: 'debtor_list',
      entity_key: 'debtors:school',
      payload: { term: term ? { id: term.id, label: term.label } : null, debtors, updated_at: new Date().toISOString() },
    });
  } catch (_) { return null; }
}

// ── staff_timetable ─────────────────────────────────────────────────────────
// Keyed by user, not by staff record, because that is what the signed-in
// teacher's token resolves to in the cloud.
function enqueueStaffTimetable(db, userId) {
  try {
    if (!syncEnabled(db)) return null;
    const u = db.prepare('SELECT id, staff_id FROM users WHERE id = ?').get(userId);
    if (!u) return null;
    let days = [];
    if (u.staff_id) {
      try { days = (require('../../ipc/timetable').getTeacherTimetable(db, u.staff_id) || {}).days || []; } catch (_) {}
    }
    return postToOutbox(db, {
      entity_type: 'staff_timetable',
      entity_key: `timetable:user:${userId}`,
      payload: { user_id: userId, has_staff: !!u.staff_id, days, updated_at: new Date().toISOString() },
    });
  } catch (_) { return null; }
}

// Everything a teacher needs, for every class and every account. Called from
// the outbox backfill and after a change that can move any of it.
function enqueueAllStaff(db) {
  const counts = { staff: 0, classes: 0, metrics: 0, debtors: 0, timetables: 0 };
  if (!syncEnabled(db)) return counts;
  try {
    for (const u of db.prepare('SELECT id FROM users WHERE is_active = 1').all()) {
      if (enqueueStaffAuth(db, u.id)) counts.staff++;
      if (enqueueStaffTimetable(db, u.id)) counts.timetables++;
    }
  } catch (_) {}
  try {
    for (const c of db.prepare('SELECT id FROM class_groups').all()) {
      if (enqueueClassRoster(db, c.id)) counts.classes++;
    }
  } catch (_) {}
  if (enqueueSchoolMetrics(db)) counts.metrics++;
  if (enqueueDebtors(db)) counts.debtors++;
  return counts;
}

// The class a student sits in — so a write that touches one pupil refreshes the
// roster their teacher reads.
function classOfStudent(db, studentId) {
  try { return db.prepare('SELECT current_class_id AS id FROM students WHERE id = ?').get(studentId)?.id || null; }
  catch (_) { return null; }
}

function enqueueRostersForStudents(db, studentIds) {
  const seen = new Set();
  for (const sid of studentIds || []) {
    const cid = classOfStudent(db, sid);
    if (cid && !seen.has(cid)) { seen.add(cid); enqueueClassRoster(db, cid); }
  }
  return seen.size;
}

module.exports = {
  ATTENDANCE_DAYS,
  enqueueStaffAuth, enqueueClassRoster, enqueueSchoolMetrics, enqueueDebtors, enqueueResetClaim,
  enqueueStaffTimetable, enqueueAllStaff, enqueueRostersForStudents, classOfStudent,
};
