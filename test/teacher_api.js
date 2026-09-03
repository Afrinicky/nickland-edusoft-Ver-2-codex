// Nickland Edusoft — the teacher's API, over the school's own network.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
//   node test/teacher_api.js
//
// Teachers do not get the desktop, so this surface IS their job: the register,
// class work and exam marks, the broadsheet, a pupil's record, lesson notes,
// the canteen sheet, messages, notices, and their own clock-in, leave and
// payslips. It runs the REAL server against a REAL database — no mocks, no
// fixtures standing in for the schema — because the faults worth catching here
// are the ones where a route and a table disagree.
//
// Two things it is really testing:
//
//   1. That every screen the app draws has something behind it. A screen whose
//      endpoint 404s is worse than no screen.
//   2. That scope holds. Permissions say a teacher may edit scores; scope says
//      whose. This server ignored it entirely until this branch, so every check
//      that a second class stays invisible is guarding a fault that was real.

const http = require('http');
const path = require('path');

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`These tests need Node >= 22.5 for node:sqlite (running ${process.versions.node}).`);
  process.exit(1);
}

const { DatabaseSync } = require('node:sqlite');
const ROOT = path.resolve(__dirname, '..');
const { SCHEMA, runMigrations } = require(path.join(ROOT, 'electron/db/database.js'));
const { setSetting } = require(path.join(ROOT, 'electron/utils/idgen.js'));
const { createApiServer } = require(path.join(ROOT, 'electron/server/api.js'));
const bcrypt = require(path.join(ROOT, 'node_modules/bcryptjs'));

let pass = 0, fail = 0;
const ck = (n, c) => { c ? pass++ : fail++; console.log((c ? '✓' : '✗') + ' ' + n); };

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.transaction = (fn) => (...a) => {
    db.exec('BEGIN');
    try { const r = fn(...a); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  db.exec(SCHEMA);
  runMigrations(db);
  setSetting(db, 'school_name', 'Ave Maria School', 'test');
  setSetting(db, 'canteen_daily_rate', '5', 'canteen');
  return db;
}

function req(base, method, p, { token, body } = {}) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(base + p);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
      let d = ''; res.on('data', c => { d += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, json: null }); } });
    });
    r.on('error', () => resolve({ status: 0, json: null }));
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const db = makeDb();

  // ── a school: two classes, a class teacher of one of them ──
  db.exec("INSERT INTO academic_years (id, label, is_current) VALUES (1, '2025/2026', 1)");
  db.exec("INSERT INTO terms (id, academic_year_id, term_number, label, is_current) VALUES (3, 1, 3, 'Third Term', 1)");
  db.exec("INSERT INTO class_groups (id, name, short_code, level_category, level_order) VALUES (1, 'Basic 5', 'B5', 'Primary', 5), (2, 'Basic 6', 'B6', 'Primary', 6)");
  db.exec("INSERT INTO subjects (id, name, code, is_active) VALUES (4, 'Mathematics', 'MTH', 1), (5, 'English', 'ENG', 1)");
  db.exec("INSERT INTO class_subjects (class_group_id, subject_id) VALUES (1,4),(1,5),(2,4),(2,5)");

  db.exec(`INSERT INTO staff (id, surname, first_name, role, status, staff_number, phone)
           VALUES (1, 'OWUSU', 'Kwabena', 'Teaching', 'Active', 'STAFF/0001', '0244000001')`);
  // The two designations this test turns on: one restricted to what it is
  // assigned, one that the school has said is never restricted anywhere.
  db.exec("INSERT INTO designations (id, name) VALUES (1, 'Class Teacher'), (2, 'Administrator')");
  db.prepare(`INSERT INTO users (username, password_hash, full_name, designation_id, staff_id, is_active)
              VALUES ('owusu', ?, 'Mr Owusu', 1, 1, 1)`).run(bcrypt.hashSync('teach123', 8));
  const userId = db.prepare("SELECT id FROM users WHERE username = 'owusu'").get().id;

  // Granted explicitly, so the test does not depend on which designation
  // defaults happen to ship.
  for (const [m, v, c, e, d] of [
    ['students', 1, 0, 1, 0], ['academics', 1, 1, 1, 1], ['canteen', 1, 1, 0, 0],
    ['dashboard', 1, 0, 0, 0], ['fees', 1, 0, 0, 0], ['notifications', 1, 1, 0, 0],
  ]) {
    db.prepare(`INSERT INTO user_permission_overrides (user_id, module, can_view, can_create, can_edit, can_delete)
                VALUES (?, ?, ?, ?, ?, ?)`).run(userId, m, v, c, e, d);
  }
  // Basic 5 outright, and answerable for it. Nothing in Basic 6.
  db.exec('INSERT INTO staff_assignments (staff_id, class_group_id, subject_id, is_class_teacher) VALUES (1, 1, NULL, 1)');

  const pupils = [];
  for (const [idx, sur, first, cls] of [
    ['AVE/001', 'ANSU', 'Monalisa', 1], ['AVE/002', 'BOATENG', 'Kwame', 1],
    ['AVE/003', 'MENSAH', 'Ama', 1], ['AVE/021', 'OTHER', 'Pupil', 2],
  ]) {
    db.prepare(`INSERT INTO students (index_number, surname, first_name, current_class_id, status,
                father_name, father_contact, mother_name, mother_contact)
                VALUES (?, ?, ?, ?, 'Active', ?, ?, ?, ?)`)
      .run(idx, sur, first, cls, `Mr ${sur}`, '0244111222', `Mrs ${sur}`, '0201112223');
    pupils.push(db.prepare('SELECT id FROM students WHERE index_number = ?').get(idx).id);
  }
  const [p1, p2, , outside] = pupils;

  db.prepare(`INSERT INTO student_bills (student_id, term_id, total_billed, total_paid, balance, status)
              VALUES (?, 3, 500, 240, 260, 'active')`).run(p1);
  db.prepare(`INSERT INTO staff_salaries (staff_id, month, year, gross_salary, net_salary, actual_amount_paid, is_paid, payment_date)
              VALUES (1, 7, 2026, 1800, 1620, 1620, 1, '2026-07-28')`).run();
  db.prepare(`INSERT INTO staff_salaries (staff_id, month, year, gross_salary, net_salary, is_paid)
              VALUES (1, 8, 2026, 1800, 1620, 0)`).run();

  const server = createApiServer(db);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  // ── one sign-in box ──
  let r = await req(base, 'POST', '/api/v1/auth/signin', { body: { identifier: 'owusu', password: 'teach123' } });
  ck('the single sign-in box finds a staff account', r.status === 200 && r.json.role === 'staff' && r.json.token);
  const token = r.json.token;

  r = await req(base, 'POST', '/api/v1/auth/signin', { body: { identifier: 'owusu', password: 'wrong' } });
  ck('a wrong password is refused', r.status === 401);
  ck('and says nothing about which accounts are real',
    !/username|user name/i.test(String(r.json && r.json.error)));

  r = await req(base, 'GET', '/api/v1/me', { token });
  ck('me names the school, so the app can head a screen with it', r.json.school && r.json.school.name === 'Ave Maria School');

  // ── scope: one class is theirs, the other is not ──
  r = await req(base, 'GET', '/api/v1/classes', { token });
  const classes = r.json.classes || [];
  ck('only the teacher\'s own class is listed', classes.length === 1 && classes[0].name === 'Basic 5');
  ck('and it says they are answerable for it', classes[0].is_class_teacher === true);

  r = await req(base, 'GET', '/api/v1/students', { token });
  ck('the roll is their class only', (r.json.students || []).length === 3);

  r = await req(base, 'GET', '/api/v1/students?q=BOATENG', { token });
  ck('the roll can be searched', (r.json.students || []).length === 1);

  r = await req(base, 'GET', `/api/v1/students/${outside}`, { token });
  ck('a pupil in another class answers not-found, not forbidden', r.status === 404);

  r = await req(base, 'GET', '/api/v1/attendance?classId=2&date=2026-08-24', { token });
  ck('another class\'s register is refused', r.status === 403);

  r = await req(base, 'POST', '/api/v1/attendance', {
    token, body: { date: '2026-08-24', marks: [{ student_id: outside, status: 'present' }] },
  });
  ck('and so is marking a pupil in it', r.status === 403);

  // A batch is refused whole rather than half-saved.
  r = await req(base, 'POST', '/api/v1/attendance', {
    token, body: { date: '2026-08-24', marks: [{ student_id: p1, status: 'present' }, { student_id: outside, status: 'absent' }] },
  });
  ck('a batch reaching outside the class is refused whole', r.status === 403);
  ck('with none of it written',
    db.prepare('SELECT COUNT(*) c FROM student_attendance WHERE date = ?').get('2026-08-24').c === 0);

  // ── the register ──
  r = await req(base, 'POST', '/api/v1/attendance', {
    token,
    body: {
      date: '2026-08-24',
      marks: [{ student_id: p1, status: 'present' }, { student_id: p2, status: 'absent', notes: 'Sick' }],
    },
  });
  ck('the register saves', r.json.ok && r.json.saved === 2);

  r = await req(base, 'GET', '/api/v1/attendance/history?classId=1&days=30', { token });
  ck('register history counts the day', r.json.marked_days === 1 && r.json.days[0].absent === 1);
  ck('and totals each pupil', (r.json.students || []).find(s => s.id === p2).absent === 1);

  // ── continuous assessment ──
  r = await req(base, 'POST', '/api/v1/assessments/column', {
    token, body: { classId: 1, subjectId: 4, assessmentType: 'Class Test', maxMarks: 20 },
  });
  ck('an assessment column can be added', r.json.ok && r.json.id);
  const columnId = r.json.id;

  r = await req(base, 'POST', '/api/v1/assessments/column', {
    token, body: { classId: 2, subjectId: 4, assessmentType: 'Class Test', maxMarks: 20 },
  });
  ck('but not in a class that is not theirs', r.status === 403);

  r = await req(base, 'POST', '/api/v1/assessments', {
    token, body: { classId: 1, subjectId: 4, marks: [{ student_id: p1, column_id: columnId, marks: 30 }] },
  });
  ck('a mark above what the assessment is out of is refused', r.status === 400);

  r = await req(base, 'POST', '/api/v1/assessments', {
    token, body: { classId: 1, subjectId: 4, marks: [{ student_id: p1, column_id: columnId, marks: 16 }] },
  });
  ck('class work marks save', r.json.ok && r.json.saved === 1);

  r = await req(base, 'GET', '/api/v1/assessments?classId=1&subjectId=4', { token });
  ck('and come back on the sheet',
    (r.json.students || []).find(s => s.id === p1).marks[String(columnId)] === 16);
  ck('with the weighting the school uses', r.json.weights && r.json.weights.classWeight > 0);

  // 16/20 of a 40% class weight is 32; the report card must agree.
  const score = db.prepare('SELECT class_score FROM scores WHERE student_id = ? AND subject_id = 4 AND term_id = 3').get(p1);
  ck('the weighted class score is recomputed, exactly as the desktop does it',
    score && Math.round(score.class_score) === 32);

  // Clearing a mark is not the same as scoring nothing.
  r = await req(base, 'POST', '/api/v1/assessments', {
    token, body: { classId: 1, subjectId: 4, marks: [{ student_id: p1, column_id: columnId, marks: '' }] },
  });
  ck('a cleared mark is removed rather than written as zero',
    r.json.ok && !db.prepare('SELECT 1 FROM assessment_scores WHERE assessment_column_id = ? AND student_id = ?').get(columnId, p1));

  // ── exam marks and the broadsheet ──
  r = await req(base, 'POST', '/api/v1/scores', { token, body: { subjectId: 4, marks: [{ student_id: p1, exam_score: 80 }] } });
  ck('exam marks save', r.json.ok && r.json.saved === 1);

  r = await req(base, 'POST', '/api/v1/scores', { token, body: { subjectId: 4, marks: [{ student_id: outside, exam_score: 80 }] } });
  ck('but not for a pupil in another class', r.status === 403);

  r = await req(base, 'GET', '/api/v1/results?classId=1', { token });
  ck('the broadsheet lists the class', (r.json.students || []).length === 3);
  ck('with a column per subject', (r.json.subjects || []).length === 2);

  r = await req(base, 'GET', '/api/v1/results?classId=2', { token });
  ck('another class\'s broadsheet is refused', r.status === 403);

  r = await req(base, 'POST', '/api/v1/results/remarks', {
    token, body: { studentId: p1, remarks: 'A steady term.', conduct: 'Polite' },
  });
  ck('the class teacher writes the end-of-term remark', r.json.ok);
  ck('and it lands on the report card',
    db.prepare('SELECT teacher_remarks FROM student_term_summary WHERE student_id = ? AND term_id = 3').get(p1).teacher_remarks === 'A steady term.');

  r = await req(base, 'POST', '/api/v1/results/remarks', { token, body: { studentId: outside, remarks: 'No.' } });
  ck('but not for a pupil in a class that is not theirs', r.status === 404 || r.status === 403);

  r = await req(base, 'GET', `/api/v1/results/student/${p1}`, { token });
  ck('a report card carries the marks and the remark',
    r.json.ok && (r.json.subjects || []).length >= 1 && r.json.summary.teacher_remarks === 'A steady term.');

  // ── a pupil's record ──
  r = await req(base, 'GET', `/api/v1/students/${p1}`, { token });
  ck('a pupil\'s record carries who to ring', (r.json.guardians || []).some(g => g.contact === '0244111222'));
  ck('and their attendance this term', r.json.attendance.present === 1);
  ck('and their fees, which this teacher may see', r.json.fees && r.json.fees.balance === 260);

  // ── lesson notes ──
  r = await req(base, 'POST', '/api/v1/lesson-notes', { token, body: { classId: 1, subjectId: 4 } });
  ck('a lesson note with no topic is refused', r.status === 400);

  r = await req(base, 'POST', '/api/v1/lesson-notes', {
    token,
    body: {
      classId: 1, subjectId: 4, topic: 'Adding fractions', lessonDate: '2026-08-24',
      objectives: 'Add fractions with unlike denominators.', status: 'draft',
    },
  });
  ck('a lesson note saves as a draft', r.json.ok && r.json.id);
  const noteId = r.json.id;

  r = await req(base, 'POST', '/api/v1/lesson-notes', { token, body: { classId: 2, topic: 'Nope' } });
  ck('but not against a class that is not theirs', r.status === 403);

  r = await req(base, 'GET', '/api/v1/lesson-notes', { token });
  ck('the teacher sees their own notes', (r.json.notes || []).length === 1);

  r = await req(base, 'POST', '/api/v1/lesson-notes', { token, body: { id: noteId, topic: 'Adding fractions', status: 'submitted' } });
  ck('and can submit one for review', r.json.ok
    && db.prepare('SELECT status FROM lesson_notes WHERE id = ?').get(noteId).status === 'submitted');

  db.prepare("UPDATE lesson_notes SET status = 'approved' WHERE id = ?").run(noteId);
  r = await req(base, 'POST', '/api/v1/lesson-notes', { token, body: { id: noteId, topic: 'Rewritten' } });
  ck('an approved note is no longer theirs to rewrite', r.status === 400);
  r = await req(base, 'DELETE', `/api/v1/lesson-notes/${noteId}`, { token });
  ck('nor to delete', r.status === 400);

  // ── their own employment ──
  r = await req(base, 'GET', '/api/v1/hr/me', { token });
  ck('their own staff record is served', r.json.has_staff && r.json.staff.staff_number === 'STAFF/0001');
  ck('with what they are answerable for', (r.json.assignments || []).some(a => a.is_class_teacher));

  r = await req(base, 'POST', '/api/v1/hr/clock', { token, body: { direction: 'in' } });
  ck('clocking in records a time', r.json.ok && r.json.attendance.clock_in);
  const firstStamp = r.json.attendance.clock_in;
  r = await req(base, 'POST', '/api/v1/hr/clock', { token, body: { direction: 'in' } });
  ck('clocking in twice does not move the first stamp', r.json.attendance.clock_in === firstStamp);
  r = await req(base, 'POST', '/api/v1/hr/clock', { token, body: { direction: 'out' } });
  ck('clocking out records a time', r.json.ok && r.json.attendance.clock_out);

  r = await req(base, 'POST', '/api/v1/hr/leave', {
    token, body: { leaveType: 'Casual', startDate: '2026-09-10', endDate: '2026-09-01', justification: 'x' },
  });
  ck('leave ending before it starts is refused', r.status === 400);

  r = await req(base, 'POST', '/api/v1/hr/leave', {
    token, body: { leaveType: 'Casual', startDate: '2026-09-01', endDate: '2026-09-03', justification: 'Family funeral.' },
  });
  ck('a leave request counts its days', r.json.ok && r.json.days_requested === 3);
  r = await req(base, 'GET', '/api/v1/hr/leave', { token });
  ck('and comes back pending', (r.json.requests || [])[0].status === 'pending');

  r = await req(base, 'GET', '/api/v1/hr/payslips', { token });
  ck('payslips show the month that was paid', (r.json.payslips || []).length === 1 && r.json.payslips[0].month === 7);
  ck('and not the draft the school has not paid yet', !(r.json.payslips || []).some(p => p.month === 8));

  // ── the canteen sheet ──
  r = await req(base, 'GET', '/api/v1/canteen/class?classId=1', { token });
  ck('the canteen sheet lists the class', r.json.ok && (r.json.students || []).length === 3);
  r = await req(base, 'GET', '/api/v1/canteen/class?classId=2', { token });
  ck('and belongs to the class teacher only', r.status === 403);
  r = await req(base, 'GET', `/api/v1/canteen/student/${outside}`, { token });
  ck('a pupil in another class is not theirs to collect from', r.status === 404);

  // ── the daily canteen collection ──
  // The desktop has had this since the first release; the teacher's app had
  // nothing of the kind. What matters is not that it records money — that is
  // the desktop's own code — but that it refuses everything it should:
  // another teacher's class, a pupil who is not on the roll, and a second tap
  // of Record charging the same child twice for the same lunch.
  db.exec("INSERT INTO school_calendar (date, day_type, term_id) VALUES ('2026-06-01', 'school_day', 3)");
  db.prepare("INSERT INTO student_attendance (student_id, date, status, term_id) VALUES (?, '2026-06-01', 'absent', 3)").run(p2);

  r = await req(base, 'GET', '/api/v1/canteen/quick-pay?classId=1&date=2026-06-01', { token });
  ck('the daily collection lists the class for one day', r.json.ok && (r.json.students || []).length === 3);
  ck('and says who is absent, so they are not charged', r.json.totals.absent === 1);
  ck('and carries the daily rate the money is counted at', r.json.daily_rate === 5);
  ck('and knows the day is a school day', r.json.day_type === 'school_day');

  r = await req(base, 'GET', '/api/v1/canteen/quick-pay?classId=2&date=2026-06-01', { token });
  ck('the collection belongs to the class teacher only', r.status === 403);

  r = await req(base, 'POST', '/api/v1/canteen/quick-pay', {
    token, body: { classId: 1, date: '2026-06-01', studentIds: [p1, p2], paymentMethod: 'Cash' },
  });
  ck('recording a collection marks the pupils paid', r.json.ok && r.json.count === 2);
  ck('and totals it at the daily rate', r.json.total === 10);

  r = await req(base, 'POST', '/api/v1/canteen/quick-pay', {
    token, body: { classId: 1, date: '2026-06-01', studentIds: [p1, p2], paymentMethod: 'Cash' },
  });
  ck('a second tap does not charge the same day twice', r.json.ok && r.json.count === 0 && r.json.skipped === 2);

  r = await req(base, 'POST', '/api/v1/canteen/quick-pay', {
    token, body: { classId: 1, date: '2026-06-01', studentIds: [outside] },
  });
  ck('a pupil who is not on the roll cannot be billed through it', r.status === 400);

  r = await req(base, 'POST', '/api/v1/canteen/quick-pay', {
    token, body: { classId: 2, date: '2026-06-01', studentIds: [outside] },
  });
  ck("and another teacher's class is refused outright", r.status === 403);

  // Excusing a pupil forgives money, so it takes canteen.edit — the same
  // permission the desktop's own button takes. This teacher may collect but
  // not excuse, and the app must not offer them a button that comes back 403.
  r = await req(base, 'POST', '/api/v1/canteen/exempt', {
    token, body: { classId: 1, date: '2026-06-01', studentIds: [p1], reason: 'Absent' },
  });
  ck('excusing a pupil takes the same permission the desktop takes', r.status === 403);

  // ── the school's own identity ──
  // The crest and the contact numbers the app draws. Public on purpose: the
  // sign-in screen shows a parent their own school before they type anything.
  r = await req(base, 'GET', '/api/v1/branding');
  ck('the school identity is readable without signing in', r.status === 200 && r.json.ok);
  ck('and names the school', r.json.school.name === 'Ave Maria School');
  ck('and gives somewhere to send a parent who needs to talk',
    typeof r.json.contact.whatsapp === 'string');

  // ── the class contact book ──
  r = await req(base, 'GET', '/api/v1/classes/1/contacts', { token });
  ck("a class teacher can reach the class's guardians", r.json.ok && (r.json.students || []).length === 3);
  ck('and each pupil carries the contacts the office holds',
    (r.json.students || [])[0].guardians.length === 2);
  r = await req(base, 'GET', '/api/v1/classes/2/contacts', { token });
  ck("another class's contacts are not theirs to read", r.status === 403);

  // ── a pupil's record carries the photograph, not the path to it ──
  r = await req(base, 'GET', `/api/v1/students/${p1}`, { token });
  ck('a pupil record no longer leaks a path on the school hard disk',
    !('photo_path' in (r.json.student || {})));
  ck('and carries a printable profile', !!(r.json.profile && r.json.profile.name));

  // ── the terminal report, ready to print ──
  r = await req(base, 'GET', `/api/v1/results/student/${p1}`, { token });
  ck('a report card carries the school header it is printed under',
    r.json.ok && r.json.school && r.json.school.name === 'Ave Maria School');
  ck('and the terms this pupil has marks for', Array.isArray(r.json.terms));

  // ── notices ──
  r = await req(base, 'GET', '/api/v1/announcements', { token });
  ck('notices are readable', r.json.ok && Array.isArray(r.json.announcements));
  r = await req(base, 'POST', '/api/v1/announcements', { token, body: { title: 'x', body: 'y' } });
  ck('posting one needs the right to edit notifications', r.status === 403);

  // ── an administrator is not restricted anywhere ──
  db.prepare(`INSERT INTO users (username, password_hash, full_name, designation_id, is_active)
              VALUES ('head', ?, 'The Head', 2, 1)`).run(bcrypt.hashSync('admin123', 8));
  r = await req(base, 'POST', '/api/v1/auth/signin', { body: { identifier: 'head', password: 'admin123' } });
  const adminToken = r.json.token;
  r = await req(base, 'GET', '/api/v1/classes', { token: adminToken });
  ck('an administrator sees every class', (r.json.classes || []).length === 2);
  r = await req(base, 'GET', `/api/v1/students/${outside}`, { token: adminToken });
  ck('and can open any pupil', r.status === 200);

  r = await req(base, 'POST', '/api/v1/canteen/exempt', {
    token: adminToken, body: { classId: 1, date: '2026-06-01', studentIds: [p1], reason: 'Absent' },
  });
  ck('a day already paid for is not quietly turned into an exemption',
    r.json.ok && r.json.count === 0 && r.json.skipped === 1);
  r = await req(base, 'POST', '/api/v1/canteen/exempt', {
    token: adminToken, body: { classId: 1, date: '2026-06-02', studentIds: [p1], reason: 'Absent' },
  });
  ck('but a day nobody has paid for can be excused', r.json.ok && r.json.count === 1);

  // ── the parent's side of the same school ──
  // Everything the parent portal grew: the itemised bill and its history, the
  // canteen day by day, every term with a report, the register, a printable
  // profile — and a "settle this" that hands the parent to the school instead
  // of taking a card number.
  const parentsLib = require(path.join(ROOT, 'electron/server/parents.js'));
  // A number that matches no guardian on file, so the ONLY link this account
  // has is the explicit one. Using a guardian number here would link the
  // parent to every pupil in the fixture — they all share one — and the check
  // that another family's bill stays shut would pass for the wrong reason.
  const prov = parentsLib.provisionParent(db, {
    full_name: 'Mrs Ansu', phone: '0209999001', password: 'parent123', studentIds: [p1],
  });
  ck('a parent account can be provisioned against a pupil', prov.ok);

  r = await req(base, 'POST', '/api/v1/auth/signin', { body: { identifier: '0209999001', password: 'parent123' } });
  ck('and the same sign-in box finds it', r.status === 200 && r.json.role === 'parent');
  const parentToken = r.json.token;

  r = await req(base, 'GET', '/api/v1/parent/children', { token: parentToken });
  const child = (r.json.children || [])[0];
  ck('a parent sees their own child', r.json.ok && !!child);
  ck('with the class they are in', child.class_name === 'Basic 5');
  ck('and what the school holds is the school teacher, named', 'class_teacher' in child);
  ck('and no path into the school hard disk', !('photo_path' in child));

  r = await req(base, 'GET', `/api/v1/parent/children/${p1}/fees`, { token: parentToken });
  ck("the bill comes back itemised, not as one figure", r.json.ok && r.json.bill.total_billed === 500);
  ck('with every receipt the school has issued', Array.isArray(r.json.payments));
  ck('and a term-by-term history behind the carry-forward', Array.isArray(r.json.history));

  r = await req(base, 'GET', `/api/v1/parent/children/${p1}/canteen`, { token: parentToken });
  ck('the canteen is day by day, not one total', r.json.ok && Array.isArray(r.json.days));

  r = await req(base, 'GET', `/api/v1/parent/children/${p1}/reports`, { token: parentToken });
  ck('every term with marks is offered, not only this one', r.json.ok && (r.json.terms || []).length >= 1);

  r = await req(base, 'GET', `/api/v1/parent/children/${p1}/report`, { token: parentToken });
  ck('a report card carries the grading scale it is read against', Array.isArray(r.json.grading_bands));
  ck('and the school header a printed copy needs', !!(r.json.school && r.json.school.name));

  r = await req(base, 'GET', `/api/v1/parent/children/${p1}/attendance`, { token: parentToken });
  ck('the register is the term day by day', r.json.ok && Array.isArray(r.json.days));

  r = await req(base, 'GET', `/api/v1/parent/children/${p1}/profile`, { token: parentToken });
  ck('and the pupil profile is printable', r.json.ok && !!r.json.student.name);

  r = await req(base, 'GET', `/api/v1/parent/children/${p1}/settle`, { token: parentToken });
  ck('settling a balance moves no money', r.json.ok && !('authorization_url' in r.json));
  ck('it answers with the figure', r.json.owed.fees === 260);
  ck('and with somebody to talk to about it', 'whatsapp' in r.json.contact);

  r = await req(base, 'GET', `/api/v1/parent/children/${outside}/fees`, { token: parentToken });
  ck("another family's bill is not theirs to read", r.status === 403);

  r = await req(base, 'GET', '/api/v1/parent/notifications', { token: parentToken });
  ck("the school's notices reach a parent on the school's own network too",
    r.json.ok && Array.isArray(r.json.announcements));

  r = await req(base, 'GET', `/api/v1/parent/children/${p1}/fees`, { token });
  ck('and a member of staff cannot read the parent routes at all', r.status === 403);

  // ── no money moves through this app ──
  // The card checkout, the "tell the school what you paid" form and the
  // gateway webhook are gone, routes and all. A school takes payment in
  // person; the app shows the figure and says who to talk to.
  for (const path of ['/api/v1/parent/children/1/pay', '/api/v1/parent/children/1/pay/online']) {
    r = await req(base, 'POST', path, { token: adminToken, body: { amount: 10 } });
    ck(`${path} no longer exists`, r.status === 404);
  }
  r = await req(base, 'POST', '/api/v1/webhooks/paystack', { body: {} });
  ck('and there is no payment webhook to settle one', r.status === 404);
  r = await req(base, 'GET', '/api/v1/info');
  ck('the app tells a client plainly that it takes no online payment', r.json.online_payments === false);

  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
