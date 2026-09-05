// Nickland Edusoft — the payment desk.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
//   node test/payment_desk.js       (requires Node >= 22.5)
//
// One counter takes money for everything a school charges for. What is under
// test is that it goes to the RIGHT place: a canteen payment taken here marks
// the canteen days, a books payment moves the books balance, and every one of
// them reaches the finance ledger with the method and reference the parent
// will quote back.

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`These tests need Node >= 22.5 (running ${process.versions.node}).`);
  process.exit(1);
}

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { SCHEMA, runMigrations } = require(path.join(ROOT, 'electron/db/database.js'));
const { setSetting } = require(path.join(ROOT, 'electron/utils/idgen.js'));
const desk = require(path.join(ROOT, 'electron/ipc/payments_desk.js'));
const schoolFees = require(path.join(ROOT, 'electron/ipc/fees_schoolfees.js'));

const mods = {
  fees: require(path.join(ROOT, 'electron/ipc/fees.js')),
  books: require(path.join(ROOT, 'electron/ipc/books.js')),
  canteen: require(path.join(ROOT, 'electron/ipc/canteen.js')),
  transport: require(path.join(ROOT, 'electron/ipc/transport.js')),
};
// The canteen and transport modules export their recorders under their own
// names; the desk expects `recordPayment` on each.
mods.canteen = { recordPayment: mods.canteen.recordCanteenPayment };

let pass = 0, fail = 0;
const ck = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? '✓' : '✗') + ' ' + name); };

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.transaction = (fn) => (...a) => {
    db.exec('BEGIN');
    try { const r = fn(...a); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  db.exec(SCHEMA);
  runMigrations(db);
  return db;
}

function seed(db) {
  db.exec(`
    INSERT INTO academic_years (id,label,is_current) VALUES (1,'2025/2026',1);
    INSERT INTO terms (id,academic_year_id,term_number,label,start_date,end_date,is_current)
      VALUES (1,1,1,'First Term','2026-01-01','2026-04-30',1);
    INSERT INTO class_groups (id,name,short_code,level_category,level_order)
      VALUES (1,'Basic 5','BS5','basic',10),(2,'Basic 6','BS6','basic',11);
    INSERT INTO students (id,surname,first_name,index_number,current_class_id,status,guardian_contact)
      VALUES (1,'ANSU','MONALISA','AVE/17/00001',1,'Active','0244000000'),
             (2,'BAFFOUR','CLEMENT','AVE/17/00002',2,'Active',NULL),
             (3,'GONE','Away','AVE/17/00099',1,'Inactive',NULL);
    INSERT INTO users (id,username,password_hash,full_name)
      VALUES (7,'bursar','x','Nicholas Kwame Afriyie Gyamfi');
  `);
  schoolFees.raiseSchoolFees(db, mods.fees, {
    termId: 1, scope: 'school', items: [{ description: 'Tuition Fee', amount: 400 }],
  });
}

// ── What the school can be paid for ─────────────────────────────────────────
{
  const db = makeDb();
  seed(db);
  const plain = desk.enabledPurposes(db).map(p => p.key);
  ck('school fees and books are always payable', plain.includes('school_fees') && plain.includes('books'));
  ck('a school with no canteen is not offered one', !plain.includes('canteen'));
  ck('nor a bus it does not run', !plain.includes('transport'));

  setSetting(db, 'feature_canteen_enabled', 'true', 'features');
  setSetting(db, 'feature_transport_enabled', 'true', 'features');
  const on = desk.enabledPurposes(db).map(p => p.key);
  ck('switching the canteen on makes it payable', on.includes('canteen'));
  ck('...and the bus too', on.includes('transport'));
  ck('the purpose is named formally, not as a "type"',
    desk.enabledPurposes(db).find(p => p.key === 'school_fees').label === 'School Fees');
}

// ── Finding the pupil at the counter ────────────────────────────────────────
{
  const db = makeDb();
  seed(db);
  const all = desk.findStudents(db, {});
  ck('the counter lists active pupils', all.students.length === 2);
  ck('...and not one who has left', !all.students.some(s => s.surname === 'GONE'));

  ck('a class narrows it', desk.findStudents(db, { classId: 1 }).students.length === 1);
  ck('a name narrows it', desk.findStudents(db, { q: 'ansu' }).students.length === 1);
  ck('an admission number narrows it',
    desk.findStudents(db, { q: 'AVE/17/00002' }).students.length === 1);
  ck('"still owing" narrows it', desk.findStudents(db, { owing: 'owing' }).students.length === 2);
  ck('the list carries what each one owes so nobody has to open a record',
    all.students[0].fees_balance === 400);

  // A pupil who has settled drops out of the owing list, which is the whole
  // point of having it on collection day.
  desk.takePayment(db, mods, { studentId: 1, purpose: 'school_fees', amount: 400, method: 'Cash' });
  ck('...and a settled pupil drops out of it',
    desk.findStudents(db, { owing: 'owing' }).students.length === 1);
  ck('...while "settled" finds them', desk.findStudents(db, { owing: 'settled' }).students.length === 1);
}

// ── What one pupil owes, across everything ──────────────────────────────────
{
  const db = makeDb();
  seed(db);
  setSetting(db, 'feature_canteen_enabled', 'true', 'features');
  setSetting(db, 'canteen_daily_rate', '5', 'canteen');
  db.exec(`INSERT INTO school_calendar (date, day_type, term_id) VALUES
    ('2026-01-05','school_day',1),('2026-01-06','school_day',1),('2026-01-07','school_day',1)`);
  db.exec(`INSERT INTO student_books (id,student_id,academic_year_id,total_amount,total_paid,balance)
           VALUES (1,1,1,440,0,440)`);

  const acct = desk.studentAccount(db, 1);
  ck('one pupil, every purpose, one answer', acct.ok);
  const byKey = Object.fromEntries(acct.accounts.map(a => [a.purpose, a]));
  ck('school fees show what is owed', byKey.school_fees.balance === 400);
  ck('books show separately, for the academic year', byKey.books.balance === 440);
  ck('the canteen is worked out from the calendar and the daily rate',
    byKey.canteen.billed === 15 && byKey.canteen.balance === 15);
  ck('the term is named with its academic year', acct.term.full_label === 'First Term · 2025/2026');
  ck('the total is what the family owes the school', acct.total_balance === 855);
  ck('the pupil\'s contact comes with them, for the receipt',
    acct.student.contact === '0244000000');
}

// ── Taking the money ────────────────────────────────────────────────────────
{
  const db = makeDb();
  seed(db);

  const r = desk.takePayment(db, mods, {
    studentId: 1, purpose: 'school_fees', amount: 150,
    method: 'Mobile Money', reference: 'MM-88213', receivedBy: 7,
  });
  ck('a fees payment is taken', r.ok && /^FE\//.test(r.receipt_number));
  ck('...against the pupil\'s term bill', db.prepare(
    'SELECT balance FROM student_bills WHERE student_id = 1').get().balance === 250);
  ck('...and reaches the finance ledger',
    db.prepare("SELECT COUNT(*) n FROM income_records WHERE category='fees'").get().n === 1);
  ck('...with the transaction reference on it',
    db.prepare('SELECT reference FROM payments WHERE id = ?').get(r.payment_id).reference === 'MM-88213');

  ck('the receipt comes back with the payment, ready for the screen', !!r.receipt);
  ck('...saying what was paid for', r.receipt.purpose_label === 'School Fees');
  ck('...how it was paid', r.receipt.payment_method === 'Mobile Money');
  ck('...its reference', r.receipt.reference === 'MM-88213');
  ck('...the date and the time it was taken',
    /^\d{4}-\d{2}-\d{2}$/.test(r.receipt.date) && /^\d{2}:\d{2}$/.test(r.receipt.time));
  ck('...who took it, from the login rather than a typed-in name',
    r.receipt.received_by === 'Nicholas Kwame Afriyie Gyamfi');
  ck('...the amount in words, as a receipt has to carry',
    /One Hundred and Fifty Ghana Cedis Only/.test(r.receipt.amount_in_words));
  ck('...the school it was paid to', !!r.receipt.school && typeof r.receipt.school.name === 'string');
  ck('...and the paper it prints on, which is an 80mm roll by default',
    r.receipt.paper_size === 'roll80');
}

// ── A traceable method needs its reference ──────────────────────────────────
{
  const db = makeDb();
  seed(db);
  const bad = desk.takePayment(db, mods, {
    studentId: 1, purpose: 'school_fees', amount: 100, method: 'Mobile Money',
  });
  ck('mobile money with no reference is refused', !bad.ok && bad.code === 'REFERENCE_REQUIRED');
  ck('...and nothing was recorded',
    db.prepare('SELECT COUNT(*) n FROM payments').get().n === 0);

  const cash = desk.takePayment(db, mods, {
    studentId: 1, purpose: 'school_fees', amount: 100, method: 'Cash',
  });
  ck('cash needs no reference, because there is nothing to reference', cash.ok);
}

// ── A canteen payment taken at the fees counter ─────────────────────────────
{
  const db = makeDb();
  seed(db);
  setSetting(db, 'feature_canteen_enabled', 'true', 'features');
  setSetting(db, 'canteen_daily_rate', '5', 'canteen');
  db.exec(`INSERT INTO school_calendar (date, day_type, term_id) VALUES
    ('2026-01-05','school_day',1),('2026-01-06','school_day',1),
    ('2026-01-07','school_day',1),('2026-01-08','school_day',1)`);

  const r = desk.takePayment(db, mods, {
    studentId: 1, purpose: 'canteen', amount: 15, method: 'Cash',
    paymentDate: '2026-01-05', receivedBy: 7,
  });
  ck('a canteen payment can be taken at the fees counter', r.ok);
  ck('...and marks the days on the canteen calendar, as the canteen module does',
    db.prepare("SELECT COUNT(*) n FROM canteen_day_status WHERE student_id=1 AND status='paid'").get().n === 3);
  ck('...reaching the ledger as canteen income, not as fees',
    db.prepare("SELECT COUNT(*) n FROM income_records WHERE category='canteen'").get().n === 1);
  ck('...with a receipt number of its own, which the canteen never used to print',
    /^CT\//.test(r.receipt_number));
  ck('...and the receipt says it was for the canteen', r.receipt.purpose_label === 'Canteen');
  ck('...showing the days it covers', r.receipt.lines.some(([k]) => k === 'Days Covered'));

  const acct = desk.studentAccount(db, 1);
  const canteen = acct.accounts.find(a => a.purpose === 'canteen');
  ck('...and the pupil\'s canteen balance moves', canteen.paid === 15 && canteen.balance === 5);
}

// ── A books payment ─────────────────────────────────────────────────────────
{
  const db = makeDb();
  seed(db);
  db.exec(`INSERT INTO student_books (id,student_id,academic_year_id,total_amount,total_paid,balance)
           VALUES (1,1,1,440,0,440)`);
  const r = desk.takePayment(db, mods, {
    studentId: 1, purpose: 'books', amount: 200, method: 'Bank Transfer',
    reference: 'GCB-4471', receivedBy: 7,
  });
  ck('a books payment is taken', r.ok && /^BK\//.test(r.receipt_number));
  ck('...and moves the books balance, not the fees balance',
    db.prepare('SELECT balance FROM student_books WHERE id=1').get().balance === 240
    && db.prepare('SELECT balance FROM student_bills WHERE student_id=1').get().balance === 400);
  ck('...reaching the ledger as books income',
    db.prepare("SELECT COUNT(*) n FROM income_records WHERE category='books'").get().n === 1);
  ck('...with the bank reference on the receipt', r.receipt.reference === 'GCB-4471');
}

// ── An extra charge, paid for by name ───────────────────────────────────────
{
  const db = makeDb();
  seed(db);
  const r = desk.takePayment(db, mods, {
    studentId: 1, purpose: 'extra_charges', amount: 60, method: 'Cash', receivedBy: 7,
  });
  ck('an extra charge is paid against the term bill it sits on',
    r.ok && db.prepare('SELECT balance FROM student_bills WHERE student_id=1').get().balance === 340);
  ck('...but the receipt says what the parent handed the money over for',
    r.receipt.purpose_label === 'Extra Charges');
  ck('...and so does the ledger', /Extra charges/.test(
    db.prepare("SELECT description FROM income_records ORDER BY id DESC LIMIT 1").get().description));
}

// ── The day's takings ───────────────────────────────────────────────────────
{
  const db = makeDb();
  seed(db);
  db.exec(`INSERT INTO student_books (id,student_id,academic_year_id,total_amount,total_paid,balance)
           VALUES (1,2,1,440,0,440)`);
  desk.takePayment(db, mods, { studentId: 1, purpose: 'school_fees', amount: 100, method: 'Cash', paymentDate: '2026-02-01' });
  desk.takePayment(db, mods, { studentId: 2, purpose: 'books', amount: 50, method: 'Cash', paymentDate: '2026-02-01' });
  desk.takePayment(db, mods, { studentId: 1, purpose: 'school_fees', amount: 70, method: 'Cash', paymentDate: '2026-03-01' });

  const all = desk.paymentRegister(db, {});
  ck('the register shows every purpose in one list', all.count === 3 && all.total === 220);
  ck('...newest first', all.payments[0].payment_date === '2026-03-01');

  const feb = desk.paymentRegister(db, { from: '2026-02-01', to: '2026-02-28' });
  ck('a date range narrows it', feb.count === 2 && feb.total === 150);
  const booksOnly = desk.paymentRegister(db, { purposes: ['books'] });
  ck('a purpose narrows it', booksOnly.count === 1 && booksOnly.total === 50);
  const bs6 = desk.paymentRegister(db, { classId: 2 });
  ck('a class narrows it', bs6.count === 1);
  ck('a name narrows it', desk.paymentRegister(db, { q: 'ansu' }).count === 2);
}

// ── What cannot be taken ────────────────────────────────────────────────────
{
  const db = makeDb();
  seed(db);
  ck('a payment with no purpose is refused',
    !desk.takePayment(db, mods, { studentId: 1, amount: 50 }).ok);
  ck('a payment of nothing is refused',
    !desk.takePayment(db, mods, { studentId: 1, purpose: 'school_fees', amount: 0 }).ok);
  ck('a negative payment is refused',
    !desk.takePayment(db, mods, { studentId: 1, purpose: 'school_fees', amount: -50 }).ok);
  ck('a payment with no pupil is refused',
    !desk.takePayment(db, mods, { purpose: 'school_fees', amount: 50 }).ok);
  ck('...and none of that left a row behind',
    db.prepare('SELECT COUNT(*) n FROM payments').get().n === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
