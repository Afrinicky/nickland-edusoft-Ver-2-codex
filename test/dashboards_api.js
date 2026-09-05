// Nickland Edusoft — the dashboards, over the school's own network.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
//   node test/dashboards_api.js
//
// The browser app draws the installed application's dashboards now, and it
// draws them from electron/server/dashboards_api.js. What is worth testing
// here is not that the routes answer — it is that they answer with the SAME
// arithmetic the desktop's IPC handlers use, because the whole point of the
// change is that a head teacher who reads the installed app in the morning and
// the browser in the afternoon is reading one set of figures.
//
// So every case below sets up a school with known numbers and then checks the
// figure, not the shape:
//
//   • canteen owed is unpaid DAYS × the daily rate, not a stored balance,
//   • a collection percentage is collected ÷ billed, rounded the same way,
//   • "expected income" counts pupils who have not been billed yet,
//   • a voided bill is not money the school is owed.
//
// And the access rule, which is the other half: a dashboard is a reading of a
// module, so an account without the module is refused rather than handed a
// page of zeroes.

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
  setSetting(db, 'school_name', 'Ave Maria School Acherensua', 'test');
  setSetting(db, 'school_motto', 'Wisdom, Purity and Knowledge', 'test');
  setSetting(db, 'canteen_daily_rate', '5', 'canteen');
  return db;
}

function req(base, method, p, { token, body } = {}) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(base + p);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers },
      (res) => {
        let d = ''; res.on('data', c => { d += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, json: JSON.parse(d) }); }
          catch { resolve({ status: res.statusCode, json: null }); }
        });
      });
    r.on('error', () => resolve({ status: 0, json: null }));
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const db = makeDb();
  const today = new Date().toISOString().slice(0, 10);

  db.exec("INSERT INTO academic_years (id, label, is_current) VALUES (1, '2025/2026', 1)");
  // A term wide enough to hold today, so "this term" means something whenever
  // the suite is run rather than only in May.
  db.exec(`INSERT INTO terms (id, academic_year_id, term_number, label, is_current, start_date, end_date)
           VALUES (3, 1, 3, 'Third Term', 1, '2000-01-01', '2099-12-31')`);
  db.exec(`INSERT INTO class_groups (id, name, short_code, level_category, level_order, is_active)
           VALUES (1, 'Basic 5', 'B5', 'Primary', 5, 1), (2, 'Basic 6', 'B6', 'Primary', 6, 1)`);
  db.exec(`INSERT INTO designations (id, name) VALUES
           (1, 'Class Teacher'), (2, 'Super Admin'), (3, 'Accountant')`);

  db.exec(`INSERT INTO staff (id, surname, first_name, role, status, staff_number, hire_date)
           VALUES (1, 'OWUSU', 'Kwabena', 'Teaching', 'Active', 'STAFF/0001', '${today}'),
                  (2, 'ASANTE', 'Akua', 'Non-Teaching', 'Active', 'STAFF/0002', '${today}'),
                  (3, 'MENSAH', 'Yaw', 'Teaching', 'Inactive', 'STAFF/0003', '2019-01-01')`);

  const mkUser = (username, password, designationId, staffId) => {
    db.prepare(`INSERT INTO users (username, password_hash, full_name, designation_id, staff_id, is_active)
                VALUES (?, ?, ?, ?, ?, 1)`)
      .run(username, bcrypt.hashSync(password, 8), username.toUpperCase(), designationId, staffId);
    return db.prepare('SELECT id FROM users WHERE username = ?').get(username).id;
  };
  mkUser('nick', 'admin123', 2, null);
  const bursarId = mkUser('bursa', 'bursa123', 3, 2);
  const teacherId = mkUser('owusu', 'teach123', 1, 1);

  const grant = (userId, rows) => {
    for (const [m, v, c, e, d] of rows) {
      db.prepare(`INSERT INTO user_permission_overrides (user_id, module, can_view, can_create, can_edit, can_delete)
                  VALUES (?, ?, ?, ?, ?, ?)`).run(userId, m, v, c, e, d);
    }
  };
  // A bursar with the money and nothing else — no dashboard, no students,
  // no staff. That is the account the refusals below are checked against.
  grant(bursarId, [['fees', 1, 1, 1, 0], ['finance', 1, 1, 1, 0], ['canteen', 1, 1, 1, 0]]);
  grant(teacherId, [['academics', 1, 1, 1, 1], ['students', 1, 0, 1, 0]]);

  // ── the roll ──
  // Four pupils: three active (two boys, one girl) and one graduated, so the
  // status counts and the gender split have something to disagree about if
  // the SQL is wrong.
  const pupils = [];
  for (const [idx, sur, first, cls, gender, status] of [
    ['AVE/001', 'ANSU', 'Monalisa', 1, 'Female', 'Active'],
    ['AVE/002', 'BOATENG', 'Kwame', 1, 'Male', 'Active'],
    ['AVE/003', 'DUUT', 'Esther', 2, 'F', 'Active'],
    ['AVE/004', 'OLD', 'Pupil', 2, 'Male', 'Graduated'],
  ]) {
    db.prepare(`INSERT INTO students (index_number, surname, first_name, current_class_id,
                  gender, status, admission_date)
                VALUES (?, ?, ?, ?, ?, ?, ?)`).run(idx, sur, first, cls, gender, status, today);
    pupils.push(db.prepare('SELECT id FROM students WHERE index_number = ?').get(idx).id);
  }
  const [p1, p2, p3] = pupils;

  // ── the money ──
  // Two bills of 400 and one voided bill of 999. The voided one is the case
  // worth having: a withdrawn bill is not money the school is owed, and a
  // dashboard that counts it tells a head teacher the school is a thousand
  // cedis richer than it is.
  const bill = (studentId, billed, paid, status) =>
    db.prepare(`INSERT INTO student_bills (student_id, term_id, total_billed, total_paid, balance,
                  status, generated_at)
                VALUES (?, 3, ?, ?, ?, ?, datetime('now', '-10 days'))`)
      .run(studentId, billed, paid, billed - paid, status);
  bill(p1, 400, 300, 'active');
  bill(p2, 400, 0, 'active');
  bill(p3, 999, 0, 'voided');

  db.prepare(`INSERT INTO payments (student_id, term_id, amount, payment_date, receipt_number,
                payment_method, is_reversed)
              VALUES (?, 3, 300, ?, 'AVE/17/00001', 'Cash', 0)`).run(p1, today);

  db.prepare(`INSERT INTO income_records (category, amount, transaction_date, date, term_id, receipt_number)
              VALUES ('school_fees', 300, ?, ?, 3, 'TXN/26/00001')`).run(today, today);
  db.prepare(`INSERT INTO expense_records (category, amount, description, transaction_date, date,
                term_id, transaction_number)
              VALUES ('utilities', 120, 'Electricity', ?, ?, 3, 'TXN/26/00002')`).run(today, today);

  // ── the canteen ──
  // Six unpaid days across two pupils at 5.00 a day: the school is owed 30.00,
  // and nothing anywhere stores that figure.
  const canteenDay = (studentId, date, status) =>
    db.prepare('INSERT INTO canteen_day_status (student_id, date, status) VALUES (?, ?, ?)')
      .run(studentId, date, status);
  canteenDay(p1, '2026-06-01', 'unpaid');
  canteenDay(p1, '2026-06-02', 'unpaid');
  canteenDay(p1, '2026-06-03', 'unpaid');
  canteenDay(p2, '2026-06-01', 'unpaid');
  canteenDay(p2, '2026-06-02', 'unpaid');
  canteenDay(p2, '2026-06-03', 'unpaid');
  canteenDay(p3, today, 'paid');
  db.prepare(`INSERT INTO canteen_payments (student_id, amount, payment_date, days_covered, term_id)
              VALUES (?, 5, ?, 1, 3)`).run(p3, today);

  db.prepare(`INSERT INTO staff_salaries (staff_id, month, year, gross_salary, ssnit_worker,
                ssnit_employer, paye_tax, net_salary, is_paid, actual_amount_paid)
              VALUES (1, 7, 2026, 2000, 110, 260, 90, 1800, 1, 1800),
                     (2, 7, 2026, 1000, 55, 130, 20, 925, 0, 0)`).run();

  const server = createApiServer(db);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  const signIn = async (username, password) => {
    const r = await req(base, 'POST', '/api/v1/auth/signin', { body: { identifier: username, password } });
    return r.json && r.json.token;
  };
  const admin = await signIn('nick', 'admin123');
  const bursar = await signIn('bursa', 'bursa123');
  const teacher = await signIn('owusu', 'teach123');
  ck('everybody can sign in', !!admin && !!bursar && !!teacher);

  let r;

  // ══ The main dashboard ═══════════════════════════════════════════════════

  r = await req(base, 'GET', '/api/v1/dash/main', { token: admin });
  ck('the main dashboard answers', r.status === 200 && r.json.ok);
  const m = (r.json && r.json.metrics) || {};

  ck('...with the school it belongs to', r.json.school
    && r.json.school.name === 'Ave Maria School Acherensua'
    && r.json.school.motto === 'Wisdom, Purity and Knowledge');
  ck('...and the running term', r.json.term && r.json.term.label === 'Third Term'
    && r.json.term.year_label === '2025/2026');

  ck('the roll counts only active pupils', m.student_total === 3);
  ck('...across the classes they are actually in', m.class_count === 2);
  ck('active staff excludes the ones who have left', m.staff_active === 2);

  ck('income is the term ledger, not the receipts', m.income_total === 300);
  ck('fees collected is the payments taken this term', m.fees_collected === 300);

  // 400 + 400 billed on the two active bills; the voided 999 is not owed.
  ck('outstanding excludes a withdrawn bill', m.fees_outstanding === 500);
  ck('...and so does the amount billed', m.total_billed === 800);
  ck('...and the debtor count', m.debtor_count === 2);
  ck('the collection rate is collected over billed', m.collection_pct === 38);

  // Six unpaid days at 5.00. Nothing stores 30; if the route reads a column
  // instead of multiplying, this is the case that says so.
  ck('canteen owed is unpaid days times the daily rate', m.canteen_owed === 30);
  ck('...over the pupils who are actually behind', m.canteen_unpaid_students === 2);

  ck('the income series is there to chart', Array.isArray(r.json.charts.income_by_month)
    && r.json.charts.income_by_month.length === 1
    && Number(r.json.charts.income_by_month[0].total) === 300);
  ck('...and the expenditure series beside it', Array.isArray(r.json.charts.expense_by_month)
    && Number(r.json.charts.expense_by_month[0].total) === 120);

  // Both kinds of receipt, newest first, in one list — which is what the
  // desktop shows and what neither /finance/collections nor the canteen
  // endpoint could answer on its own.
  const recent = r.json.recent_payments || [];
  ck('recent payments carry fee and canteen receipts together',
    recent.length === 2
    && recent.some(p => p.payment_type === 'Fee Payment')
    && recent.some(p => p.payment_type === 'Canteen Payment'));

  const feeDebtors = r.json.top_fee_debtors || [];
  ck('the fee debtors are biggest first', feeDebtors.length === 2
    && Number(feeDebtors[0].balance) === 400);
  ck('...and say how long the bill has been standing',
    feeDebtors[0].days_outstanding >= 9 && feeDebtors[0].days_outstanding <= 11);
  ck('...and which class to send for', feeDebtors[0].class_code === 'B5');

  const canteenDebtors = r.json.top_canteen_debtors || [];
  ck('the canteen debtors owe days times the rate', canteenDebtors.length === 2
    && Number(canteenDebtors[0].unpaid_days) === 3
    && Number(canteenDebtors[0].amount_owed) === 15);

  ck('the school day comes with it', (r.json.schedule || []).length === 6
    && r.json.schedule[0].title === 'Morning Assembly');

  // The gate. A bursar has the money and not the dashboard, and is refused
  // rather than shown a page of zeroes.
  r = await req(base, 'GET', '/api/v1/dash/main', { token: bursar });
  ck('an account without the dashboard module is refused', r.status === 403);

  // ══ Students ═════════════════════════════════════════════════════════════

  r = await req(base, 'GET', '/api/v1/dash/students', { token: admin });
  ck('the students dashboard answers', r.status === 200 && r.json.ok);
  const sm = r.json.metrics || {};
  ck('...counting every pupil ever admitted', sm.total === 4);
  ck('...the active ones', sm.active === 3);
  ck('...and the ones who finished', sm.graduated === 1);
  // 'F' and 'Female' are the same child written down by two people.
  ck('gender is read however the office wrote it', sm.male === 1 && sm.female === 2);
  ck('...as a percentage of the active roll', sm.male_pct === 33 && sm.female_pct === 67);
  ck('the class distribution is biggest first',
    (r.json.by_class || []).length === 2 && r.json.by_class[0].count === 2);
  ck('recent admissions carry the class to put them in',
    (r.json.recent_admissions || []).length === 4
    && r.json.recent_admissions.every(s => 'class_name' in s));

  r = await req(base, 'GET', '/api/v1/dash/students', { token: teacher });
  ck('a teacher with Students may read it', r.status === 200 && r.json.ok);

  // ══ Fees ═════════════════════════════════════════════════════════════════

  r = await req(base, 'GET', '/api/v1/dash/fees', { token: bursar });
  ck('the fees dashboard answers a bursar', r.status === 200 && r.json.ok);
  const fm = r.json.metrics || {};
  ck('billed is the active bills only', fm.total_billed === 800);
  ck('collected is what came in', fm.total_collected === 300);
  ck('outstanding is what did not', fm.outstanding === 500);
  ck('the collection rate matches the main dashboard', fm.collection_pct === 38);
  ck('the debtor count matches it too', fm.debtor_count === 2);
  // Pupil three's bill was withdrawn, so they have no active bill — and this
  // school has written no fee template, so nothing can be projected for them
  // either. That is the case the desktop calls out in red: "1 pupil no
  // template covers". It is not the same as owing nothing, and a dashboard
  // that reports "expected GHS 800" without it is telling the office the term
  // is fully billed when a child has been left off.
  ck('a pupil no template covers is counted as unbillable', fm.unbillable_students === 1);
  ck('...and not silently folded into the projection', fm.unbilled_students === 0);
  ck('expected income is the bills that exist, plus nothing invented',
    fm.expected_income === 800 && fm.expected_billed === 800);
  ck('per-class collection is broken out',
    (r.json.by_class || []).length >= 1
    && r.json.by_class.every(c => 'total_billed' in c && 'total_paid' in c));

  r = await req(base, 'GET', '/api/v1/dash/fees', { token: teacher });
  ck('a teacher without Fees is refused the fee position', r.status === 403);

  // ══ Canteen ══════════════════════════════════════════════════════════════

  r = await req(base, 'GET', '/api/v1/dash/canteen', { token: bursar });
  ck('the canteen dashboard answers', r.status === 200 && r.json.ok);
  const cm = r.json.metrics || {};
  ck('...with the rate the arithmetic rests on', Number(r.json.daily_rate) === 5);
  ck('collected is the canteen money, not the fees', cm.total_collected === 5);
  ck('owed is days times the rate', cm.amount_owed === 30);
  ck('...over six unpaid days', cm.unpaid_days_total === 6);
  ck('...and two pupils', cm.unpaid_students === 2);
  ck("today's status counts what was actually marked", cm.today_paid === 1);

  // ══ Staff ════════════════════════════════════════════════════════════════

  r = await req(base, 'GET', '/api/v1/dash/staff', { token: admin });
  ck('the staff dashboard answers', r.status === 200 && r.json.ok);
  const stm = r.json.metrics || {};
  ck('...separating who is on the books from who has left',
    stm.total_active === 2 && stm.total_inactive === 1 && stm.total_all === 3);
  ck('clock-in reports the switch rather than assuming it', stm.clockin_enabled === false);
  ck('the staff room is broken down by role', (r.json.by_role || []).length === 2);
  ck('recent hires are the last six months', (r.json.recent_hires || []).length === 2);

  r = await req(base, 'GET', '/api/v1/dash/staff', { token: bursar });
  ck('a bursar without Staff is refused the staff room', r.status === 403);

  // ══ Payroll ══════════════════════════════════════════════════════════════

  r = await req(base, 'GET', '/api/v1/dash/payroll?month=7&year=2026', { token: admin });
  ck('the payroll dashboard answers for a named month', r.status === 200 && r.json.ok);
  const pm = r.json.metrics || {};
  ck('...with the month named in words', r.json.month_label === 'Jul 2026');
  ck('gross is the run before deductions', pm.gross === 3000);
  ck('net is what leaves the account', pm.net === 2725);
  ck('SSNIT is the worker and the employer, and their sum',
    pm.ssnit_employee === 165 && pm.ssnit_employer === 390 && pm.ssnit_combined === 555);
  ck('PAYE is what the GRA is owed', pm.paye === 110);
  ck('the employer cost is gross plus the employer contribution', pm.employer_cost === 3390);
  ck('what is still owing is net less what was paid', pm.outstanding === 925);

  r = await req(base, 'GET', '/api/v1/dash/payroll?month=13&year=2026', { token: admin });
  ck('a month that does not exist is refused rather than guessed', r.status === 400);

  // ══ Finance ══════════════════════════════════════════════════════════════

  r = await req(base, 'GET', '/api/v1/dash/finance', { token: bursar });
  ck('the finance dashboard answers', r.status === 200 && r.json.ok);
  const nm = r.json.metrics || {};
  ck('income is the ledger for the term', nm.income_total === 300);
  ck('expenditure likewise', nm.expense_total === 120);
  ck('net is one less the other', nm.net === 180);
  ck('active staff is on it for the wage bill', nm.staff_active === 2);
  ck('income is broken down by category',
    (r.json.income_by_category || []).some(c => c.category === 'school_fees'));
  ck('and expenditure too',
    (r.json.expense_by_category || []).some(c => c.category === 'utilities'));
  ck('the last entries of each are there to read',
    (r.json.recent_income || []).length === 1 && (r.json.recent_expenses || []).length === 1);
  ck('it says whether this account may record anything', r.json.may && r.json.may.record === true);

  r = await req(base, 'GET', '/api/v1/dash/finance', { token: teacher });
  ck('a teacher is refused the books', r.status === 403);

  // ══ Academics ════════════════════════════════════════════════════════════

  r = await req(base, 'GET', '/api/v1/dash/academics', { token: teacher });
  ck('the academics dashboard answers a teacher', r.status === 200 && r.json.ok);
  ck('...with a term, and empty rather than broken before any marks',
    r.json.term && Array.isArray(r.json.class_performance) && Array.isArray(r.json.top_students));

  r = await req(base, 'GET', '/api/v1/dash/academics', { token: bursar });
  ck('a bursar is refused the marks', r.status === 403);

  // ── The rule that holds all of them ──
  r = await req(base, 'GET', '/api/v1/dash/main');
  ck('no token reaches no dashboard', r.status === 401 || r.status === 403);

  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
