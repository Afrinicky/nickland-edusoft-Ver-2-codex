// Nickland Edusoft — the portals, and what each of them refuses.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
//   node test/portals.js
//
// The product's rule is that what you may not open, you do not see. Portals
// make that rule bigger: a class teacher is not shown that a finance office
// exists inside their app, and a bursar is not shown the user table.
//
// Hiding is the easy half and it is not the half that matters. Every check
// here is really asking the second question — with the navigation hidden, what
// happens when somebody types the URL anyway? So each portal is exercised by
// an account that holds it AND by one that does not, against the REAL server
// and a REAL database.
//
// Five accounts, which are the five kinds of person a Ghanaian basic school
// actually has:
//
//   Mr Owusu     Class Teacher   — teaching only
//   Mrs Asante   Accountant      — fees, finance, payroll; no academics
//   Mr Boateng   Head Teacher    — the school, but not the system
//   Ms Adjei     Administrator   — everything, including the system
//   Mrs Ansu     a parent        — one child, and nothing else at all

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
const portals = require(path.join(ROOT, 'electron/ipc/_portals.js'));
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

function req(base, method, p, { token, body, headers: extra } = {}) {
  return new Promise((resolve) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const u = new URL(base + p);
    const headers = { 'Content-Type': 'application/json', ...(extra || {}) };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
      let d = ''; res.on('data', c => { d += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, json: null, text: d }); } });
    });
    r.on('error', () => resolve({ status: 0, json: null }));
    if (data) r.write(data);
    r.end();
  });
}

const LEVELS = { no: [0, 0, 0, 0], view: [1, 0, 0, 0], contribute: [1, 1, 0, 0], manage: [1, 1, 1, 0], full: [1, 1, 1, 1] };

(async () => {
  const db = makeDb();

  db.exec("INSERT INTO academic_years (id, label, is_current) VALUES (1, '2025/2026', 1)");
  db.exec(`INSERT INTO terms (id, academic_year_id, term_number, label, is_current, start_date, end_date)
           VALUES (3, 1, 3, 'Third Term', 1, '2026-05-01', '2026-08-31')`);
  db.exec("INSERT INTO class_groups (id, name, short_code, level_category, level_order) VALUES (1, 'Basic 5', 'B5', 'Primary', 5), (2, 'Basic 6', 'B6', 'Primary', 6)");
  db.exec("INSERT INTO subjects (id, name, code, is_active) VALUES (4, 'Mathematics', 'MTH', 1)");
  db.exec("INSERT INTO class_subjects (class_group_id, subject_id) VALUES (1,4),(2,4)");

  db.exec(`INSERT INTO staff (id, surname, first_name, role, status, staff_number, phone, base_salary)
           VALUES (1, 'OWUSU', 'Kwabena', 'Teaching', 'Active', 'STAFF/0001', '0244000001', 1800),
                  (2, 'ASANTE', 'Efua', 'Non-Teaching', 'Active', 'STAFF/0002', '0244000002', 2200),
                  (3, 'BOATENG', 'Yaw', 'Teaching', 'Active', 'STAFF/0003', '0244000003', 3000)`);
  db.exec(`INSERT INTO designations (id, name) VALUES
             (1, 'Class Teacher'), (2, 'Accountant'), (3, 'Head Teacher'), (4, 'Administrator')`);

  // The permission ladder each designation is granted, written out rather than
  // inherited from the seed, so this test says what it depends on.
  const grant = (designationId, map) => {
    for (const [module, level] of Object.entries(map)) {
      const [v, c, e, d] = LEVELS[level];
      db.prepare(`INSERT INTO designation_permissions (designation_id, module, can_view, can_create, can_edit, can_delete)
                  VALUES (?, ?, ?, ?, ?, ?)`).run(designationId, module, v, c, e, d);
    }
  };
  grant(1, { dashboard: 'view', students: 'view', academics: 'full', canteen: 'manage' });
  grant(2, { dashboard: 'view', students: 'view', fees: 'full', finance: 'full', payroll: 'view', canteen: 'view' });
  grant(3, { dashboard: 'full', students: 'full', academics: 'full', fees: 'view', canteen: 'full',
             staff: 'full', notifications: 'full' });
  grant(4, { dashboard: 'full', students: 'full', academics: 'full', fees: 'full', canteen: 'full',
             staff: 'full', payroll: 'full', finance: 'full', notifications: 'full', settings: 'full' });

  const mkUser = (username, name, designationId, staffId) => {
    db.prepare(`INSERT INTO users (username, password_hash, full_name, designation_id, staff_id, is_active)
                VALUES (?, ?, ?, ?, ?, 1)`).run(username, bcrypt.hashSync('pass1234', 8), name, designationId, staffId);
    return db.prepare('SELECT id FROM users WHERE username = ?').get(username).id;
  };
  const teacherId = mkUser('owusu', 'Mr Owusu', 1, 1);
  mkUser('asante', 'Mrs Asante', 2, 2);
  mkUser('boateng', 'Mr Boateng', 3, 3);
  mkUser('adjei', 'Ms Adjei', 4, null);
  db.exec('INSERT INTO staff_assignments (staff_id, class_group_id, subject_id, is_class_teacher) VALUES (1, 1, NULL, 1)');

  const pupils = [];
  for (const [idx, sur, first, cls] of [
    ['AVE/001', 'ANSU', 'Monalisa', 1], ['AVE/002', 'BOATENG', 'Kwame', 1], ['AVE/021', 'OTHER', 'Pupil', 2],
  ]) {
    db.prepare(`INSERT INTO students (index_number, surname, first_name, current_class_id, status, admission_date)
                VALUES (?, ?, ?, ?, 'Active', '2026-01-08')`).run(idx, sur, first, cls);
    pupils.push(db.prepare('SELECT id FROM students WHERE index_number = ?').get(idx).id);
  }
  const [p1, p2] = pupils;
  for (const sid of pupils) {
    db.prepare(`INSERT INTO student_bills (student_id, term_id, total_billed, total_paid, balance, status, generated_at)
                VALUES (?, 3, 600, 200, 400, 'active', '2026-05-05')`).run(sid);
  }
  db.prepare(`INSERT INTO payments (student_id, term_id, amount, payment_date, payment_method, receipt_number, is_reversed)
              VALUES (?, 3, 200, '2026-05-10', 'Cash', 'OPENING/26/0001', 0)`).run(p1);
  db.prepare(`INSERT INTO income_records (receipt_number, category, amount, transaction_date, date, term_id)
              VALUES ('TX/0001', 'fees', 200, '2026-05-10', '2026-05-10', 3)`).run();
  db.prepare(`INSERT INTO expense_records (transaction_number, category, amount, description, transaction_date, date, term_id)
              VALUES ('TX/0002', 'supplies', 80, 'Chalk and exercise books', '2026-05-11', '2026-05-11', 3)`).run();
  db.prepare(`INSERT INTO staff_salaries (staff_id, month, year, gross_salary, net_salary, actual_amount_paid, is_paid)
              VALUES (1, 5, 2026, 1800, 1620, 1620, 1)`).run();
  db.prepare(`INSERT INTO leave_requests (staff_id, leave_type, start_date, end_date, days_requested, justification, status)
              VALUES (1, 'Casual', '2026-06-01', '2026-06-03', 3, 'Family funeral', 'pending')`).run();
  db.prepare(`INSERT INTO lesson_notes (staff_id, class_group_id, subject_id, term_id, week_number, topic, status)
              VALUES (1, 1, 4, 3, 4, 'Fractions', 'submitted')`).run();
  db.prepare("INSERT INTO student_attendance (student_id, date, status, term_id) VALUES (?, date('now'), 'present', 3)").run(p1);
  db.prepare("INSERT INTO student_attendance (student_id, date, status, term_id) VALUES (?, date('now'), 'absent', 3)").run(p2);
  db.prepare("INSERT INTO scores (student_id, term_id, subject_id, class_score, exam_score, total_score) VALUES (?, 3, 4, 30, 40, 70)").run(p1);

  // A parent, registered against one child.
  const parents = require(path.join(ROOT, 'electron/server/parents.js'));
  const reg = parents.provisionParent(db, {
    full_name: 'Mrs Ansu', phone: '0244111222', password: 'parent1234', studentIds: [p1],
  });
  if (!reg.ok) { console.error('could not register the parent:', reg.error); process.exit(1); }
  db.prepare('INSERT OR IGNORE INTO parent_students (parent_id, student_id) VALUES (?, ?)').run(reg.parent_id, p1);

  const server = createApiServer(db, {});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const signIn = async (username) => {
    const r = await req(base, 'POST', '/api/v1/auth/login', { body: { username, password: 'pass1234' } });
    return r.json && r.json.token;
  };
  const teacher = await signIn('owusu');
  const bursar = await signIn('asante');
  const head = await signIn('boateng');
  const admin = await signIn('adjei');
  const parentRes = await req(base, 'POST', '/api/v1/auth/parent/login',
    { body: { identifier: '0244111222', password: 'parent1234' } });
  const parent = parentRes.json && parentRes.json.token;
  ck('every account signs in', !!(teacher && bursar && head && admin && parent));

  // ── who is handed which portal ────────────────────────────────────────────
  const keysOf = (me) => (me.json.portals || []).map(p => p.key);

  let r = await req(base, 'GET', '/api/v1/me', { token: teacher });
  ck('a class teacher is given the teaching portal and no other',
    JSON.stringify(keysOf(r)) === JSON.stringify(['teacher']));
  ck('...and is landed in it', r.json.home_portal === 'teacher');

  r = await req(base, 'GET', '/api/v1/me', { token: bursar });
  ck('an accountant is given teaching and finance',
    JSON.stringify(keysOf(r)) === JSON.stringify(['teacher', 'finance']));
  ck('...and starts the morning in finance, not in a register',
    r.json.home_portal === 'finance');

  r = await req(base, 'GET', '/api/v1/me', { token: head });
  ck('a head teacher is given administration as well',
    JSON.stringify(keysOf(r)) === JSON.stringify(['teacher', 'finance', 'admin']));
  ck('...but NOT the system itself', !keysOf(r).includes('system'));

  r = await req(base, 'GET', '/api/v1/me', { token: admin });
  ck('an administrator is given all four staff portals',
    JSON.stringify(keysOf(r)) === JSON.stringify(['teacher', 'finance', 'admin', 'system']));
  ck('...and still lands on the school rather than on the user table',
    r.json.home_portal === 'admin');

  r = await req(base, 'GET', '/api/v1/me', { token: parent });
  ck('a parent is given the parent portal and nothing else',
    JSON.stringify(keysOf(r)) === JSON.stringify(['parent']));

  // ── the finance portal ────────────────────────────────────────────────────
  r = await req(base, 'GET', '/api/v1/finance/overview', { token: bursar });
  ck('the bursar sees the term’s fee position',
    r.json.ok && r.json.fees.billed === 1800 && r.json.fees.collected === 200 && r.json.fees.outstanding === 1200);
  ck('...and the ledger, because they hold finance',
    r.json.ledger.income === 200 && r.json.ledger.expense === 80 && r.json.ledger.net === 120);
  ck('...and the month’s payroll position', r.json.payroll && r.json.payroll.staff >= 0);

  r = await req(base, 'GET', '/api/v1/finance/overview', { token: teacher });
  ck('a class teacher typing the finance URL is refused', r.status === 403);
  r = await req(base, 'GET', '/api/v1/finance/debtors', { token: teacher });
  ck('...and the arrears list with it', r.status === 403);
  r = await req(base, 'GET', '/api/v1/finance/payroll', { token: teacher });
  ck('...and payroll, which is nobody’s business but the office’s', r.status === 403);

  // The head teacher holds `fees: view` and neither finance nor payroll. The
  // portal opens; the parts they may not see are absent rather than empty.
  r = await req(base, 'GET', '/api/v1/finance/overview', { token: head });
  ck('a head teacher with fees but not finance sees the fee position',
    r.json.ok && !!r.json.fees);
  ck('...and is not shown the school’s expenditure at all',
    r.json.ledger === undefined && r.json.expense_categories === undefined);
  ck('...nor the payroll', r.json.payroll === undefined);
  r = await req(base, 'GET', '/api/v1/finance/payroll', { token: head });
  ck('...and cannot reach payroll by typing it either', r.status === 403);
  r = await req(base, 'GET', '/api/v1/finance/expenses', { token: head });
  ck('...nor the expenditure list', r.status === 403);

  // Taking money. `fees: view` is not `fees: create`.
  r = await req(base, 'POST', '/api/v1/finance/collections',
    { token: head, body: { studentId: p1, amount: 50 } });
  ck('a head teacher who may only READ fees cannot take a payment', r.status === 403);

  r = await req(base, 'POST', '/api/v1/finance/collections',
    { token: bursar, body: { studentId: p1, amount: 150, method: 'Cash' } });
  ck('the bursar takes a payment and it is receipted',
    r.json.ok && /^FE\//.test(r.json.receipt_number));
  const paymentId = r.json.payment_id;
  ck('...and the bill is reduced by exactly that',
    db.prepare('SELECT balance FROM student_bills WHERE student_id = ? AND term_id = 3').get(p1).balance === 250);
  ck('...and the ledger has the income against it',
    db.prepare('SELECT COUNT(*) c FROM income_records WHERE linked_payment_id = ?').get(paymentId).c === 1);
  ck('...and the audit trail names who took it',
    db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action = 'record_payment'").get().c === 1);

  r = await req(base, 'POST', '/api/v1/finance/collections',
    { token: bursar, body: { studentId: p1, amount: -50 } });
  ck('a negative payment is refused', r.status === 400);
  r = await req(base, 'POST', '/api/v1/finance/collections',
    { token: bursar, body: { studentId: 99999, amount: 50 } });
  ck('a payment for a pupil who is not on the roll is refused', r.status === 404);

  // Reversal: the bursar has fees:full, and it is still not enough.
  r = await req(base, 'POST', `/api/v1/finance/collections/${paymentId}/reverse`,
    { token: bursar, body: { reason: 'Paid into the wrong account' } });
  ck('even a bursar with full fees access cannot reverse a payment', r.status === 403);
  r = await req(base, 'POST', `/api/v1/finance/collections/${paymentId}/reverse`,
    { token: admin, body: { reason: '' } });
  ck('an administrator cannot reverse one without saying why', r.status === 400);
  r = await req(base, 'POST', `/api/v1/finance/collections/${paymentId}/reverse`,
    { token: admin, body: { reason: 'Paid into the wrong account' } });
  ck('an administrator, with a reason, can', r.json.ok);
  ck('...and the reversal is its own ledger entry rather than a rubbed-out one',
    db.prepare("SELECT COUNT(*) c FROM expense_records WHERE category = 'refund'").get().c === 1);
  r = await req(base, 'POST', `/api/v1/finance/collections/${paymentId}/reverse`,
    { token: admin, body: { reason: 'Trying it twice' } });
  ck('...and it cannot be reversed a second time', r.status === 400);

  r = await req(base, 'GET', `/api/v1/finance/students/${p1}/bill`, { token: bursar });
  ck('a pupil’s account shows the bill and every receipt against it',
    r.json.ok && r.json.bill.billed === 600 && Array.isArray(r.json.history) && r.json.history.length >= 1);

  r = await req(base, 'GET', '/api/v1/finance/statement', { token: bursar });
  ck('the statement adds up', r.json.ok && r.json.totals.income >= 200 && r.json.totals.expense >= 80);

  r = await req(base, 'POST', '/api/v1/finance/expenses',
    { token: bursar, body: { category: 'maintenance', amount: 120, description: 'Repaired the borehole pump' } });
  ck('the bursar records an expense', r.json.ok && r.json.id > 0);
  r = await req(base, 'POST', '/api/v1/finance/expenses',
    { token: bursar, body: { category: 'maintenance', amount: 120 } });
  ck('...but not one that does not say what it was for', r.status === 400);

  // ── the administration portal ─────────────────────────────────────────────
  r = await req(base, 'GET', '/api/v1/admin/overview', { token: head });
  ck('the head teacher sees the school this morning',
    r.json.ok && r.json.enrolment.total === 3 && r.json.attendance.present === 1 && r.json.attendance.absent === 1);
  ck('...and what is waiting to be approved',
    r.json.approvals.leave === 1 && r.json.approvals.lesson_notes === 1);
  ck('...and the fee position, because they may see fees', !!r.json.fees);

  r = await req(base, 'GET', '/api/v1/admin/overview', { token: bursar });
  ck('the bursar cannot open administration', r.status === 403);
  r = await req(base, 'GET', '/api/v1/admin/students', { token: bursar });
  ck('...nor the whole roll through it', r.status === 403);
  r = await req(base, 'GET', '/api/v1/admin/staff', { token: teacher });
  ck('a class teacher cannot read the staff register', r.status === 403);

  r = await req(base, 'GET', '/api/v1/admin/staff/1', { token: head });
  ck('a head teacher opens a staff record', r.json.ok && r.json.staff.name === 'OWUSU Kwabena');
  ck('...and is NOT shown what they earn, which is payroll',
    r.json.may_see_pay === false && r.json.staff.base_salary === undefined);
  r = await req(base, 'GET', '/api/v1/admin/staff/1', { token: admin });
  ck('an administrator, who holds payroll, is', r.json.may_see_pay === true && r.json.staff.base_salary === 1800);

  r = await req(base, 'POST', '/api/v1/admin/leave/1/decision', { token: head, body: { decision: 'approved' } });
  ck('the head teacher approves the leave request', r.json.ok);
  r = await req(base, 'POST', '/api/v1/admin/leave/1/decision', { token: head, body: { decision: 'approved' } });
  ck('...and cannot approve it twice', r.status === 400);
  r = await req(base, 'POST', '/api/v1/admin/lesson-notes/1/decision', { token: head, body: { decision: 'approved' } });
  ck('...and signs off the lesson note', r.json.ok);

  r = await req(base, 'POST', '/api/v1/admin/students',
    { token: head, body: { surname: 'NKRUMAH', firstName: 'Adwoa', classId: 1, gender: 'Female' } });
  ck('the head teacher admits a pupil', r.json.ok && !!r.json.index_number);
  const admitted = r.json.id;
  r = await req(base, 'POST', '/api/v1/admin/students', { token: head, body: { surname: 'NKRUMAH' } });
  ck('...but not one without a first name', r.status === 400);
  r = await req(base, 'POST', `/api/v1/admin/students/${admitted}/status`,
    { token: head, body: { status: 'Withdrawn' } });
  ck('withdrawing a pupil without a reason is refused', r.status === 400);
  r = await req(base, 'POST', `/api/v1/admin/students/${admitted}/status`,
    { token: head, body: { status: 'Withdrawn', reason: 'Family relocated to Kumasi' } });
  ck('...and with one, it is done and logged as serious',
    r.json.ok && db.prepare("SELECT severity FROM audit_log WHERE action = 'student_status' ORDER BY id DESC LIMIT 1").get().severity === 'high');

  r = await req(base, 'GET', '/api/v1/admin/academics', { token: head });
  ck('academic oversight reports the classes', r.json.ok && r.json.classes.length === 2);
  ck('...with the average of the marks actually entered',
    (r.json.classes.find(c => c.id === 1) || {}).average === 70);

  // ── the system portal ─────────────────────────────────────────────────────
  for (const [who, token] of [['a class teacher', teacher], ['a bursar', bursar], ['a head teacher', head]]) {
    r = await req(base, 'GET', '/api/v1/system/users', { token });
    ck(`${who} cannot read the user table`, r.status === 403);
    r = await req(base, 'GET', '/api/v1/system/audit', { token });
    ck(`${who} cannot read the audit trail`, r.status === 403);
    r = await req(base, 'POST', '/api/v1/system/access',
      { token, body: { designationId: 1, levels: { finance: 'full' } } });
    ck(`${who} cannot grant themselves anything`, r.status === 403);
  }

  r = await req(base, 'GET', '/api/v1/system/overview', { token: admin });
  ck('an administrator sees the system', r.json.ok && r.json.counts.users === 4);
  r = await req(base, 'GET', '/api/v1/system/users', { token: admin });
  ck('...and the accounts in it', r.json.ok && r.json.users.length === 4);

  r = await req(base, 'POST', '/api/v1/system/users',
    { token: admin, body: { username: 'mensah', fullName: 'Mr Mensah', password: 'short', designationId: 1 } });
  ck('a new account cannot be given a five-character password', r.status === 400);
  r = await req(base, 'POST', '/api/v1/system/users',
    { token: admin, body: { username: 'mensah', fullName: 'Mr Mensah', password: 'abcd1234', designationId: 1 } });
  ck('an administrator creates an account', r.json.ok && r.json.must_change_password === true);
  const newUser = r.json.id;
  r = await req(base, 'POST', '/api/v1/system/users',
    { token: admin, body: { username: 'mensah', fullName: 'Another', password: 'abcd1234' } });
  ck('...and cannot create the same username twice', r.status === 400);

  r = await req(base, 'POST', `/api/v1/system/users/${newUser}/status`, { token: admin, body: { active: false } });
  ck('an account can be deactivated', r.json.ok);
  const adminUserId = db.prepare("SELECT id FROM users WHERE username = 'adjei'").get().id;
  r = await req(base, 'POST', `/api/v1/system/users/${adminUserId}/status`, { token: admin, body: { active: false } });
  ck('...but never the one you are signed in with', r.status === 400);

  // Access levels. The ladder is written and read back as levels, and the two
  // designations the system will not let anybody weaken stay full.
  r = await req(base, 'GET', '/api/v1/system/access', { token: admin });
  ck('the access screen reads back as levels, not as four ticks',
    r.json.ok && r.json.designations.find(d => d.name === 'Class Teacher').levels.academics === 'full');
  ck('...and Administrator is locked at full',
    r.json.designations.find(d => d.name === 'Administrator').locked === true);
  r = await req(base, 'POST', '/api/v1/system/access',
    { token: admin, body: { designationId: 4, levels: { finance: 'no' } } });
  ck('...and cannot be weakened, which is what locks the school out', r.status === 400);
  r = await req(base, 'POST', '/api/v1/system/access',
    { token: admin, body: { designationId: 1, levels: { fees: 'nonsense' } } });
  ck('an unknown level is refused rather than stored', r.status === 400);

  // Granting a portal, and watching it appear. This is the whole model in one
  // check: a permission changes, and what the teacher's app is told it may
  // open changes with it — without anybody signing in again.
  r = await req(base, 'GET', '/api/v1/me', { token: teacher });
  ck('before the grant, the teacher has no finance portal', !keysOf(r).includes('finance'));
  await req(base, 'POST', '/api/v1/system/access',
    { token: admin, body: { designationId: 1, levels: { fees: 'view' } } });
  r = await req(base, 'GET', '/api/v1/me', { token: teacher });
  ck('after it, the finance portal is there on the very next request',
    keysOf(r).includes('finance'));
  r = await req(base, 'GET', '/api/v1/finance/debtors', { token: teacher });
  ck('...and the arrears list opens', r.json.ok);
  r = await req(base, 'GET', '/api/v1/finance/expenses', { token: teacher });
  ck('...but only the part that was granted', r.status === 403);
  await req(base, 'POST', '/api/v1/system/access',
    { token: admin, body: { designationId: 1, levels: { fees: 'no' } } });
  r = await req(base, 'GET', '/api/v1/finance/debtors', { token: teacher });
  ck('and withdrawing it closes the door again immediately', r.status === 403);

  // ── settings, and the secret that never comes back ────────────────────────
  r = await req(base, 'POST', '/api/v1/system/settings',
    { token: admin, body: { settings: { paystack_secret_key: 'sk_test_supersecret', payment_gateway: 'paystack', online_payments_enabled: 'true' } } });
  ck('an administrator configures the gateway', r.json.ok);
  r = await req(base, 'GET', '/api/v1/system/settings', { token: admin });
  ck('...and the secret is never read back out of it',
    !('paystack_secret_key' in r.json.settings)
    && JSON.stringify(r.json).indexOf('sk_test_supersecret') === -1);
  ck('...only whether one is set at all',
    r.json.secrets.some(s => s.key === 'paystack_secret_key' && s.configured === true));
  ck('...and the audit row does not quote it either',
    !db.prepare("SELECT justification FROM audit_log WHERE action = 'change_settings' ORDER BY id DESC LIMIT 1")
        .get().justification.includes('sk_test_'));

  r = await req(base, 'GET', '/api/v1/info');
  ck('with a gateway configured and switched on, the app says it takes payment',
    r.json.online_payments === true);

  // ── the webhook, now that there is a gateway to sign for one ──────────────
  const body = JSON.stringify({ event: 'charge.success', data: { reference: 'NE-1-deadbeef' } });
  r = await req(base, 'POST', '/api/v1/payments/webhook/paystack', { body: JSON.parse(body) });
  ck('a webhook with no signature is rejected', r.status === 401);
  r = await req(base, 'POST', '/api/v1/payments/webhook/paystack',
    { body: JSON.parse(body), headers: { 'x-paystack-signature': 'a'.repeat(128) } });
  ck('a webhook with a wrong signature is rejected', r.status === 401);
  ck('...and both are recorded as security events',
    db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action = 'webhook_rejected' AND severity = 'high'").get().c === 2);

  const crypto = require('crypto');
  const good = crypto.createHmac('sha512', 'sk_test_supersecret').update(body, 'utf8').digest('hex');
  r = await req(base, 'POST', '/api/v1/payments/webhook/paystack',
    { body: JSON.parse(body), headers: { 'x-paystack-signature': good } });
  ck('a correctly signed webhook is accepted', r.status === 200);
  await new Promise(res => setTimeout(res, 50));
  ck('...but a reference nobody started still settles nothing',
    db.prepare('SELECT COUNT(*) c FROM payments WHERE reference IS NOT NULL').get().c === 0);

  r = await req(base, 'POST', '/api/v1/payments/webhook/momo',
    { body: JSON.parse(body), headers: { 'x-paystack-signature': good } });
  ck('a gateway the school does not use is not even acknowledged', r.status === 404);

  // ── a parent reaches none of it ───────────────────────────────────────────
  for (const p of ['/api/v1/finance/overview', '/api/v1/admin/overview', '/api/v1/system/users',
                   '/api/v1/finance/debtors', '/api/v1/admin/staff']) {
    r = await req(base, 'GET', p, { token: parent });
    ck(`a parent is refused ${p}`, r.status === 403);
  }

  // ── and the model itself agrees with the server ───────────────────────────
  // The app decides what to draw from the same rules. If these two ever
  // disagree, a menu item appears that leads to a refusal.
  const permsOf = (username) => {
    const id = db.prepare('SELECT id FROM users WHERE username = ?').get(username).id;
    const desig = db.prepare(`
      SELECT d.name FROM users u LEFT JOIN designations d ON d.id = u.designation_id WHERE u.id = ?
    `).get(id).name;
    return {
      role: 'staff',
      is_admin: ['Proprietor', 'Administrator'].includes(desig),
      permissions: require(path.join(ROOT, 'electron/ipc/auth.js')).resolveEffectivePermissions(db, id),
    };
  };
  for (const [username, token] of [['owusu', teacher], ['asante', bursar], ['boateng', head], ['adjei', admin]]) {
    const fromServer = keysOf(await req(base, 'GET', '/api/v1/me', { token }));
    const fromModel = portals.portalsFor(permsOf(username));
    ck(`the portal model and the server agree about ${username}`,
      JSON.stringify(fromServer) === JSON.stringify(fromModel));
  }

  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
