// Nickland Edusoft — the teacher's API surface, over LAN or a tunnel.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Teachers do not get the desktop. The phone app and the browser app are the
// whole of their working day, so everything the desktop offers a teacher has to
// be reachable here: the roll and a pupil's record, the register and its
// history, continuous assessment as well as exam marks, the broadsheet and the
// terminal report, homework set and marked, lesson notes written and submitted,
// the timetable, the canteen sheet, messages to parents, notices, and their own
// employment — clock-in, leave, payslips.
//
// Three rules hold throughout, and they are the same rules the desktop applies:
//
//   1. Permission first (`can`) — may this account touch this module at all.
//   2. Scope second (`electron/ipc/_scope.js`) — WHOSE class, whose subject.
//      A Subject Teacher with academics.edit is not thereby entitled to every
//      class in the school.
//   3. Reuse, never re-implement. Marks go through `saveExamMark`, homework
//      through the homework module, canteen through `recordCanteenPayment`.
//      A second implementation is a second set of bugs.
//
// Registered by `createApiServer` (api.js), which owns routing, auth and CORS.

const scopeLib = require('../ipc/_scope');

// Days of register history a teacher can pull back in one request. A term is
// about 60 school days; 90 covers one comfortably without letting a stray
// query walk the whole table.
const MAX_HISTORY_DAYS = 90;

function fullName(s) {
  return `${s.surname || ''} ${s.first_name || ''} ${s.other_names || ''}`.trim();
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Small helper so every list endpoint answers the same shape when a teacher
// has no assignments at all: nothing, rather than everything.
function emptyScope(scope) {
  return !scope.unrestricted
    && scope.wholeClasses.size === 0
    && scope.classSubjects.size === 0
    && scope.anyClassSubjects.size === 0;
}

/**
 * Register every staff route on the shared router.
 *
 * @param {object} deps
 * @param {(method: string, pattern: string, handler: Function, opts?: object) => void} deps.add
 * @param {object} deps.db              better-sqlite3 handle (the school's own database)
 * @param {(res, code, obj) => void} deps.json
 * @param {(ctx, module, action?) => boolean} deps.can
 * @param {string} deps.API             the version prefix, e.g. `/api/v1`
 * @param {(db, key, fallback) => string} deps.getSetting
 */
function registerStaffRoutes({ add, db, json, can, API, getSetting, media, studentProfile }) {
  const deny = (res, msg) => json(res, 403, { ok: false, error: msg || 'Access denied.' });
  const bad = (res, msg) => json(res, 400, { ok: false, error: msg });
  const missing = (res, msg) => json(res, 404, { ok: false, error: msg || 'Not found.' });

  const scopeOf = (ctx) => scopeLib.scopeFor(db, ctx.user.id);
  const isStaff = (ctx) => !!ctx && ctx.role === 'staff';

  const currentTerm = () => {
    try { return db.prepare('SELECT * FROM terms WHERE is_current = 1').get() || null; }
    catch (_) { return null; }
  };

  // Best-effort projection refresh. A teacher who writes on the school Wi-Fi
  // and then opens the same screen from home should see their own work.
  const reproject = (fn) => { try { fn(require('./sync/staff_projection')); } catch (_) {} };

  // ── Reference data ────────────────────────────────────────────────────────

  // Terms, so a screen can label what it is showing and offer past terms where
  // the desktop does.
  add('GET', `${API}/terms`, async (ctx, req, res) => {
    if (!isStaff(ctx)) return deny(res, 'Staff only.');
    const terms = db.prepare(`
      SELECT t.id, t.label, t.is_current, t.start_date, t.end_date, y.label AS year_label
      FROM terms t LEFT JOIN academic_years y ON y.id = t.academic_year_id
      ORDER BY t.id DESC LIMIT 12
    `).all();
    return json(res, 200, { ok: true, terms });
  });

  // Subjects. With a classId, only the ones this teacher may touch in it —
  // a subject teacher visiting a class sees their subject and no other, which
  // is what the desktop shows them.
  add('GET', `${API}/subjects`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!isStaff(ctx) || !can(ctx, 'academics', 'view')) return deny(res);
    const classId = parseInt(query.classId, 10) || null;
    let rows;
    if (classId) {
      rows = db.prepare(`
        SELECT s.id, s.name, s.code FROM subjects s
        JOIN class_subjects cs ON cs.subject_id = s.id
        WHERE cs.class_group_id = ? AND s.is_active = 1 ORDER BY s.name
      `).all(classId);
      if (!rows.length) rows = db.prepare('SELECT id, name, code FROM subjects WHERE is_active = 1 ORDER BY name').all();
      const allowed = scopeLib.visibleSubjectIds(db, scopeOf(ctx), classId);
      if (allowed) rows = rows.filter(r => allowed.has(Number(r.id)));
    } else {
      rows = db.prepare('SELECT id, name, code FROM subjects WHERE is_active = 1 ORDER BY name').all();
    }
    return json(res, 200, { ok: true, subjects: rows });
  });

  // ── A pupil's record ──────────────────────────────────────────────────────
  // What a class teacher opens when a parent asks a question at the gate:
  // who the child is, who to call, how often they are here, what they owe, and
  // how they are doing. Fees and canteen figures are omitted — not blanked,
  // omitted — for an account without the money modules.
  add('GET', `${API}/students/:id`, async (ctx, req, res, params) => {
    if (!isStaff(ctx) || !can(ctx, 'students', 'view')) return deny(res);
    const sid = parseInt(params.id, 10);
    const scope = scopeOf(ctx);
    // A pupil in a class that is not this teacher's is not theirs to read, and
    // "not found" says less than "forbidden" about who else the school teaches.
    if (!scopeLib.canAccessStudent(db, scope, sid)) return missing(res, 'Student not found.');

    const s = db.prepare(`
      SELECT s.*, c.name AS class_name, c.id AS class_id
      FROM students s LEFT JOIN class_groups c ON c.id = s.current_class_id
      WHERE s.id = ?
    `).get(sid);
    if (!s) return missing(res, 'Student not found.');

    const term = currentTerm();
    const attendance = term ? db.prepare(`
      SELECT COUNT(*) FILTER (WHERE status='present') AS present,
             COUNT(*) FILTER (WHERE status='absent')  AS absent,
             COUNT(*) FILTER (WHERE status='late')    AS late,
             COUNT(*) AS total
      FROM student_attendance WHERE student_id = ? AND term_id = ?
    `).get(sid, term.id) : { present: 0, absent: 0, late: 0, total: 0 };

    let fees = null, canteen = null;
    if (can(ctx, 'fees', 'view') && term) {
      const bill = db.prepare(`
        SELECT total_billed, total_paid, balance FROM student_bills
        WHERE student_id = ? AND term_id = ? AND COALESCE(status, 'active') = 'active'
      `).get(sid, term.id);
      fees = { billed: bill?.total_billed || 0, paid: bill?.total_paid || 0, balance: bill?.balance || 0 };
    }
    if (can(ctx, 'canteen', 'view') && term) {
      const rate = parseFloat(getSetting(db, 'canteen_daily_rate', '5')) || 0;
      const unpaid = db.prepare(`
        SELECT COUNT(*) c FROM school_calendar sc
        LEFT JOIN canteen_day_status cds ON cds.date = sc.date AND cds.student_id = ?
        WHERE sc.term_id = ? AND sc.day_type = 'school_day' AND (cds.status IS NULL OR cds.status = 'unpaid')
      `).get(sid, term.id).c;
      canteen = { unpaid_days: unpaid, amount_owed: unpaid * rate, daily_rate: rate };
    }

    let subjects = [], summary = null;
    if (can(ctx, 'academics', 'view') && term) {
      subjects = db.prepare(`
        SELECT sub.name AS subject, sc.class_score, sc.exam_score, sc.total_score, sc.grade_remark
        FROM scores sc JOIN subjects sub ON sub.id = sc.subject_id
        WHERE sc.student_id = ? AND sc.term_id = ? ORDER BY sub.name
      `).all(sid, term.id);
      summary = db.prepare('SELECT * FROM student_term_summary WHERE student_id = ? AND term_id = ?').get(sid, term.id) || null;
    }

    let homework = [];
    try { homework = require('../ipc/homework').listForStudent(db, sid) || []; } catch (_) {}

    const recent = db.prepare(`
      SELECT date, status, notes FROM student_attendance
      WHERE student_id = ? ORDER BY date DESC LIMIT 30
    `).all(sid);

    return json(res, 200, {
      ok: true,
      term: term ? { id: term.id, label: term.label } : null,
      student: {
        id: s.id, index_number: s.index_number, name: fullName(s),
        surname: s.surname, first_name: s.first_name, other_names: s.other_names,
        gender: s.gender, date_of_birth: s.date_of_birth, age: s.age,
        denomination: s.denomination, place_of_residence: s.place_of_residence,
        street_address: s.street_address, digital_address: s.digital_address,
        admission_date: s.admission_date, admission_year: s.admission_year,
        status: s.status, class_id: s.class_id, class_name: s.class_name,
        // The face, not the file path. `photo_path` names a folder on the
        // school's own machine and is no use to a phone; sending it was why
        // every pupil in the app was a pair of initials in a circle.
        photo: media.dataUri(s.photo_path),
        nhis_number: s.nhis_number, place_of_birth: s.place_of_birth,
        house_number: s.house_number, roll_number: s.roll_number,
      },
      // The same record laid out for printing, so "Print profile" does not have
      // to reassemble it from the pieces above and get a field wrong.
      profile: studentProfile(db, s),
      guardians: [
        { relation: 'Father', name: s.father_name, contact: s.father_contact },
        { relation: 'Mother', name: s.mother_name, contact: s.mother_contact },
        { relation: 'Guardian', name: s.guardian_name, contact: s.guardian_contact },
      ].filter(g => g.name || g.contact),
      attendance, recent_attendance: recent, fees, canteen, subjects, summary, homework,
    });
  });

  // ── Register history ──────────────────────────────────────────────────────
  // The register screen marks one day. This is the rest of the job: who has
  // been missing, and how often, over the days that matter.
  add('GET', `${API}/attendance/history`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!isStaff(ctx)) return deny(res);
    if (!can(ctx, 'students', 'view') && !can(ctx, 'academics', 'view')) return deny(res);
    const classId = parseInt(query.classId, 10);
    if (!classId) return bad(res, 'classId is required.');
    if (!scopeLib.canAccessClass(scopeOf(ctx), classId)) return deny(res, 'That class is not yours.');
    const days = Math.min(Math.max(parseInt(query.days, 10) || 30, 1), MAX_HISTORY_DAYS);

    const students = db.prepare(`
      SELECT id, index_number, surname, first_name, other_names
      FROM students WHERE current_class_id = ? AND status = 'Active'
      ORDER BY surname, first_name
    `).all(classId);
    if (!students.length) return json(res, 200, { ok: true, days: [], students: [], marked_days: 0 });

    const ph = students.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT date, student_id, status FROM student_attendance
      WHERE student_id IN (${ph}) AND date >= date('now', ?)
      ORDER BY date DESC
    `).all(...students.map(s => s.id), `-${days} days`);

    const byDay = new Map();
    const perStudent = new Map(students.map(s => [s.id, { present: 0, absent: 0, late: 0, total: 0 }]));
    for (const r of rows) {
      const d = byDay.get(r.date) || { date: r.date, present: 0, absent: 0, late: 0, total: 0 };
      d.total++;
      if (r.status === 'absent') d.absent++;
      else if (r.status === 'late') d.late++;
      else d.present++;
      byDay.set(r.date, d);
      const p = perStudent.get(r.student_id);
      if (p) {
        p.total++;
        if (r.status === 'absent') p.absent++;
        else if (r.status === 'late') p.late++;
        else p.present++;
      }
    }

    return json(res, 200, {
      ok: true,
      marked_days: byDay.size,
      days: [...byDay.values()].sort((a, b) => (a.date < b.date ? 1 : -1)),
      students: students.map(s => ({
        id: s.id, index_number: s.index_number, name: fullName(s), ...perStudent.get(s.id),
      })),
    });
  });

  // ── Continuous assessment ─────────────────────────────────────────────────
  // The other half of a mark. The app had exam scores only, so a teacher could
  // enter the end-of-term paper from their phone but not the class work that
  // is weighted alongside it — and the class score is what the report card
  // actually carries.
  add('GET', `${API}/assessments`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!isStaff(ctx) || !can(ctx, 'academics', 'view')) return deny(res);
    const classId = parseInt(query.classId, 10);
    const subjectId = parseInt(query.subjectId, 10);
    if (!classId || !subjectId) return bad(res, 'classId and subjectId are required.');
    if (!scopeLib.canAccessSubject(scopeOf(ctx), classId, subjectId)) return deny(res, 'That subject is not yours in this class.');
    const term = currentTerm();
    if (!term) return json(res, 200, { ok: true, term: null, columns: [], students: [] });

    const columns = db.prepare(`
      SELECT id, assessment_type, max_marks, display_order FROM assessment_columns
      WHERE class_group_id = ? AND subject_id = ? AND term_id = ?
      ORDER BY display_order, id
    `).all(classId, subjectId, term.id);

    const students = db.prepare(`
      SELECT id, index_number, surname, first_name, other_names
      FROM students WHERE current_class_id = ? AND status = 'Active'
      ORDER BY surname, first_name
    `).all(classId);

    const marks = {};
    if (columns.length && students.length) {
      const cph = columns.map(() => '?').join(',');
      for (const r of db.prepare(`
        SELECT assessment_column_id, student_id, marks FROM assessment_scores
        WHERE assessment_column_id IN (${cph})
      `).all(...columns.map(c => c.id))) {
        (marks[r.student_id] ||= {})[r.assessment_column_id] = r.marks;
      }
    }

    // What the weighting will do with these marks, so the screen can say so
    // rather than leaving a teacher to guess why 18/20 became 9.
    let weights = null;
    try { weights = require('../ipc/scores').readWeights(db); } catch (_) {}

    return json(res, 200, {
      ok: true,
      term: { id: term.id, label: term.label },
      weights,
      columns,
      students: students.map(s => ({
        id: s.id, index_number: s.index_number, name: fullName(s), marks: marks[s.id] || {},
      })),
    });
  });

  // Add an assessment column (a class test, an assignment) to a class+subject.
  add('POST', `${API}/assessments/column`, async (ctx, req, res, params, body) => {
    if (!isStaff(ctx) || !can(ctx, 'academics', 'create')) return deny(res);
    const classId = parseInt(body.classId, 10);
    const subjectId = parseInt(body.subjectId, 10);
    if (!classId || !subjectId) return bad(res, 'classId and subjectId are required.');
    if (!scopeLib.canAccessSubject(scopeOf(ctx), classId, subjectId)) return deny(res, 'That subject is not yours in this class.');
    const term = currentTerm();
    if (!term) return bad(res, 'No current term is set.');
    const max = Number(body.maxMarks);
    if (!Number.isFinite(max) || max <= 0 || max > 1000) return bad(res, 'Total marks must be between 1 and 1000.');
    const type = String(body.assessmentType || 'Assignment').trim().slice(0, 60) || 'Assignment';

    const order = db.prepare(`
      SELECT COALESCE(MAX(display_order), 0) + 1 AS n FROM assessment_columns
      WHERE class_group_id = ? AND subject_id = ? AND term_id = ?
    `).get(classId, subjectId, term.id).n;
    const r = db.prepare(`
      INSERT INTO assessment_columns (class_group_id, subject_id, term_id, assessment_type, max_marks, display_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(classId, subjectId, term.id, type, max, order);
    reproject(p => p.enqueueClassRoster(db, classId));
    return json(res, 200, { ok: true, id: r.lastInsertRowid });
  });

  // Save marks against existing columns. A blank is left alone rather than
  // written as zero: "not marked yet" and "scored nothing" are different, and
  // the compilation treats them differently.
  add('POST', `${API}/assessments`, async (ctx, req, res, params, body) => {
    if (!isStaff(ctx) || !can(ctx, 'academics', 'edit')) return deny(res);
    const classId = parseInt(body.classId, 10);
    const subjectId = parseInt(body.subjectId, 10);
    const entries = Array.isArray(body.marks) ? body.marks : null;
    if (!classId || !subjectId || !entries) return bad(res, 'classId, subjectId and marks[] are required.');
    if (!scopeLib.canAccessSubject(scopeOf(ctx), classId, subjectId)) return deny(res, 'That subject is not yours in this class.');
    const term = currentTerm();
    if (!term) return bad(res, 'No current term is set.');

    const columns = Object.fromEntries(db.prepare(`
      SELECT id, max_marks FROM assessment_columns
      WHERE class_group_id = ? AND subject_id = ? AND term_id = ?
    `).all(classId, subjectId, term.id).map(c => [String(c.id), c]));

    const up = db.prepare(`
      INSERT INTO assessment_scores (assessment_column_id, student_id, marks) VALUES (?, ?, ?)
      ON CONFLICT (assessment_column_id, student_id) DO UPDATE SET marks = excluded.marks
    `);
    const clear = db.prepare('DELETE FROM assessment_scores WHERE assessment_column_id = ? AND student_id = ?');

    let saved = 0;
    const touched = new Set();
    try {
      db.transaction(() => {
        for (const e of entries) {
          const col = columns[String(e.column_id)];
          const sid = parseInt(e.student_id, 10);
          if (!col || !sid) continue;
          if (e.marks === '' || e.marks == null) { clear.run(col.id, sid); touched.add(sid); continue; }
          const v = Number(e.marks);
          if (!Number.isFinite(v) || v < 0) throw new Error('Marks cannot be negative.');
          if (v > col.max_marks) throw new Error(`A mark of ${v} is above the ${col.max_marks} this assessment is out of.`);
          up.run(col.id, sid, v);
          touched.add(sid);
          saved++;
        }
      })();
    } catch (e) { return bad(res, e.message); }

    // Recompute the weighted class score so the report card and the score
    // sheet agree the moment this returns — the desktop does the same.
    try {
      const { recomputeClassScore, readWeights } = require('../ipc/scores');
      const w = readWeights(db);
      for (const sid of touched) recomputeClassScore(db, classId, subjectId, term.id, sid, w);
    } catch (_) {}
    reproject(p => p.enqueueClassRoster(db, classId));
    return json(res, 200, { ok: true, saved });
  });

  // ── The broadsheet ────────────────────────────────────────────────────────
  // Every pupil in the class against every subject, with the position and the
  // average. This is what a class teacher checks before reports go out.
  add('GET', `${API}/results`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!isStaff(ctx) || !can(ctx, 'academics', 'view')) return deny(res);
    const classId = parseInt(query.classId, 10);
    if (!classId) return bad(res, 'classId is required.');
    const scope = scopeOf(ctx);
    if (!scopeLib.canAccessClass(scope, classId)) return deny(res, 'That class is not yours.');
    const term = query.termId
      ? db.prepare('SELECT * FROM terms WHERE id = ?').get(parseInt(query.termId, 10))
      : currentTerm();
    if (!term) return json(res, 200, { ok: true, term: null, subjects: [], students: [] });

    const students = db.prepare(`
      SELECT id, index_number, surname, first_name, other_names
      FROM students WHERE current_class_id = ? AND status = 'Active'
      ORDER BY surname, first_name
    `).all(classId);
    if (!students.length) return json(res, 200, { ok: true, term: { id: term.id, label: term.label }, subjects: [], students: [] });

    let subjects = db.prepare(`
      SELECT s.id, s.name, s.code FROM subjects s
      JOIN class_subjects cs ON cs.subject_id = s.id
      WHERE cs.class_group_id = ? AND s.is_active = 1 ORDER BY s.name
    `).all(classId);
    if (!subjects.length) subjects = db.prepare('SELECT id, name, code FROM subjects WHERE is_active = 1 ORDER BY name').all();
    // A subject teacher sees the whole broadsheet only if the class is theirs;
    // otherwise the columns narrow to what they teach in it.
    const allowedSubjects = scopeLib.visibleSubjectIds(db, scope, classId);
    if (allowedSubjects) subjects = subjects.filter(s => allowedSubjects.has(Number(s.id)));

    const ph = students.map(() => '?').join(',');
    const scores = db.prepare(`
      SELECT student_id, subject_id, class_score, exam_score, total_score, grade_remark
      FROM scores WHERE term_id = ? AND student_id IN (${ph})
    `).all(term.id, ...students.map(s => s.id));
    const byStudent = {};
    for (const r of scores) (byStudent[r.student_id] ||= {})[r.subject_id] = r;

    const summaries = Object.fromEntries(db.prepare(`
      SELECT * FROM student_term_summary WHERE term_id = ? AND student_id IN (${ph})
    `).all(term.id, ...students.map(s => s.id)).map(r => [r.student_id, r]));

    return json(res, 200, {
      ok: true,
      term: { id: term.id, label: term.label },
      subjects,
      students: students.map(s => {
        const row = byStudent[s.id] || {};
        const sum = summaries[s.id] || null;
        return {
          id: s.id, index_number: s.index_number, name: fullName(s),
          scores: Object.fromEntries(subjects.map(sub => [sub.id, row[sub.id] || null])),
          total: sum ? sum.total_score_all : null,
          average: sum ? sum.average_score : null,
          rank: sum ? sum.class_rank : null,
          number_on_roll: sum ? sum.number_on_roll : null,
        };
      }),
    });
  });

  // One pupil's terminal report, as the desktop prints it.
  add('GET', `${API}/results/student/:id`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!isStaff(ctx) || !can(ctx, 'academics', 'view')) return deny(res);
    const sid = parseInt(params.id, 10);
    if (!scopeLib.canAccessStudent(db, scopeOf(ctx), sid)) return missing(res, 'Student not found.');
    const term = query.termId
      ? db.prepare('SELECT * FROM terms WHERE id = ?').get(parseInt(query.termId, 10))
      : currentTerm();
    const s = db.prepare(`
      SELECT s.id, s.surname, s.first_name, s.other_names, s.index_number, s.photo_path,
             c.name AS class_name, c.id AS class_id
      FROM students s LEFT JOIN class_groups c ON c.id = s.current_class_id WHERE s.id = ?
    `).get(sid);
    if (!s) return missing(res, 'Student not found.');
    if (!term) return json(res, 200, { ok: true, term: null, student: { id: s.id, name: fullName(s) }, subjects: [], summary: null });

    const subjects = db.prepare(`
      SELECT sub.name AS subject, sc.class_score, sc.exam_score, sc.total_score, sc.grade_remark
      FROM scores sc JOIN subjects sub ON sub.id = sc.subject_id
      WHERE sc.student_id = ? AND sc.term_id = ? ORDER BY sub.name
    `).all(sid, term.id);
    const summary = db.prepare('SELECT * FROM student_term_summary WHERE student_id = ? AND term_id = ?').get(sid, term.id) || null;
    const attendance = db.prepare(`
      SELECT COUNT(*) FILTER (WHERE status='present') AS present,
             COUNT(*) FILTER (WHERE status='absent')  AS absent, COUNT(*) AS total
      FROM student_attendance WHERE student_id = ? AND term_id = ?
    `).get(sid, term.id);
    const bands = db.prepare('SELECT min_score, max_score, remark FROM grading_bands ORDER BY display_order, min_score DESC').all();

    // Which terms this pupil has marks for. It costs one query and it turns the
    // report card from "this term" into a record a teacher can page back
    // through — the single thing most asked for and never available on a phone.
    const terms = db.prepare(`
      SELECT t.id, t.label, sts.average_score, sts.class_rank, sts.number_on_roll
      FROM terms t LEFT JOIN student_term_summary sts ON sts.student_id = ? AND sts.term_id = t.id
      WHERE EXISTS (SELECT 1 FROM scores sc WHERE sc.student_id = ? AND sc.term_id = t.id)
      ORDER BY t.id DESC
    `).all(sid, sid);

    const classTeacher = s.class_id ? db.prepare(`
      SELECT TRIM(st.surname || ' ' || st.first_name) AS name
      FROM staff_assignments sa JOIN staff st ON st.id = sa.staff_id
      WHERE sa.class_group_id = ? AND sa.is_class_teacher = 1 LIMIT 1
    `).get(s.class_id) : null;

    return json(res, 200, {
      ok: true,
      term: { id: term.id, label: term.label },
      terms,
      student: {
        id: s.id, name: fullName(s), index_number: s.index_number,
        class_name: s.class_name, photo: media.dataUri(s.photo_path),
        class_teacher: classTeacher ? classTeacher.name : null,
      },
      subjects, summary, attendance, grading_bands: bands,
      // The header a printed copy carries. Assembling it here means the phone
      // and the browser print the same document as the desktop does.
      school: {
        name: getSetting(db, 'school_name', 'School'),
        motto: getSetting(db, 'school_motto', ''),
        address: getSetting(db, 'school_address', '') || getSetting(db, 'school_location', ''),
        phone: getSetting(db, 'school_phone_1', ''),
        email: getSetting(db, 'school_email', ''),
        logo: media.logoUri(db, getSetting),
      },
      dates: {
        vacation: getSetting(db, 'vacation_date', ''),
        reopening: getSetting(db, 'reopening_date', ''),
        exam_title: getSetting(db, 'current_exam_title', ''),
      },
    });
  });

  // Conduct, interests, talents and the class teacher's remark. One person is
  // answerable for these, so only that person may write them.
  add('POST', `${API}/results/remarks`, async (ctx, req, res, params, body) => {
    if (!isStaff(ctx) || !can(ctx, 'academics', 'edit')) return deny(res);
    const sid = parseInt(body.studentId, 10);
    if (!sid) return bad(res, 'studentId is required.');
    const classId = scopeLib.classOfStudent(db, sid);
    if (!classId) return missing(res, 'Student not found.');
    if (!scopeLib.isClassTeacherOf(scopeOf(ctx), classId)) {
      return deny(res, 'Only the class teacher can write end-of-term remarks for this class.');
    }
    const term = currentTerm();
    if (!term) return bad(res, 'No current term is set.');
    const text = (v, n) => (v == null ? null : String(v).slice(0, n));
    db.prepare(`
      INSERT INTO student_term_summary (student_id, term_id, class_group_id, conduct_traits, learner_interests, learner_talents, teacher_remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (student_id, term_id) DO UPDATE SET
        conduct_traits    = excluded.conduct_traits,
        learner_interests = excluded.learner_interests,
        learner_talents   = excluded.learner_talents,
        teacher_remarks   = excluded.teacher_remarks
    `).run(sid, term.id, classId,
      text(body.conduct, 500), text(body.interests, 500), text(body.talents, 500), text(body.remarks, 1000));
    reproject(p => p.enqueueRostersForStudents(db, [sid]));
    try { require('./sync/outbox').enqueueStudentSnapshot(db, sid); } catch (_) {}
    return json(res, 200, { ok: true });
  });

  // ── Lesson notes ──────────────────────────────────────────────────────────
  // The one teacher duty the app never carried at all. A note belongs to the
  // teacher who wrote it; a head teacher reviewing them is a desktop job, so
  // this surface is deliberately "mine".
  const LESSON_FIELDS = [
    'class_group_id', 'subject_id', 'week_number', 'lesson_date', 'duration_minutes',
    'topic', 'sub_topic', 'references_text', 'tlms', 'objectives', 'rpk',
    'introduction', 'presentation', 'activity', 'evaluation', 'closure',
    'assignment', 'remarks', 'status',
  ];

  add('GET', `${API}/lesson-notes`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!isStaff(ctx)) return deny(res, 'Staff only.');
    const staffId = ctx.user.staff_id;
    if (!staffId) return json(res, 200, { ok: true, has_staff: false, notes: [] });
    const filters = ['ln.staff_id = ?'];
    const args = [staffId];
    if (query.status) { filters.push('ln.status = ?'); args.push(query.status); }
    if (query.classId) { filters.push('ln.class_group_id = ?'); args.push(parseInt(query.classId, 10)); }
    const notes = db.prepare(`
      SELECT ln.id, ln.topic, ln.sub_topic, ln.lesson_date, ln.week_number, ln.status,
             ln.duration_minutes, ln.review_comments, ln.reviewed_at,
             c.name AS class_name, s.name AS subject_name
      FROM lesson_notes ln
      LEFT JOIN class_groups c ON c.id = ln.class_group_id
      LEFT JOIN subjects s ON s.id = ln.subject_id
      WHERE ${filters.join(' AND ')}
      ORDER BY COALESCE(ln.lesson_date, ln.created_at) DESC, ln.id DESC
      LIMIT 200
    `).all(...args);
    return json(res, 200, { ok: true, has_staff: true, notes });
  });

  add('GET', `${API}/lesson-notes/:id`, async (ctx, req, res, params) => {
    if (!isStaff(ctx)) return deny(res, 'Staff only.');
    const note = db.prepare(`
      SELECT ln.*, c.name AS class_name, s.name AS subject_name
      FROM lesson_notes ln
      LEFT JOIN class_groups c ON c.id = ln.class_group_id
      LEFT JOIN subjects s ON s.id = ln.subject_id
      WHERE ln.id = ?
    `).get(parseInt(params.id, 10));
    if (!note) return missing(res, 'Lesson note not found.');
    if (note.staff_id !== ctx.user.staff_id && !ctx.is_admin) return missing(res, 'Lesson note not found.');
    return json(res, 200, { ok: true, note });
  });

  add('POST', `${API}/lesson-notes`, async (ctx, req, res, params, body) => {
    if (!isStaff(ctx)) return deny(res, 'Staff only.');
    const staffId = ctx.user.staff_id;
    if (!staffId) return bad(res, "Your account isn't linked to a staff record, so a lesson note has nobody to belong to. Ask the school office.");
    if (!body.topic || !String(body.topic).trim()) return bad(res, 'A topic is required.');

    const status = body.status === 'submitted' ? 'submitted' : 'draft';
    const values = {
      class_group_id: body.classId ? parseInt(body.classId, 10) : null,
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
      status,
    };
    // A teacher may only write a note against a class they actually teach.
    if (values.class_group_id && !scopeLib.canAccessClass(scopeOf(ctx), values.class_group_id)) {
      return deny(res, 'That class is not yours.');
    }

    const id = body.id ? parseInt(body.id, 10) : null;
    if (id) {
      const existing = db.prepare('SELECT staff_id, status FROM lesson_notes WHERE id = ?').get(id);
      if (!existing) return missing(res, 'Lesson note not found.');
      if (existing.staff_id !== staffId) return missing(res, 'Lesson note not found.');
      // A reviewed note is the head teacher's record of what was taught; it is
      // not the teacher's to rewrite afterwards.
      if (existing.status === 'approved') return bad(res, 'This note has been approved and can no longer be edited.');
      const sets = LESSON_FIELDS.map(f => `${f} = ?`).join(', ');
      db.prepare(`UPDATE lesson_notes SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(...LESSON_FIELDS.map(f => values[f]), id);
      reproject(p => p.enqueueStaffProfile(db, ctx.user.id));
      return json(res, 200, { ok: true, id });
    }

    const term = currentTerm();
    const cols = ['staff_id', 'term_id', ...LESSON_FIELDS];
    const r = db.prepare(`
      INSERT INTO lesson_notes (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
    `).run(staffId, term ? term.id : null, ...LESSON_FIELDS.map(f => values[f]));
    reproject(p => p.enqueueStaffProfile(db, ctx.user.id));
    return json(res, 200, { ok: true, id: r.lastInsertRowid });
  });

  add('DELETE', `${API}/lesson-notes/:id`, async (ctx, req, res, params) => {
    if (!isStaff(ctx)) return deny(res, 'Staff only.');
    const note = db.prepare('SELECT id, staff_id, status FROM lesson_notes WHERE id = ?').get(parseInt(params.id, 10));
    if (!note || note.staff_id !== ctx.user.staff_id) return missing(res, 'Lesson note not found.');
    if (note.status === 'approved') return bad(res, 'An approved note cannot be deleted.');
    db.prepare('DELETE FROM lesson_notes WHERE id = ?').run(note.id);
    reproject(p => p.enqueueStaffProfile(db, ctx.user.id));
    return json(res, 200, { ok: true });
  });

  // ── The teacher's own employment ──────────────────────────────────────────
  // Everything under /hr is about the signed-in person and nobody else. There
  // is no staffId parameter anywhere in it by design: the token decides whose
  // payslip this is, so no amount of guessing at ids reaches a colleague's.

  add('GET', `${API}/hr/me`, async (ctx, req, res) => {
    if (!isStaff(ctx)) return deny(res, 'Staff only.');
    const staffId = ctx.user.staff_id;
    if (!staffId) {
      return json(res, 200, { ok: true, has_staff: false, user: { full_name: ctx.user.full_name, username: ctx.user.username }, designation: ctx.designation });
    }
    const staff = db.prepare(`
      SELECT s.id, s.staff_number, s.surname, s.first_name, s.other_names, s.gender,
             s.date_of_birth, s.phone, s.email, s.address, s.role, s.status,
             s.qualification, s.specialization, s.hire_date, s.photo_path,
             s.ssnit_number, d.name AS designation
      FROM staff s LEFT JOIN designations d ON d.id = s.designation_id WHERE s.id = ?
    `).get(staffId);
    const today = todayISO();
    const attendance = db.prepare('SELECT * FROM staff_attendance WHERE staff_id = ? AND date = ?').get(staffId, today) || null;
    const leave = db.prepare(`
      SELECT COUNT(*) FILTER (WHERE status='pending')  AS pending,
             COUNT(*) FILTER (WHERE status='approved') AS approved
      FROM leave_requests WHERE staff_id = ?
    `).get(staffId);
    const assignments = db.prepare(`
      SELECT sa.class_group_id, sa.subject_id, sa.is_class_teacher,
             c.name AS class_name, sub.name AS subject_name
      FROM staff_assignments sa
      LEFT JOIN class_groups c ON c.id = sa.class_group_id
      LEFT JOIN subjects sub ON sub.id = sa.subject_id
      WHERE sa.staff_id = ?
      ORDER BY c.level_order, c.name, sub.name
    `).all(staffId);
    // A teacher's own record, printable and with their own photograph on it.
    // `bank_name` is deliberately no longer read: a staff profile a teacher can
    // print and hand to a landlord has no business carrying banking details.
    const { photo_path, ...rest } = staff || {};
    const subjectsTaught = [...new Set(assignments.map(a => a.subject_name).filter(Boolean))];
    const classesTaught = [...new Set(assignments.map(a => a.class_name).filter(Boolean))];
    const classTeacherOf = assignments.filter(a => a.is_class_teacher).map(a => a.class_name).filter(Boolean);

    return json(res, 200, {
      ok: true, has_staff: true,
      staff: staff ? { ...rest, name: fullName(staff), photo: media.dataUri(photo_path) } : null,
      designation: ctx.designation, is_admin: ctx.is_admin,
      account: { username: ctx.user.username, full_name: ctx.user.full_name },
      today: { date: today, attendance }, leave, assignments,
      teaching: { subjects: subjectsTaught, classes: classesTaught, class_teacher_of: classTeacherOf },
      school: {
        name: getSetting(db, 'school_name', 'School'),
        motto: getSetting(db, 'school_motto', ''),
        address: getSetting(db, 'school_address', '') || getSetting(db, 'school_location', ''),
        phone: getSetting(db, 'school_phone_1', ''),
        email: getSetting(db, 'school_email', ''),
        logo: media.logoUri(db, getSetting),
      },
    });
  });

  // Clock in, then clock out. Signing in twice does not re-open the day: the
  // first stamp stands, which is what the desktop's own button does.
  add('POST', `${API}/hr/clock`, async (ctx, req, res, params, body) => {
    if (!isStaff(ctx)) return deny(res, 'Staff only.');
    const staffId = ctx.user.staff_id;
    if (!staffId) return bad(res, "Your account isn't linked to a staff record.");
    const date = todayISO();
    const now = new Date().toTimeString().slice(0, 8);
    const row = db.prepare('SELECT * FROM staff_attendance WHERE staff_id = ? AND date = ?').get(staffId, date);
    const direction = body.direction === 'out' ? 'out' : 'in';

    if (direction === 'in') {
      if (row && row.clock_in) return json(res, 200, { ok: true, already: true, attendance: row });
      db.prepare(`
        INSERT INTO staff_attendance (staff_id, date, clock_in, status) VALUES (?, ?, ?, 'present')
        ON CONFLICT (staff_id, date) DO UPDATE SET clock_in = excluded.clock_in, status = 'present'
      `).run(staffId, date, now);
    } else {
      if (!row || !row.clock_in) return bad(res, 'Clock in first.');
      if (row.clock_out) return json(res, 200, { ok: true, already: true, attendance: row });
      db.prepare('UPDATE staff_attendance SET clock_out = ? WHERE staff_id = ? AND date = ?').run(now, staffId, date);
    }
    const after = db.prepare('SELECT * FROM staff_attendance WHERE staff_id = ? AND date = ?').get(staffId, date);
    reproject(p => p.enqueueStaffProfile(db, ctx.user.id));
    return json(res, 200, { ok: true, attendance: after });
  });

  add('GET', `${API}/hr/attendance`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!isStaff(ctx)) return deny(res, 'Staff only.');
    const staffId = ctx.user.staff_id;
    if (!staffId) return json(res, 200, { ok: true, has_staff: false, days: [] });
    const now = new Date();
    const month = parseInt(query.month, 10) || (now.getMonth() + 1);
    const year = parseInt(query.year, 10) || now.getFullYear();
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    const days = db.prepare(`
      SELECT date, clock_in, clock_out, status, notes FROM staff_attendance
      WHERE staff_id = ? AND date LIKE ? ORDER BY date DESC
    `).all(staffId, `${prefix}%`);
    const present = days.filter(d => d.status === 'present').length;
    return json(res, 200, { ok: true, has_staff: true, month, year, days, summary: { present, recorded: days.length } });
  });

  add('GET', `${API}/hr/leave`, async (ctx, req, res) => {
    if (!isStaff(ctx)) return deny(res, 'Staff only.');
    const staffId = ctx.user.staff_id;
    if (!staffId) return json(res, 200, { ok: true, has_staff: false, requests: [] });
    const requests = db.prepare(`
      SELECT lr.id, lr.leave_type, lr.start_date, lr.end_date, lr.days_requested,
             lr.justification, lr.status, lr.reviewed_at, lr.reviewer_notes,
             u.full_name AS reviewed_by_name
      FROM leave_requests lr LEFT JOIN users u ON u.id = lr.reviewed_by
      WHERE lr.staff_id = ? ORDER BY lr.created_at DESC LIMIT 60
    `).all(staffId);
    return json(res, 200, { ok: true, has_staff: true, requests });
  });

  add('POST', `${API}/hr/leave`, async (ctx, req, res, params, body) => {
    if (!isStaff(ctx)) return deny(res, 'Staff only.');
    const staffId = ctx.user.staff_id;
    if (!staffId) return bad(res, "Your account isn't linked to a staff record.");
    const { leaveType, startDate, endDate, justification } = body;
    if (!leaveType || !startDate || !endDate) return bad(res, 'Leave type and both dates are required.');
    if (!justification || !String(justification).trim()) return bad(res, 'A reason is required.');
    const start = new Date(startDate); const end = new Date(endDate);
    if (isNaN(start) || isNaN(end)) return bad(res, 'Those dates could not be read. Use YYYY-MM-DD.');
    if (end < start) return bad(res, 'The end date cannot be before the start date.');
    const days = Math.round((end - start) / 86400000) + 1;
    if (days > 365) return bad(res, 'A single request cannot cover more than a year.');
    const r = db.prepare(`
      INSERT INTO leave_requests (staff_id, leave_type, start_date, end_date, days_requested, justification, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `).run(staffId, String(leaveType).slice(0, 60), startDate, endDate, days, String(justification).trim().slice(0, 1000));
    reproject(p => p.enqueueStaffProfile(db, ctx.user.id));
    return json(res, 200, { ok: true, id: r.lastInsertRowid, days_requested: days });
  });

  // Payslips. Only paid months are shown: an unpaid draft row is the school's
  // working figure, not a statement of what anyone is owed.
  add('GET', `${API}/hr/payslips`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!isStaff(ctx)) return deny(res, 'Staff only.');
    const staffId = ctx.user.staff_id;
    if (!staffId) return json(res, 200, { ok: true, has_staff: false, payslips: [] });
    const year = parseInt(query.year, 10) || null;
    const rows = year
      ? db.prepare('SELECT * FROM staff_salaries WHERE staff_id = ? AND year = ? AND is_paid = 1 ORDER BY year DESC, month DESC').all(staffId, year)
      : db.prepare('SELECT * FROM staff_salaries WHERE staff_id = ? AND is_paid = 1 ORDER BY year DESC, month DESC LIMIT 24').all(staffId);
    return json(res, 200, {
      ok: true, has_staff: true,
      payslips: rows.map(r => ({
        id: r.id, month: r.month, year: r.year,
        gross_salary: r.gross_salary, extra_pay: r.extra_pay, extra_pay_description: r.extra_pay_description,
        ssnit_worker: r.ssnit_worker, paye_tax: r.paye_tax,
        other_deductions: r.other_deductions, other_deductions_description: r.other_deductions_description,
        net_salary: r.net_salary, actual_amount_paid: r.actual_amount_paid,
        carry_over_to_next: r.carry_over_to_next,
        payment_date: r.payment_date, payment_method: r.payment_method, payment_reference: r.payment_reference,
      })),
    });
  });

  // ── Messages (staff side) ─────────────────────────────────────────────────
  add('GET', `${API}/messages`, async (ctx, req, res) => {
    if (!isStaff(ctx) || !can(ctx, 'notifications', 'view')) return deny(res);
    const m = require('../ipc/messaging');
    return json(res, 200, { ok: true, threads: m.listThreadsForStaff(db), unread: m.staffUnreadTotal(db) });
  });

  add('GET', `${API}/messages/:id`, async (ctx, req, res, params) => {
    if (!isStaff(ctx) || !can(ctx, 'notifications', 'view')) return deny(res);
    const m = require('../ipc/messaging');
    const t = m.getThread(db, parseInt(params.id, 10));
    if (!t) return missing(res, 'Conversation not found.');
    m.markThreadRead(db, parseInt(params.id, 10), 'staff');
    return json(res, 200, { ok: true, ...t });
  });

  add('POST', `${API}/messages`, async (ctx, req, res, params, body) => {
    if (!isStaff(ctx) || !can(ctx, 'notifications', 'create')) return deny(res);
    const m = require('../ipc/messaging');
    const r = m.postMessage(db, {
      threadId: body.threadId ? parseInt(body.threadId, 10) : null,
      parentId: body.parentId ? parseInt(body.parentId, 10) : null,
      studentId: body.studentId ? parseInt(body.studentId, 10) : null,
      subject: body.subject || null,
      senderType: 'staff',
      senderId: ctx.user.id,
      senderName: ctx.user.full_name,
      body: body.body,
    });
    return json(res, r.ok ? 200 : 400, r);
  });

  // Who to start a conversation with, for a pupil the teacher may reach.
  add('GET', `${API}/students/:id/parents`, async (ctx, req, res, params) => {
    if (!isStaff(ctx) || !can(ctx, 'notifications', 'view')) return deny(res);
    const sid = parseInt(params.id, 10);
    if (!scopeLib.canAccessStudent(db, scopeOf(ctx), sid)) return missing(res, 'Student not found.');
    let parents = [];
    try {
      parents = db.prepare(`
        SELECT p.id, p.full_name, p.phone, p.email FROM parents p
        JOIN parent_students ps ON ps.parent_id = p.id
        WHERE ps.student_id = ?
      `).all(sid);
    } catch (_) {}
    return json(res, 200, { ok: true, parents });
  });

  // ── Notices ───────────────────────────────────────────────────────────────
  add('GET', `${API}/announcements`, async (ctx, req, res) => {
    if (!isStaff(ctx) || !can(ctx, 'notifications', 'view')) return deny(res);
    const rows = db.prepare(`
      SELECT a.id, a.title, a.body, a.audience, a.target_student_id, a.is_active, a.created_at,
             u.full_name AS created_by_name,
             s.surname, s.first_name
      FROM announcements a
      LEFT JOIN users u ON u.id = a.created_by
      LEFT JOIN students s ON s.id = a.target_student_id
      WHERE a.is_active = 1
      ORDER BY a.created_at DESC LIMIT 100
    `).all();
    return json(res, 200, {
      ok: true,
      announcements: rows.map(a => ({
        id: a.id, title: a.title, body: a.body, audience: a.audience,
        student_name: a.target_student_id ? `${a.surname || ''} ${a.first_name || ''}`.trim() : null,
        created_by_name: a.created_by_name, created_at: a.created_at,
      })),
    });
  });

  add('POST', `${API}/announcements`, async (ctx, req, res, params, body) => {
    if (!isStaff(ctx) || !can(ctx, 'notifications', 'edit')) return deny(res, 'You cannot post announcements.');
    if (!body.title || !body.body) return bad(res, 'A title and a message are required.');
    const audience = body.audience === 'student' ? 'student' : 'all';
    const target = audience === 'student' ? (parseInt(body.studentId, 10) || null) : null;
    if (audience === 'student' && !target) return bad(res, 'Choose the pupil this notice is for.');
    const r = db.prepare(`
      INSERT INTO announcements (title, body, audience, target_student_id, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(String(body.title).slice(0, 200), String(body.body).slice(0, 4000), audience, target, ctx.user.id);
    try { require('../ipc/announcements').project(db, r.lastInsertRowid); } catch (_) {}
    return json(res, 200, { ok: true, id: r.lastInsertRowid });
  });

  // ── Canteen: the class sheet ──────────────────────────────────────────────
  // Collecting from one pupil at a time is the phone case; the sheet is the
  // morning case — who has paid, who has not, and how much is outstanding
  // across the class the teacher is answerable for.
  add('GET', `${API}/canteen/class`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!isStaff(ctx) || !can(ctx, 'canteen', 'view')) return deny(res);
    const classId = parseInt(query.classId, 10);
    if (!classId) return bad(res, 'classId is required.');
    // The canteen sheet belongs to the class teacher, exactly as on the desktop.
    if (!scopeLib.isClassTeacherOf(scopeOf(ctx), classId)) return deny(res, 'The canteen sheet belongs to the class teacher.');
    const term = currentTerm();
    const rate = parseFloat(getSetting(db, 'canteen_daily_rate', '5')) || 0;
    const students = db.prepare(`
      SELECT id, index_number, surname, first_name, other_names
      FROM students WHERE current_class_id = ? AND status = 'Active'
      ORDER BY surname, first_name
    `).all(classId);
    const date = query.date || todayISO();

    const rows = students.map(s => {
      const unpaid = term ? db.prepare(`
        SELECT COUNT(*) c FROM school_calendar sc
        LEFT JOIN canteen_day_status cds ON cds.date = sc.date AND cds.student_id = ?
        WHERE sc.term_id = ? AND sc.day_type = 'school_day' AND (cds.status IS NULL OR cds.status = 'unpaid')
      `).get(s.id, term.id).c : 0;
      let today = null;
      try { today = db.prepare('SELECT status FROM canteen_day_status WHERE student_id = ? AND date = ?').get(s.id, date)?.status || null; } catch (_) {}
      return {
        id: s.id, index_number: s.index_number, name: fullName(s),
        unpaid_days: unpaid, amount_owed: unpaid * rate, today_status: today,
      };
    });

    return json(res, 200, {
      ok: true, date, daily_rate: rate,
      term: term ? { id: term.id, label: term.label } : null,
      students: rows,
      totals: {
        owing: rows.filter(r => r.unpaid_days > 0).length,
        amount: rows.reduce((n, r) => n + r.amount_owed, 0),
      },
    });
  });

  // ── Conduct: commendations and incidents ──────────────────────────────────
  // The desktop has kept a behaviour and achievement log per pupil since the
  // first release (`students:list-events`). Neither app could read it, let
  // alone write to it, so a teacher who wanted to record that a child had been
  // fighting — or had won the spelling bee — had to be sitting at the office
  // computer, and a parent never saw either.
  //
  // It is deliberately the class teacher's to write. A commendation from
  // anybody is fine; an incident written by a teacher with no answerability for
  // the class is how a record becomes an argument.
  add('GET', `${API}/students/:id/events`, async (ctx, req, res, params) => {
    if (!isStaff(ctx) || !can(ctx, 'students', 'view')) return deny(res);
    const sid = parseInt(params.id, 10);
    if (!scopeLib.canAccessStudent(db, scopeOf(ctx), sid)) return missing(res, 'Student not found.');
    let events = [];
    try {
      events = db.prepare(`
        SELECT se.id, se.event_type, se.title, se.description, se.date,
               u.full_name AS recorded_by_name
        FROM student_events se
        LEFT JOIN users u ON u.id = se.recorded_by
        WHERE se.student_id = ?
        ORDER BY date(se.date) DESC, se.id DESC LIMIT 60
      `).all(sid);
    } catch (_) {}
    const classId = scopeLib.classOfStudent(db, sid);
    return json(res, 200, {
      ok: true, events,
      can_write: !!(can(ctx, 'students', 'edit') && classId && scopeLib.isClassTeacherOf(scopeOf(ctx), classId)),
    });
  });

  add('POST', `${API}/students/:id/events`, async (ctx, req, res, params, body) => {
    if (!isStaff(ctx) || !can(ctx, 'students', 'edit')) return deny(res);
    const sid = parseInt(params.id, 10);
    if (!scopeLib.canAccessStudent(db, scopeOf(ctx), sid)) return missing(res, 'Student not found.');
    const classId = scopeLib.classOfStudent(db, sid);
    if (!classId || !scopeLib.isClassTeacherOf(scopeOf(ctx), classId)) {
      return deny(res, 'Only the teacher answerable for the class records conduct for its pupils.');
    }
    const KINDS = ['achievement', 'misconduct', 'note', 'health'];
    const kind = KINDS.includes(body.eventType) ? body.eventType : 'note';
    const title = String(body.title || '').trim();
    if (!title) return bad(res, 'Give the entry a title.');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || '')) ? body.date : todayISO();
    const r = db.prepare(`
      INSERT INTO student_events (student_id, event_type, title, description, date, recorded_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sid, kind, title.slice(0, 200), String(body.description || '').slice(0, 2000) || null, date, ctx.user.id);
    reproject(p => p.enqueueRostersForStudents(db, [sid]));
    return json(res, 200, { ok: true, id: r.lastInsertRowid });
  });

  // ── The class's contact book ──────────────────────────────────────────────
  // A teacher who needs to reach a parent had to open a pupil's record, one at
  // a time, and copy a number by hand. This is the whole class in one request:
  // the guardians the school holds, and any registered parent account, so a
  // class teacher can ring or message straight from the roll.
  //
  // Contacts are guarded by the messaging permission, exactly as the per-pupil
  // route is — a teacher who may not contact parents does not get a directory
  // of their phone numbers.
  add('GET', `${API}/classes/:id/contacts`, async (ctx, req, res, params) => {
    if (!isStaff(ctx) || !can(ctx, 'notifications', 'view')) return deny(res);
    const classId = parseInt(params.id, 10);
    if (!classId) return bad(res, 'A class is required.');
    if (!scopeLib.canAccessClass(scopeOf(ctx), classId)) return deny(res, 'That class is not yours.');

    const students = db.prepare(`
      SELECT id, index_number, surname, first_name, other_names, photo_path,
             father_name, father_contact, mother_name, mother_contact,
             guardian_name, guardian_contact
      FROM students WHERE current_class_id = ? AND status = 'Active'
      ORDER BY surname, first_name
    `).all(classId);
    if (!students.length) return json(res, 200, { ok: true, students: [] });

    const ph = students.map(() => '?').join(',');
    let accounts = [];
    try {
      accounts = db.prepare(`
        SELECT ps.student_id, p.full_name, p.phone, p.email
        FROM parent_students ps JOIN parents p ON p.id = ps.parent_id
        WHERE ps.student_id IN (${ph}) AND p.is_active = 1
      `).all(...students.map(s => s.id));
    } catch (_) {}

    return json(res, 200, {
      ok: true,
      students: students.map(s => ({
        id: s.id, index_number: s.index_number, name: fullName(s),
        photo: media.dataUri(s.photo_path),
        guardians: [
          { relation: 'Father', name: s.father_name, contact: s.father_contact },
          { relation: 'Mother', name: s.mother_name, contact: s.mother_contact },
          { relation: 'Guardian', name: s.guardian_name, contact: s.guardian_contact },
        ].filter(g => g.name || g.contact),
        accounts: accounts.filter(a => a.student_id === s.id)
          .map(a => ({ full_name: a.full_name, phone: a.phone, email: a.email })),
      })),
    });
  });

  // ── Canteen: quick pay ────────────────────────────────────────────────────
  // The desktop's morning routine, and the one thing the teacher's app made
  // impossible: a class teacher standing at the door with forty children
  // filing past, marking the day's lunch money in one pass instead of opening
  // forty separate collection forms.
  //
  // It runs the desktop's own code (ipc/canteen_extra.js), so the ledger entry,
  // the term attribution and the daily rate are identical whichever machine the
  // collection was taken on.
  add('GET', `${API}/canteen/quick-pay`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!isStaff(ctx) || !can(ctx, 'canteen', 'view')) return deny(res);
    const classId = parseInt(query.classId, 10);
    if (!classId) return bad(res, 'classId is required.');
    if (!scopeLib.isClassTeacherOf(scopeOf(ctx), classId)) {
      return deny(res, 'The daily collection belongs to the class teacher.');
    }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(query.date || '')) ? query.date : todayISO();
    const extra = require('../ipc/canteen_extra');
    const rate = extra.getDailyRate(db) || 0;
    const roster = extra.classRosterForDate(db, classId, date).map(s => ({
      id: s.id, index_number: s.index_number, name: fullName(s),
      photo: media.dataUri(s.photo_path),
      attendance_status: s.attendance_status,
      canteen_status: s.canteen_status,
    }));
    // Whether the day is a school day at all. Collecting for a holiday is a
    // mistake the desktop's calendar prevents, and the app should say so too.
    let day = null;
    try { day = db.prepare('SELECT day_type, label FROM school_calendar WHERE date = ?').get(date) || null; } catch (_) {}
    return json(res, 200, {
      ok: true, date, daily_rate: rate,
      day_type: day ? day.day_type : null, day_label: day ? day.label : null,
      students: roster,
      totals: {
        on_roll: roster.length,
        paid: roster.filter(r => r.canteen_status === 'paid').length,
        exempt: roster.filter(r => r.canteen_status === 'exempt').length,
        unpaid: roster.filter(r => r.canteen_status === 'unpaid').length,
        absent: roster.filter(r => r.attendance_status === 'absent').length,
      },
    });
  });

  add('POST', `${API}/canteen/quick-pay`, async (ctx, req, res, params, body) => {
    if (!isStaff(ctx) || !can(ctx, 'canteen', 'create')) return deny(res);
    const classId = parseInt(body.classId, 10);
    if (!classId) return bad(res, 'classId is required.');
    if (!scopeLib.isClassTeacherOf(scopeOf(ctx), classId)) {
      return deny(res, 'The daily collection belongs to the class teacher.');
    }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || '')) ? body.date : todayISO();
    const asked = Array.isArray(body.studentIds) ? body.studentIds.map(n => parseInt(n, 10)).filter(Boolean) : [];
    if (!asked.length) return bad(res, 'Choose at least one pupil.');

    // Only pupils actually on this class's roll. An id posted from somewhere
    // else must not become a payment against a child in another teacher's class.
    const onRoll = new Set(db.prepare(
      "SELECT id FROM students WHERE current_class_id = ? AND status = 'Active'"
    ).all(classId).map(r => r.id));
    const ids = asked.filter(id => onRoll.has(id));
    if (!ids.length) return bad(res, 'None of those pupils are on this class roll.');

    let r;
    try {
      r = require('../ipc/canteen_extra').markBulkPaid(db, {
        studentIds: ids, date,
        paymentMethod: body.paymentMethod || 'Cash',
        receivedBy: ctx.user.id || null,
      });
    } catch (e) { return json(res, 500, { ok: false, error: e.message }); }
    if (!r || r.ok === false) return bad(res, (r && r.error) || 'Could not record the collection.');
    reproject(p => p.enqueueRostersForStudents(db, ids));
    try {
      const outbox = require('./sync/outbox');
      for (const id of ids) outbox.enqueueStudentSnapshot(db, id);
    } catch (_) {}
    return json(res, 200, r);
  });

  // Excusing the absent. Charging a child for a lunch they were not at school
  // to eat is the commonest complaint a canteen creates, and the desktop has
  // always had a button for it. Now so does the app.
  add('POST', `${API}/canteen/exempt`, async (ctx, req, res, params, body) => {
    if (!isStaff(ctx) || !can(ctx, 'canteen', 'edit')) return deny(res);
    const classId = parseInt(body.classId, 10);
    if (!classId) return bad(res, 'classId is required.');
    if (!scopeLib.isClassTeacherOf(scopeOf(ctx), classId)) {
      return deny(res, 'The daily collection belongs to the class teacher.');
    }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || '')) ? body.date : todayISO();
    const asked = Array.isArray(body.studentIds) ? body.studentIds.map(n => parseInt(n, 10)).filter(Boolean) : [];
    if (!asked.length) return bad(res, 'Choose at least one pupil.');
    const onRoll = new Set(db.prepare(
      "SELECT id FROM students WHERE current_class_id = ? AND status = 'Active'"
    ).all(classId).map(r => r.id));
    const ids = asked.filter(id => onRoll.has(id));
    if (!ids.length) return bad(res, 'None of those pupils are on this class roll.');

    const extra = require('../ipc/canteen_extra');
    let count = 0, skipped = 0;
    for (const id of ids) {
      const r = extra.markExempt(db, { studentId: id, dates: [date], reason: body.reason || 'Absent' });
      if (r && r.ok) { count += r.count; skipped += r.skipped || 0; }
    }
    reproject(p => p.enqueueRostersForStudents(db, ids));
    // `skipped` is a day already paid for, which is left exactly as it is: a
    // paid day turned into an exemption would strand a real payment row
    // against a day the school now says was free.
    return json(res, 200, { ok: true, count, skipped });
  });

  // ── Homework: withdrawing one ─────────────────────────────────────────────
  add('DELETE', `${API}/homework/:id`, async (ctx, req, res, params) => {
    if (!isStaff(ctx) || !can(ctx, 'academics', 'delete')) return deny(res);
    const hw = require('../ipc/homework');
    const id = parseInt(params.id, 10);
    let classId = null;
    try { classId = db.prepare('SELECT class_group_id AS id FROM homework WHERE id = ?').get(id)?.id || null; } catch (_) {}
    if (classId && !scopeLib.canAccessClass(scopeOf(ctx), classId)) return deny(res, 'That class is not yours.');
    const r = hw.deleteHomework(db, id);
    if (r && r.ok === false) return bad(res, r.error || 'Could not withdraw that assignment.');
    if (classId) reproject(p => p.enqueueClassRoster(db, classId));
    return json(res, 200, { ok: true });
  });

  return { emptyScope };
}

module.exports = { registerStaffRoutes, MAX_HISTORY_DAYS };
