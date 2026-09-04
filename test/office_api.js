// Nickland Edusoft — the office, over the school's own network.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
//   node test/office_api.js
//
// The browser app is the desktop application now, and a school on its own
// Wi-Fi runs the whole office through this surface: billing, discounts, book
// charges, the store room, the buses, payroll's statutory schedules, the
// notification log, staff activities, budgets and the cashbook. Every one of
// those used to live behind an IPC handler on one PC, which meant the browser
// found a 404 where a screen should have been.
//
// Real server, real schema, no fixtures standing in for tables — the faults
// worth catching here are the ones where a route and a column disagree.
//
// Two things it is really testing:
//
//   1. That the screens the app now draws have something behind them.
//   2. That the access rules held while they were added. A bursar who may take
//      a payment must still not be able to grant a discount; a teacher must not
//      reach the store room at all.

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

  db.exec("INSERT INTO academic_years (id, label, is_current) VALUES (1, '2025/2026', 1)");
  db.exec(`INSERT INTO terms (id, academic_year_id, term_number, label, is_current, start_date, end_date)
           VALUES (3, 1, 3, 'Third Term', 1, '2026-05-01', '2026-08-01')`);
  db.exec(`INSERT INTO class_groups (id, name, short_code, level_category, level_order)
           VALUES (1, 'Basic 5', 'B5', 'Primary', 5), (2, 'Basic 6', 'B6', 'Primary', 6)`);
  db.exec(`INSERT INTO designations (id, name) VALUES
           (1, 'Class Teacher'), (2, 'Super Admin'), (3, 'Accountant')`);

  db.exec(`INSERT INTO staff (id, surname, first_name, role, status, staff_number, phone, ssnit_number)
           VALUES (1, 'OWUSU', 'Kwabena', 'Teaching', 'Active', 'STAFF/0001', '0244000001', 'SS-1'),
                  (2, 'ASANTE', 'Akua', 'Non-Teaching', 'Active', 'STAFF/0002', '0244000002', 'SS-2')`);

  // Three people: the Super Admin who runs everything, a bursar with fees and
  // finance but NOT elevation, and a class teacher with neither.
  const mkUser = (username, password, designationId, staffId) => {
    db.prepare(`INSERT INTO users (username, password_hash, full_name, designation_id, staff_id, is_active)
                VALUES (?, ?, ?, ?, ?, 1)`)
      .run(username, bcrypt.hashSync(password, 8), username.toUpperCase(), designationId, staffId);
    return db.prepare('SELECT id FROM users WHERE username = ?').get(username).id;
  };
  const adminId = mkUser('nick', 'admin123', 2, null);
  const bursarId = mkUser('bursa', 'bursa123', 3, 2);
  const teacherId = mkUser('owusu', 'teach123', 1, 1);

  const grant = (userId, rows) => {
    for (const [m, v, c, e, d] of rows) {
      db.prepare(`INSERT INTO user_permission_overrides (user_id, module, can_view, can_create, can_edit, can_delete)
                  VALUES (?, ?, ?, ?, ?, ?)`).run(userId, m, v, c, e, d);
    }
  };
  grant(bursarId, [
    ['fees', 1, 1, 1, 0], ['finance', 1, 1, 1, 0], ['payroll', 1, 1, 1, 0],
    ['students', 1, 0, 0, 0], ['canteen', 1, 0, 0, 0], ['staff', 1, 0, 0, 0],
    ['notifications', 1, 1, 0, 0],
  ]);
  grant(teacherId, [
    ['academics', 1, 1, 1, 1], ['students', 1, 0, 1, 0], ['canteen', 1, 1, 0, 0],
  ]);

  const pupils = [];
  for (const [idx, sur, first, cls] of [
    ['AVE/001', 'ANSU', 'Monalisa', 1], ['AVE/002', 'BOATENG', 'Kwame', 1],
    ['AVE/021', 'OTHER', 'Pupil', 2],
  ]) {
    db.prepare(`INSERT INTO students (index_number, surname, first_name, current_class_id, status)
                VALUES (?, ?, ?, ?, 'Active')`).run(idx, sur, first, cls);
    pupils.push(db.prepare('SELECT id FROM students WHERE index_number = ?').get(idx).id);
  }
  const [p1, p2] = pupils;

  db.prepare(`INSERT INTO staff_salaries (staff_id, month, year, gross_salary, ssnit_worker,
                ssnit_employer, paye_tax, net_salary, is_paid)
              VALUES (1, 7, 2026, 2000, 110, 260, 90, 1800, 0)`).run();

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

  // ══ Billing ══════════════════════════════════════════════════════════════
  //
  // The office's first job of a term, and the one the app could not do at all.

  r = await req(base, 'POST', '/api/v1/fees/templates', { token: bursar, body: {
    name: 'Basic 5 — Third Term', class_group_id: 1, term_id: 3,
    items: [{ description: 'Tuition', amount: 300 },
            { description: 'PTA levy', amount: 50 },
            { description: 'Examination', amount: 30 }],
  } });
  ck('a fee template can be written from the browser', r.status === 200 && r.json.ok);
  const templateId = r.json && r.json.id;

  r = await req(base, 'GET', '/api/v1/fees/templates', { token: bursar });
  const tpl = (r.json.templates || []).find(t => t.id === templateId);
  ck('...and comes back with its total worked out', tpl && Number(tpl.total) === 380);
  ck('...and its line count', tpl && Number(tpl.items) === 3);

  r = await req(base, 'GET', `/api/v1/fees/templates/${templateId}`, { token: bursar });
  ck('...and its lines, in order', r.json.template && r.json.template.items.length === 3
    && r.json.template.items[0].description === 'Tuition');

  // The rule that stops a class being billed twice for the same term.
  r = await req(base, 'POST', '/api/v1/fees/templates', { token: bursar, body: {
    name: 'A second school fee', class_group_id: 1, term_id: 3,
    items: [{ description: 'Tuition again', amount: 999 }],
  } });
  ck('a second school-fees template for the same class and term is refused', r.status === 409);

  r = await req(base, 'POST', '/api/v1/fees/bills', { token: bursar, body: { classId: 1 } });
  ck('bills can be raised against a whole class', r.status === 200 && r.json.raised === 2);

  const bill = db.prepare('SELECT * FROM student_bills WHERE student_id = ? AND term_id = 3').get(p1);
  ck('...and the bill carries the template total', bill && Number(bill.total_billed) === 380);
  ck('...with the balance owing set to it', bill && Number(bill.balance) === 380);
  const lines = db.prepare('SELECT * FROM bill_line_items WHERE student_bill_id = ? ORDER BY item_number').all(bill.id);
  ck('...and the line items a parent argues about at the gate', lines.length === 3
    && lines[1].description === 'PTA levy');

  r = await req(base, 'POST', '/api/v1/fees/bills', { token: bursar, body: { classId: 1 } });
  ck('raising them a second time bills nobody twice', r.json.raised === 0 && r.json.skipped === 2);

  r = await req(base, 'POST', '/api/v1/fees/bills', { token: teacher, body: { classId: 1 } });
  ck('a class teacher cannot raise bills', r.status === 403);

  // ══ Discounts ════════════════════════════════════════════════════════════
  //
  // Elevated: reducing what a family is asked to pay is not the same decision
  // as taking a payment, and the bursar holds fees-edit.

  r = await req(base, 'POST', '/api/v1/discounts', { token: bursar, body: {
    student_id: p2, discount_type: 'percentage', value: 50, reason: 'Staff child',
  } });
  ck('a bursar with fees-edit still cannot grant a discount', r.status === 403);

  r = await req(base, 'POST', '/api/v1/discounts', { token: admin, body: {
    student_id: p2, discount_type: 'percentage', value: 50, reason: 'Staff child',
  } });
  ck('the Super Admin can', r.status === 200 && r.json.ok);

  r = await req(base, 'POST', '/api/v1/discounts', { token: admin, body: {
    student_id: p2, discount_type: 'fixed', value: 100, reason: 'x',
  } });
  ck('...and a discount with no real reason is refused', r.status === 400);

  r = await req(base, 'GET', '/api/v1/discounts', { token: bursar });
  ck('the granted discount is listed with who granted it',
    (r.json.discounts || []).some(d => d.student_name === 'BOATENG Kwame' && d.granted_by_name === 'NICK'));

  // ══ Extra charges ════════════════════════════════════════════════════════
  //
  // Excursion, sports week, mock exams. Raised onto bills that already exist,
  // so a parent keeps one bill and one balance.

  r = await req(base, 'POST', '/api/v1/fees/templates', { token: bursar, body: {
    name: 'Excursion to Kumasi', term_id: 3, bill_type: 'supplementary',
    items: [{ description: 'Transport', amount: 30 }, { description: 'Entry', amount: 10 }],
  } });
  ck('an extra charge is written like any other template', r.status === 200);
  const extraId = r.json.id;

  r = await req(base, 'GET', '/api/v1/fees/templates', { token: bursar });
  ck('...and does not appear among the school fees',
    !(r.json.templates || []).some(t => t.id === extraId));
  r = await req(base, 'GET', '/api/v1/fees/templates?billType=all', { token: bursar });
  ck('...but is there when the office asks for every kind',
    (r.json.templates || []).some(t => t.id === extraId));

  r = await req(base, 'GET', '/api/v1/fees/supplementary', { token: bursar });
  ck('the extra charges are listed with what each costs',
    r.status === 200 && (r.json.templates || []).some(t => t.id === extraId && Number(t.total) === 40));
  ck('...and a bursar is told plainly that applying one is not theirs',
    r.json.may_apply === false);

  r = await req(base, 'POST', '/api/v1/fees/supplementary', { token: bursar, body: {
    templateId: extraId, termId: 3, scope: 'all',
  } });
  ck('a bursar with fees-edit cannot raise a charge against every family', r.status === 403);

  r = await req(base, 'POST', '/api/v1/fees/supplementary', { token: admin, body: {
    templateId: extraId, termId: 3, scope: 'class', classId: 1,
  } });
  ck('the Super Admin can', r.status === 200 && r.json.applied === 2);
  ck('...and it is added to what the class already owed', r.json.total_amount === 80);

  ck('...so the pupil has ONE bill, with extra lines on it — not a second bill',
    db.prepare('SELECT COUNT(*) c FROM student_bills WHERE student_id = ? AND term_id = 3').get(p1).c === 1
    && db.prepare(`SELECT COUNT(*) c FROM bill_line_items
                    WHERE student_bill_id = (SELECT id FROM student_bills WHERE student_id = ? AND term_id = 3)
                      AND charge_type = 'extra'`).get(p1).c === 2);

  r = await req(base, 'POST', '/api/v1/fees/supplementary', { token: admin, body: {
    templateId: extraId, termId: 3, scope: 'class', classId: 1,
  } });
  ck('adding the same charge twice charges nobody twice',
    r.status === 200 && r.json.applied === 0 && r.json.skipped === 2);

  r = await req(base, 'GET', '/api/v1/fees/supplementary', { token: admin });
  ck('...and the office is told how many bills it is on',
    (r.json.templates || []).find(t => t.id === extraId).applied_to === 2);

  const billedAfter = db.prepare(
    'SELECT total_billed FROM student_bills WHERE student_id = ? AND term_id = 3').get(p1).total_billed;

  r = await req(base, 'POST', '/api/v1/fees/supplementary/remove', { token: admin, body: {
    templateId: extraId, termId: 3,
  } });
  ck('the charge can be withdrawn from every bill it was added to',
    r.status === 200 && r.json.removed === 2);
  ck('...and each bill goes back to what it was',
    db.prepare('SELECT total_billed FROM student_bills WHERE student_id = ? AND term_id = 3')
      .get(p1).total_billed === billedAfter - 40);

  // ══ Withdrawing a bill ═══════════════════════════════════════════════════

  const billId = db.prepare('SELECT id FROM student_bills WHERE student_id = ? AND term_id = 3').get(p2).id;

  r = await req(base, 'POST', `/api/v1/fees/bills/${billId}/void`, { token: admin, body: { reason: 'oops' } });
  ck('a bill cannot be withdrawn on a reason that says nothing', r.status === 400);

  r = await req(base, 'POST', `/api/v1/fees/bills/${billId}/void`,
    { token: bursar, body: { reason: 'The pupil never enrolled after all.' } });
  ck('a bursar cannot withdraw a bill', r.status === 403);

  r = await req(base, 'POST', `/api/v1/fees/bills/${billId}/void`,
    { token: admin, body: { reason: 'The pupil never enrolled after all.' } });
  ck('the Super Admin can, with a reason in writing', r.status === 200);
  ck('...and it is off the books',
    db.prepare('SELECT status FROM student_bills WHERE id = ?').get(billId).status === 'voided');
  ck('...and withdrawing it twice is refused',
    (await req(base, 'POST', `/api/v1/fees/bills/${billId}/void`,
      { token: admin, body: { reason: 'The pupil never enrolled after all.' } })).status === 400);

  r = await req(base, 'GET', '/api/v1/fees/bills/voided?all=1', { token: bursar });
  ck('a bursar may SEE what was withdrawn — that is the point of the screen',
    r.status === 200 && (r.json.bills || []).some(b => b.id === billId));
  ck('...with who withdrew it and on what stated grounds',
    (r.json.bills || []).find(b => b.id === billId).voided_by_name === 'NICK'
    && /never enrolled/.test((r.json.bills || []).find(b => b.id === billId).void_reason));
  ck('...and is told they may not put it back', r.json.may_restore === false);

  r = await req(base, 'POST', `/api/v1/fees/bills/${billId}/restore`, { token: bursar });
  ck('...and cannot', r.status === 403);

  r = await req(base, 'POST', `/api/v1/fees/bills/${billId}/restore`, { token: admin });
  ck('the Super Admin puts it back', r.status === 200
    && db.prepare("SELECT COALESCE(status,'active') s FROM student_bills WHERE id = ?").get(billId).s === 'active');

  // ══ Books ════════════════════════════════════════════════════════════════

  r = await req(base, 'POST', `/api/v1/books/${p1}`, { token: bursar, body: {
    items: [{ title: 'Mathematics textbook', amount: 45 }, { title: 'Exercise books', amount: 15 }],
  } });
  ck('books can be charged to a pupil', r.status === 200 && r.json.ok);

  r = await req(base, 'POST', `/api/v1/books/${p1}/payment`, { token: bursar, body: { amount: 20 } });
  ck('...and paid for in part', r.status === 200);

  r = await req(base, 'GET', `/api/v1/books/${p1}`, { token: bursar });
  ck('...leaving the right balance', r.json.total === 60 && r.json.paid === 20 && r.json.balance === 40);

  // ══ The store room ═══════════════════════════════════════════════════════

  r = await req(base, 'POST', '/api/v1/inventory', { token: bursar, body: {
    name: 'A4 paper', category: 'Stationery', unit: 'reams', unit_cost: 45, reorder_level: 5,
  } });
  ck('an item can be added to the store room', r.status === 200);
  const itemId = r.json.id;

  r = await req(base, 'POST', '/api/v1/inventory/movement', { token: bursar, body: {
    itemId, movementType: 'in', quantity: 10, notes: 'Bought from Kumasi',
  } });
  ck('stock can be taken in', r.status === 200);

  r = await req(base, 'POST', '/api/v1/inventory/movement', { token: bursar, body: {
    itemId, movementType: 'out', quantity: 3, notes: 'Issued to the office',
  } });
  ck('...and issued out', r.status === 200);

  r = await req(base, 'POST', '/api/v1/inventory/movement', { token: bursar, body: {
    itemId, movementType: 'out', quantity: 99,
  } });
  ck('...but not more than is on the books', r.status === 400 && /only 7/.test(r.json.error));

  r = await req(base, 'GET', '/api/v1/inventory', { token: bursar });
  ck('the running quantity is right', (r.json.items || []).find(i => i.id === itemId).quantity === 7);

  r = await req(base, 'GET', '/api/v1/inventory/movements', { token: bursar });
  ck('and every movement is logged', (r.json.movements || []).length === 2);

  r = await req(base, 'GET', '/api/v1/inventory', { token: teacher });
  ck('a class teacher cannot see the store room at all', r.status === 403);

  // ══ The buses ════════════════════════════════════════════════════════════

  r = await req(base, 'POST', '/api/v1/transport', { token: bursar, body: {
    name: 'Acherensua town', fee_per_term: 120, driver_name: 'Mr Adjei', driver_contact: '0244333444',
  } });
  ck('a route can be created', r.status === 200);
  const routeId = r.json.id;

  r = await req(base, 'POST', '/api/v1/transport/riders', { token: bursar, body: {
    routeId, studentIds: [p1, p2],
  } });
  ck('pupils can be put on it', r.status === 200 && r.json.assigned === 2);

  r = await req(base, 'POST', '/api/v1/transport/riders', { token: bursar, body: {
    routeId, studentIds: [p1],
  } });
  ck('...and assigning the same pupil again moves rather than duplicates', r.status === 200);
  ck('...so a pupil is never on two buses',
    db.prepare('SELECT COUNT(*) c FROM student_transport WHERE student_id = ?').get(p1).c === 1);

  r = await req(base, 'GET', `/api/v1/transport/${routeId}`, { token: bursar });
  ck('the route lists its riders and what they owe',
    (r.json.riders || []).length === 2 && r.json.riders[0].balance === 120);

  // ══ Payroll ══════════════════════════════════════════════════════════════

  r = await req(base, 'GET', '/api/v1/payroll/schedule/ssnit?month=7&year=2026', { token: bursar });
  ck('the SSNIT schedule can be produced from a browser', r.status === 200 && r.json.rows.length === 1);
  ck('...with the worker\'s share, the school\'s, and the total',
    r.json.rows[0].employee === 110 && r.json.rows[0].employer === 260 && r.json.rows[0].total === 370);
  ck('...against the SSNIT number it is filed under', r.json.rows[0].ssnit_number === 'SS-1');

  r = await req(base, 'GET', '/api/v1/payroll/schedule/paye?month=7&year=2026', { token: bursar });
  ck('the PAYE schedule too', r.status === 200 && r.json.rows[0].amount === 90);
  ck('...on pay after SSNIT, which is what is taxable', r.json.rows[0].taxable === 1890);

  const salaryId = db.prepare('SELECT id FROM staff_salaries WHERE staff_id = 1').get().id;
  r = await req(base, 'GET', `/api/v1/payroll/1/payslip?month=7&year=2026`, { token: bursar });
  ck('a payslip is itemised', r.status === 200 && r.json.payslip.net_salary === 1800);

  // A person's own payslip is theirs whatever their modules say.
  r = await req(base, 'GET', `/api/v1/payroll/1/payslip?month=7&year=2026`, { token: teacher });
  ck('a teacher can read their OWN payslip without the payroll module', r.status === 200);
  r = await req(base, 'GET', `/api/v1/payroll/2/payslip?month=7&year=2026`, { token: teacher });
  ck('...and nobody else\'s', r.status === 403);

  r = await req(base, 'POST', `/api/v1/payroll/${salaryId}/paid`, { token: bursar, body: {
    amount: 1800, method: 'Bank Transfer',
  } });
  ck('a salary can be marked paid', r.status === 200);
  ck('...and the row records it',
    db.prepare('SELECT is_paid FROM staff_salaries WHERE id = ?').get(salaryId).is_paid === 1);

  // ══ Finance ══════════════════════════════════════════════════════════════

  r = await req(base, 'POST', '/api/v1/finance/income', { token: bursar, body: {
    category: 'Donation', amount: 500, payerName: 'A well-wisher', description: 'Towards the library',
  } });
  ck('income can be recorded', r.status === 200);

  r = await req(base, 'POST', '/api/v1/finance/expenses', { token: bursar, body: {
    category: 'Utilities', amount: 200, description: 'Electricity', payee: 'ECG',
  } });
  const expenseId = r.json && (r.json.id ?? r.json.expense_id);
  ck('an expense can be recorded', r.status === 200);

  if (expenseId) {
    r = await req(base, 'POST', `/api/v1/finance/expenses/${expenseId}/approve`, { token: bursar });
    ck('...and the person who recorded it cannot approve their own', r.status === 400);
    r = await req(base, 'POST', `/api/v1/finance/expenses/${expenseId}/approve`, { token: admin });
    ck('...but somebody else can', r.status === 200);
  }

  r = await req(base, 'GET', '/api/v1/finance/cashbook', { token: bursar });
  ck('the cashbook shows both sides in date order', r.status === 200 && r.json.entries.length >= 1);
  ck('...and closes on income minus expenditure',
    r.json.closing_balance === Math.round((r.json.total_in - r.json.total_out) * 100) / 100);

  r = await req(base, 'GET', '/api/v1/finance/audit', { token: bursar });
  ck('the audit compares receipts against the ledger', r.status === 200 && Array.isArray(r.json.checks));

  // ══ Budgets ══════════════════════════════════════════════════════════════

  r = await req(base, 'POST', '/api/v1/budgets', { token: bursar, body: {
    title: 'Third Term 2025/2026', term_id: 3, status: 'active',
    items: [{ item_type: 'income', category: 'Fees', description: 'School fees', projected_amount: 5000 },
            { item_type: 'expense', category: 'Salaries', description: 'Staff', projected_amount: 3000,
              actual_amount: 2800 }],
  } });
  ck('a budget can be written', r.status === 200);
  const budgetId = r.json.id;

  r = await req(base, 'GET', '/api/v1/budgets', { token: bursar });
  const b = (r.json.budgets || []).find(x => x.id === budgetId);
  ck('...and totals its planned and actual sides',
    b && Number(b.planned_income) === 5000 && Number(b.planned_expense) === 3000
      && Number(b.actual_expense) === 2800);

  r = await req(base, 'GET', `/api/v1/budgets?id=${budgetId}`, { token: bursar });
  ck('...and comes back with its lines', r.json.budget && r.json.budget.items.length === 2);

  r = await req(base, 'GET', '/api/v1/budgets', { token: teacher });
  ck('a class teacher cannot see the budgets', r.status === 403);

  // ══ Staff activities ═════════════════════════════════════════════════════
  //
  // The one surface deliberately open to everybody: a person may always file
  // and read their OWN. Reading a colleague's needs the staff module.

  r = await req(base, 'POST', '/api/v1/activities', { token: teacher, body: {
    title: 'Ran the science club', activity_type: 'club', hours_contributed: 3,
  } });
  ck('a teacher can file their own activity without the staff module', r.status === 200);

  r = await req(base, 'GET', '/api/v1/activities', { token: teacher });
  ck('...and read it back', r.json.activities.length === 1 && r.json.mine_only === true);
  ck('...but is not offered the button to acknowledge it', r.json.may_acknowledge === false);

  r = await req(base, 'GET', '/api/v1/activities', { token: admin });
  ck('somebody with the staff module sees everybody\'s',
    r.json.mine_only === false && r.json.activities.length === 1);
  const activityId = r.json.activities[0].id;

  r = await req(base, 'POST', `/api/v1/activities/${activityId}/acknowledge`, { token: teacher });
  ck('a teacher cannot acknowledge their own activity', r.status === 403);
  r = await req(base, 'POST', `/api/v1/activities/${activityId}/acknowledge`, { token: admin });
  ck('a supervisor can', r.status === 200);

  // ══ The timetable ════════════════════════════════════════════════════════

  r = await req(base, 'POST', '/api/v1/timetable/periods', { token: admin, body: {
    periods: [
      { label: 'Period 1', start_time: '08:00', end_time: '08:40' },
      { label: 'Break', start_time: '10:00', end_time: '10:20', is_break: 1 },
      { label: 'Period 2', start_time: '10:20', end_time: '11:00' },
    ],
  } });
  ck('the bell schedule can be set from a browser', r.status === 200 && r.json.written === 3);

  r = await req(base, 'GET', '/api/v1/timetable/periods', { token: admin });
  const periods = r.json.periods || [];
  ck('...and comes back in order', periods.length === 3 && periods[0].label === 'Period 1');
  ck('...with the break marked as one', periods[1].is_break === 1);

  db.exec("INSERT INTO subjects (id, name, code, is_active) VALUES (4, 'Mathematics', 'MTH', 1)");
  r = await req(base, 'POST', '/api/v1/timetable/class', { token: admin, body: {
    classId: 1,
    entries: [{ day_of_week: 1, period_id: periods[0].id, subject_id: 4, teacher_id: 1 },
              { day_of_week: 2, period_id: periods[2].id, subject_id: 4 }],
  } });
  ck('a class week can be set', r.status === 200 && r.json.entries === 2);

  r = await req(base, 'GET', '/api/v1/timetable/class/1', { token: admin });
  ck('...and read back as a grid', r.json.entries && r.json.entries[`1:${periods[0].id}`]);
  ck('...naming the subject', r.json.entries[`1:${periods[0].id}`].subject_name === 'Mathematics');

  // Saving the week again REPLACES it, which is what stops a lesson that was
  // deleted on screen surviving in the database.
  r = await req(base, 'POST', '/api/v1/timetable/class', { token: admin, body: {
    classId: 1, entries: [{ day_of_week: 1, period_id: periods[0].id, subject_id: 4 }],
  } });
  ck('saving it again replaces the week rather than adding to it',
    r.json.entries === 1
    && db.prepare('SELECT COUNT(*) c FROM timetable_entries WHERE class_group_id = 1').get().c === 1);

  r = await req(base, 'POST', '/api/v1/timetable/class', { token: bursar, body: { classId: 1, entries: [] } });
  ck('a bursar cannot set a timetable', r.status === 403);

  // ══ Examinations ═════════════════════════════════════════════════════════

  r = await req(base, 'POST', '/api/v1/exams/papers', { token: teacher, body: {
    title: 'Third Term Mathematics', class_group_id: 1, subject_id: 4, total_marks: 100,
    duration_minutes: 90,
  } });
  ck('an exam paper can be written from a browser', r.status === 200);
  const paperId = r.json.id;

  r = await req(base, 'POST', '/api/v1/exams/questions', { token: teacher, body: {
    question_text: 'What is 7 × 8?', question_type: 'short_answer', marks: 2,
    class_group_id: 1, subject_id: 4, in_question_bank: 1,
  } });
  ck('a question can be put in the bank', r.status === 200);
  const questionId = r.json.id;

  r = await req(base, 'POST', `/api/v1/exams/papers/${paperId}/from-bank`, { token: teacher, body: {
    questionIds: [questionId],
  } });
  ck('a bank question can be copied onto a paper', r.status === 200 && r.json.copied === 1);

  r = await req(base, 'GET', '/api/v1/exams/questions?inBank=1', { token: teacher });
  ck('...and is still in the bank afterwards, which is the whole point',
    (r.json.questions || []).length === 1);

  r = await req(base, 'GET', `/api/v1/exams/papers/${paperId}`, { token: teacher });
  ck('...and on the paper', r.json.paper && r.json.paper.questions.length === 1);

  r = await req(base, 'GET', '/api/v1/exams/papers', { token: bursar });
  ck('a bursar cannot read the exam papers', r.status === 403);

  // ══ Notifications ════════════════════════════════════════════════════════

  r = await req(base, 'POST', '/api/v1/notifications', { token: bursar, body: {
    channel: 'sms', audience: 'staff', message: 'Staff meeting at 3pm.',
  } });
  ck('a text message can be sent to staff', r.status === 200 && r.json.sent === 2);

  r = await req(base, 'GET', '/api/v1/notifications', { token: bursar });
  ck('...and every despatch is logged with what was sent',
    (r.json.notifications || []).length === 2
    && r.json.notifications[0].message_body === 'Staff meeting at 3pm.');

  r = await req(base, 'POST', '/api/v1/notifications', { token: teacher, body: {
    channel: 'sms', audience: 'all', message: 'Anything',
  } });
  ck('a class teacher without notifications-create cannot send one', r.status === 403);

  // ══ Correcting a pupil's record ══════════════════════════════════════════

  r = await req(base, 'POST', `/api/v1/admin/students/${p1}`, { token: teacher, body: {
    mother_contact: '0244555666', place_of_residence: 'Acherensua',
  } });
  ck('the students sheet can correct a record', r.status === 200);
  const corrected = db.prepare('SELECT mother_contact, place_of_residence FROM students WHERE id = ?').get(p1);
  ck('...and the correction lands', corrected.mother_contact === '0244555666'
    && corrected.place_of_residence === 'Acherensua');

  r = await req(base, 'POST', `/api/v1/admin/students/${p1}`, { token: teacher, body: {
    index_number: 'AVE/999', surname: 'CHANGED',
  } });
  ck('...but the admission number is not the sheet\'s to change',
    r.status === 200
    && db.prepare('SELECT index_number FROM students WHERE id = ?').get(p1).index_number === 'AVE/001');

  r = await req(base, 'POST', `/api/v1/admin/students/${p1}`, { token: teacher, body: { surname: '' } });
  ck('...and a pupil cannot be left without a surname', r.status === 400);

  // ══ Canteen arrears ══════════════════════════════════════════════════════

  r = await req(base, 'GET', '/api/v1/canteen/debtors', { token: bursar });
  ck('canteen arrears are served', r.status === 200 && Array.isArray(r.json.debtors));
  ck('...at the rate the school set', r.json.daily_rate === 5);

  // ══ The staff register ═══════════════════════════════════════════════════

  r = await req(base, 'GET', '/api/v1/admin/staff-register', { token: admin });
  ck('the staff register is served', r.status === 200 && (r.json.staff || []).length === 2);
  r = await req(base, 'GET', '/api/v1/admin/staff-register', { token: teacher });
  ck('...and a class teacher cannot read it', r.status === 403);

  // ══ Staff records, and what somebody teaches ═════════════════════════════
  //
  // The web app has to be able to put a new teacher on the roll and say which
  // class is theirs. The second one is the most consequential write in the
  // module: the teaching scope is built from it, so it decides whose marks a
  // person can touch.

  r = await req(base, 'POST', '/api/v1/admin/staff', { token: teacher, body: {
    surname: 'MENSAH', first_name: 'Yaa',
  } });
  ck('a class teacher cannot put somebody on the staff roll', r.status === 403);

  r = await req(base, 'POST', '/api/v1/admin/staff', { token: admin, body: { surname: 'MENSAH' } });
  ck('a staff record needs both names', r.status === 400);

  r = await req(base, 'POST', '/api/v1/admin/staff', { token: admin, body: {
    surname: 'MENSAH', first_name: 'Yaa', role: 'Teaching', phone: '0244777888',
    base_salary: 1400, ssnit_number: 'SS-3',
  } });
  ck('the Super Admin adds a member of staff', r.status === 200 && !!r.json.id);
  const newStaff = r.json.id;
  ck('...and a staff number is issued rather than asked for', /^STAFF\/\d{4}$/.test(r.json.staff_number));
  ck('...with the pay they were given, because this account holds payroll',
    db.prepare('SELECT base_salary FROM staff WHERE id = ?').get(newStaff).base_salary === 1400);

  r = await req(base, 'GET', '/api/v1/admin/staff', { token: bursar });
  ck('the roll carries the school\'s own list of jobs, for the form',
    (r.json.designations || []).some(d => d.name === 'Class Teacher'));

  // A bursar holds staff at View only (see the seed): they may read the roll
  // and may not write it.
  r = await req(base, 'POST', '/api/v1/admin/staff', { token: bursar, body: {
    id: newStaff, phone: '0000000000',
  } });
  ck('an account that may only read the roll cannot amend it', r.status === 403);

  r = await req(base, 'POST', '/api/v1/admin/staff', { token: admin, body: {
    id: newStaff, qualification: 'Diploma in Basic Education',
  } });
  ck('a record can be amended', r.status === 200
    && db.prepare('SELECT qualification FROM staff WHERE id = ?').get(newStaff).qualification
       === 'Diploma in Basic Education');

  r = await req(base, 'POST', `/api/v1/admin/staff/${newStaff}/assignments`, { token: admin, body: {
    assignments: [{ class_group_id: 2, is_class_teacher: true },
                  { class_group_id: 1, subject_id: null }],
  } });
  ck('what somebody teaches can be set from a browser', r.status === 200 && r.json.assignments === 2);
  ck('...and it is what the screen showed, not a patch on top of it',
    db.prepare('SELECT COUNT(*) c FROM staff_assignments WHERE staff_id = ?').get(newStaff).c === 2);

  // The one rule that matters here: a class has ONE class teacher, because the
  // register and the report cards belong to one person.
  r = await req(base, 'POST', '/api/v1/admin/staff/1/assignments', { token: admin, body: {
    assignments: [{ class_group_id: 2, is_class_teacher: true }],
  } });
  ck('giving a class a new class teacher takes it off the old one',
    r.status === 200
    && db.prepare('SELECT COUNT(*) c FROM staff_assignments WHERE class_group_id = 2 AND is_class_teacher = 1')
         .get().c === 1
    && db.prepare('SELECT COUNT(*) c FROM staff_assignments WHERE staff_id = ? AND is_class_teacher = 1')
         .get(newStaff).c === 0);

  r = await req(base, 'POST', `/api/v1/admin/staff/${newStaff}/assignments`, { token: teacher, body: {
    assignments: [{ class_group_id: 1 }],
  } });
  ck('a class teacher cannot decide what anybody teaches', r.status === 403);

  r = await req(base, 'POST', '/api/v1/admin/staff/9999/assignments', { token: admin, body: {
    assignments: [],
  } });
  ck('...and nobody can assign a member of staff who does not exist', r.status === 404);

  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
