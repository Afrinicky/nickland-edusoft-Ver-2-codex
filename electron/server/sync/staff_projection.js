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

    // Continuous assessment: the columns a class+subject has this term and the
    // marks already in them. Without this a teacher off-LAN could enter the
    // end-of-term paper but not the class work weighted alongside it — and the
    // class score is what the report card actually carries.
    const assessments = {};
    try {
      if (term) {
        const cols = db.prepare(`
          SELECT id, subject_id, assessment_type, max_marks, display_order
          FROM assessment_columns WHERE class_group_id = ? AND term_id = ?
          ORDER BY display_order, id
        `).all(classId, term.id);
        if (cols.length) {
          const cph = cols.map(() => '?').join(',');
          const marks = db.prepare(`
            SELECT assessment_column_id, student_id, marks FROM assessment_scores
            WHERE assessment_column_id IN (${cph})
          `).all(...cols.map(c => c.id));
          const byCol = new Map(cols.map(c => [c.id, c.subject_id]));
          for (const c of cols) {
            const bucket = (assessments[c.subject_id] ||= { columns: [], marks: {} });
            bucket.columns.push({ id: c.id, assessment_type: c.assessment_type, max_marks: c.max_marks, display_order: c.display_order });
          }
          for (const m of marks) {
            const subId = byCol.get(m.assessment_column_id);
            if (subId == null) continue;
            const bucket = assessments[subId];
            ((bucket.marks[m.student_id] ||= {}))[m.assessment_column_id] = m.marks;
          }
        }
      }
    } catch (_) {}

    // The term summary behind the broadsheet: position, average, conduct and
    // the class teacher's remark.
    const summaries = {};
    try {
      if (term && ids.length) {
        for (const r of db.prepare(`
          SELECT student_id, total_score_all, average_score, class_rank, number_on_roll,
                 conduct_traits, learner_interests, learner_talents, teacher_remarks
          FROM student_term_summary WHERE term_id = ? AND student_id IN (${ph})
        `).all(term.id, ...ids)) summaries[r.student_id] = r;
      }
    } catch (_) {}

    // Who to ring about a pupil. A teacher's most common off-LAN question is
    // "whose number is this" and it is the one thing the app could not answer.
    const guardians = {};
    try {
      if (ids.length) {
        for (const r of db.prepare(`
          SELECT id, father_name, father_contact, mother_name, mother_contact, guardian_name, guardian_contact
          FROM students WHERE id IN (${ph})
        `).all(...ids)) {
          guardians[r.id] = [
            { relation: 'Father', name: r.father_name, contact: r.father_contact },
            { relation: 'Mother', name: r.mother_name, contact: r.mother_contact },
            { relation: 'Guardian', name: r.guardian_name, contact: r.guardian_contact },
          ].filter(g => g.name || g.contact);
        }
      }
    } catch (_) {}

    // The canteen sheet: what each pupil owes, and the rate it is worked out at.
    const canteen = {};
    let dailyRate = 0;
    try {
      dailyRate = parseFloat(getSetting(db, 'canteen_daily_rate', '5')) || 0;
      if (term) {
        const q = db.prepare(`
          SELECT COUNT(*) c FROM school_calendar sc
          LEFT JOIN canteen_day_status cds ON cds.date = sc.date AND cds.student_id = ?
          WHERE sc.term_id = ? AND sc.day_type = 'school_day' AND (cds.status IS NULL OR cds.status = 'unpaid')
        `);
        for (const id of ids) {
          const unpaid = q.get(id, term.id).c;
          canteen[id] = { unpaid_days: unpaid, amount_owed: unpaid * dailyRate };
        }
      }
    } catch (_) {}

    // How class work and the exam are weighted, and the grade bands — so a
    // score sheet off-LAN can explain itself the same way the desktop does.
    let weights = null, gradingBands = [];
    try { weights = require('../../ipc/scores').readWeights(db); } catch (_) {}
    try { gradingBands = db.prepare('SELECT min_score, max_score, remark FROM grading_bands ORDER BY display_order, min_score DESC').all(); } catch (_) {}

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
        students: students.map(s => ({
          id: s.id, index_number: s.index_number, name: fullName(s),
          guardians: guardians[s.id] || [],
        })),
        subjects, scores, attendance, homework, timetable,
        assessments, summaries, canteen, daily_rate: dailyRate, weights,
        grading_bands: gradingBands,
        attendance_days: ATTENDANCE_DAYS,
        updated_at: new Date().toISOString(),
      },
    });
  } catch (_) { return null; }
}

// ── staff_profile ───────────────────────────────────────────────────────────
// The teacher's own employment, which the cloud carried nothing of: their staff
// record and teaching assignments, this term's lesson notes, their leave, their
// clock-ins, and their payslips.
//
// Payslips are the sensitive part, so two rules apply. Only PAID months are
// projected — an unpaid draft is the school's working figure, not a statement
// of what anyone is owed — and the record is keyed by user, so the cloud can
// only ever serve a teacher their own. Nothing employer-side (another person's
// salary, the payroll run, the PAYE schedule) leaves the desktop.
const LESSON_NOTE_LIMIT = 60;
const PAYSLIP_LIMIT = 18;

function enqueueStaffProfile(db, userId) {
  try {
    if (!syncEnabled(db)) return null;
    const u = db.prepare('SELECT id, staff_id, full_name, username FROM users WHERE id = ?').get(userId);
    if (!u) return null;

    const empty = {
      user_id: userId, has_staff: false, staff: null, assignments: [],
      lesson_notes: [], leave: [], attendance: [], payslips: [],
      updated_at: new Date().toISOString(),
    };
    if (!u.staff_id) {
      return postToOutbox(db, { entity_type: 'staff_profile', entity_key: `profile:user:${userId}`, payload: empty });
    }

    let staff = null;
    try {
      staff = db.prepare(`
        SELECT s.id, s.staff_number, s.surname, s.first_name, s.other_names, s.gender,
               s.phone, s.email, s.address, s.role, s.status, s.qualification, s.specialization,
               s.hire_date, s.photo_path, s.ssnit_number, s.bank_name, d.name AS designation
        FROM staff s LEFT JOIN designations d ON d.id = s.designation_id WHERE s.id = ?
      `).get(u.staff_id) || null;
      if (staff) staff.name = fullName(staff);
    } catch (_) {}

    let assignments = [];
    try {
      assignments = db.prepare(`
        SELECT sa.class_group_id, sa.subject_id, sa.is_class_teacher,
               c.name AS class_name, sub.name AS subject_name
        FROM staff_assignments sa
        LEFT JOIN class_groups c ON c.id = sa.class_group_id
        LEFT JOIN subjects sub ON sub.id = sa.subject_id
        WHERE sa.staff_id = ? ORDER BY c.level_order, c.name, sub.name
      `).all(u.staff_id);
    } catch (_) {}

    // Whole notes, not summaries: a teacher off-LAN opens one to read what they
    // planned, and a list of topics is not a lesson note.
    let lessonNotes = [];
    try {
      lessonNotes = db.prepare(`
        SELECT ln.*, c.name AS class_name, sub.name AS subject_name
        FROM lesson_notes ln
        LEFT JOIN class_groups c ON c.id = ln.class_group_id
        LEFT JOIN subjects sub ON sub.id = ln.subject_id
        WHERE ln.staff_id = ?
        ORDER BY COALESCE(ln.lesson_date, ln.created_at) DESC, ln.id DESC
        LIMIT ?
      `).all(u.staff_id, LESSON_NOTE_LIMIT);
    } catch (_) {}

    let leave = [];
    try {
      leave = db.prepare(`
        SELECT lr.id, lr.leave_type, lr.start_date, lr.end_date, lr.days_requested,
               lr.justification, lr.status, lr.reviewed_at, lr.reviewer_notes,
               rv.full_name AS reviewed_by_name
        FROM leave_requests lr LEFT JOIN users rv ON rv.id = lr.reviewed_by
        WHERE lr.staff_id = ? ORDER BY lr.created_at DESC LIMIT 40
      `).all(u.staff_id);
    } catch (_) {}

    let attendance = [];
    try {
      attendance = db.prepare(`
        SELECT date, clock_in, clock_out, status, notes FROM staff_attendance
        WHERE staff_id = ? AND date >= date('now', '-70 days') ORDER BY date DESC
      `).all(u.staff_id);
    } catch (_) {}

    let payslips = [];
    try {
      payslips = db.prepare(`
        SELECT id, month, year, gross_salary, extra_pay, extra_pay_description,
               ssnit_worker, paye_tax, other_deductions, other_deductions_description,
               net_salary, actual_amount_paid, carry_over_to_next,
               payment_date, payment_method, payment_reference
        FROM staff_salaries WHERE staff_id = ? AND is_paid = 1
        ORDER BY year DESC, month DESC LIMIT ?
      `).all(u.staff_id, PAYSLIP_LIMIT);
    } catch (_) {}

    return postToOutbox(db, {
      entity_type: 'staff_profile',
      entity_key: `profile:user:${userId}`,
      payload: {
        user_id: userId, has_staff: true, staff, assignments,
        lesson_notes: lessonNotes, leave, attendance, payslips,
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
  const counts = { staff: 0, classes: 0, metrics: 0, debtors: 0, timetables: 0, profiles: 0 };
  if (!syncEnabled(db)) return counts;
  try {
    for (const u of db.prepare('SELECT id FROM users WHERE is_active = 1').all()) {
      if (enqueueStaffAuth(db, u.id)) counts.staff++;
      if (enqueueStaffTimetable(db, u.id)) counts.timetables++;
      if (enqueueStaffProfile(db, u.id)) counts.profiles++;
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
  enqueueStaffTimetable, enqueueStaffProfile, enqueueAllStaff, enqueueRostersForStudents, classOfStudent,
};
