// Nickland Edusoft — raising the term's school fees.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
//   node test/school_fees.js       (requires Node >= 22.5)
//
// The rules under test are the ones a school loses money on if they are wrong:
// a term has one school fees bill, replacing it never discards a payment, and
// a schedule written against the wrong academic year says so in words an
// office can act on.

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`These tests need Node >= 22.5 (running ${process.versions.node}).`);
  process.exit(1);
}

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { SCHEMA, runMigrations } = require(path.join(ROOT, 'electron/db/database.js'));
const billing = require(path.join(ROOT, 'electron/ipc/_billing.js'));
const frameworks = require(path.join(ROOT, 'electron/ipc/_frameworks.js'));
const schoolFees = require(path.join(ROOT, 'electron/ipc/fees_schoolfees.js'));
const fees = require(path.join(ROOT, 'electron/ipc/fees.js'));

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

// A school running Third Term 2025/2026, with next year's terms already laid
// out — which is exactly the state the reported defect happened in.
function seed(db) {
  db.exec(`
    INSERT INTO academic_years (id,label,is_current) VALUES (1,'2025/2026',1),(2,'2026/2027',0);
    INSERT INTO terms (id,academic_year_id,term_number,label,start_date,end_date,is_current) VALUES
      (1,1,1,'First Term','2025-09-01','2025-12-20',0),
      (2,1,2,'Second Term','2026-01-10','2026-04-10',0),
      (3,1,3,'Third Term','2026-04-23','2026-07-23',1),
      (4,2,1,'First Term','2026-09-01','2026-12-20',0);
    INSERT INTO class_groups (id,name,short_code,level_category,level_order) VALUES
      (1,'Basic 4','BS4','basic',9),
      (2,'Basic 5','BS5','basic',10),
      (3,'Basic 6','BS6','basic',11);
    INSERT INTO students (id,surname,first_name,index_number,current_class_id,status) VALUES
      (1,'ANSU','MONALISA','AVE/17/00001',2,'Active'),
      (2,'APRAKU','JEFFEREY','AVE/17/00002',2,'Active'),
      (3,'BAFFOUR','CLEMENT','AVE/17/00003',1,'Active'),
      (4,'GONE','Away','AVE/17/00099',2,'Inactive');
  `);
}

// ── The reported defect ─────────────────────────────────────────────────────
{
  const db = makeDb();
  seed(db);
  // The office writes "First Term Bills 2026/2027" — against 2026/2027's First
  // Term — while the school is running Third Term 2025/2026.
  db.exec(`
    INSERT INTO fee_templates (id,name,class_group_id,term_id,bill_type,is_active)
      VALUES (1,'First Term Bills 2026/2027 ACADEMIC YEAR',NULL,4,'school_fees',1);
    INSERT INTO fee_line_items (fee_template_id,item_number,description,amount) VALUES
      (1,1,'Tuition Fee',200),(1,2,'Sanitation Fees',20),(1,3,'PTA',10),(1,4,'Security',25);
  `);

  let err = null;
  try { fees.generateBillForStudent(db, 1, 3); } catch (e) { err = e.message; }

  ck('a schedule written against another year does not bill the running term', !!err);
  ck('...and the message names the class and the running term in full',
    /Basic 5/.test(err) && /Third Term · 2025\/2026/.test(err));
  ck('...and reads back the schedule that does exist, with ITS year',
    /First Term Bills 2026\/2027/.test(err) && /First Term · 2026\/2027/.test(err));
  ck('...and says to check the term each one is written against',
    /every academic year has a term by the same name/i.test(err));

  // Naming the right term is the whole fix.
  db.exec('UPDATE fee_templates SET term_id = 3 WHERE id = 1');
  const raised = fees.generateBillForStudent(db, 1, 3);
  const bill = db.prepare('SELECT * FROM student_bills WHERE student_id = 1 AND term_id = 3').get();
  ck('naming the running term raises the bill', raised.ok && bill.total_billed === 255);
}

// ── Frameworks ──────────────────────────────────────────────────────────────
{
  const ave = frameworks.getFramework('ave-maria-termly');
  ck('the school\'s own bill is offered as a framework', !!ave);
  ck('...with Part A totalling what the printed bill totals', ave.fees_total === 400);
  ck('...and Part B carrying the textbooks separately', ave.books_total === 440);

  const { feeItems, bookItems } = frameworks.toTemplateItems(ave);
  ck('only Part A becomes school-fees lines', feeItems.length === 12
    && feeItems.every(i => !/textbook/i.test(i.description)));
  ck('...and the textbooks are handed back for the books charge',
    bookItems.length === 1 && bookItems[0].amount === 440);
  ck('the line numbers run 1..n so the bill prints in order',
    feeItems.map(i => i.item_number).join(',') === '1,2,3,4,5,6,7,8,9,10,11,12');

  ck('an extras framework is not offered as a school-fees one',
    !frameworks.listFrameworks('school_fees').some(f => f.id === 'in-term-extras'));
}

// ── Raising for the whole school ────────────────────────────────────────────
{
  const db = makeDb();
  seed(db);
  const r = schoolFees.raiseSchoolFees(db, fees, {
    termId: 3, scope: 'school', source: 'framework', frameworkId: 'ave-maria-termly',
    name: 'Third Term 2025/2026',
  });
  ck('a framework raises the whole school in one action', r.ok && r.generated === 3);
  ck('...as ONE standing schedule, not one per class', r.templates.length === 1
    && r.templates[0].class_group_id === null);
  ck('...at the framework\'s Part A total a pupil', r.per_pupil === 400);
  ck('...and the inactive pupil is not billed',
    db.prepare('SELECT COUNT(*) AS n FROM student_bills WHERE student_id = 4').get().n === 0);
  ck('...and the textbooks come back for the books charge', r.book_items.length === 1);
}

// ── Raising for selected classes ────────────────────────────────────────────
{
  const db = makeDb();
  seed(db);
  const r = schoolFees.raiseSchoolFees(db, fees, {
    termId: 3, scope: 'classes', classIds: [1, 2],
    items: [{ description: 'Tuition Fee', amount: 300 }, { description: 'PTA Dues', amount: 20 }],
  });
  ck('selected classes bill only those classes', r.ok && r.generated === 3);
  ck('...each getting its own schedule so they can diverge later', r.templates.length === 2);
  ck('...and Basic 6, which was not chosen, has no schedule',
    !billing.resolveFeeTemplate(db, 3, 3));
  ck('...while Basic 5 does', !!billing.resolveFeeTemplate(db, 2, 3));

  // Naming every class is the same instruction as "the whole school".
  const db2 = makeDb(); seed(db2);
  const all = schoolFees.raiseSchoolFees(db2, fees, {
    termId: 3, classIds: [1, 2, 3],
    items: [{ description: 'Tuition Fee', amount: 300 }],
  });
  ck('naming every class raises one standing schedule, not fifteen',
    all.ok && all.templates.length === 1 && all.templates[0].class_group_id === null);
}

// ── One school fees bill per term ───────────────────────────────────────────
{
  const db = makeDb();
  seed(db);
  schoolFees.raiseSchoolFees(db, fees, {
    termId: 3, scope: 'school', items: [{ description: 'Tuition Fee', amount: 800 }],
  });

  // A parent pays 300 of the 800.
  db.exec(`INSERT INTO payments (student_id, term_id, amount, payment_date, receipt_number)
           VALUES (1, 3, 300, '2026-05-01', 'RCT-1')`);
  billing.recomputeBillTotals(db,
    db.prepare('SELECT id FROM student_bills WHERE student_id = 1 AND term_id = 3').get().id);

  const blocked = schoolFees.raiseSchoolFees(db, fees, {
    termId: 3, scope: 'school', items: [{ description: 'Tuition Fee', amount: 500 }],
  });
  ck('a second school fees bill is refused, not silently created',
    !blocked.ok && blocked.code === 'REPLACE_REQUIRED');
  ck('...and names what it would replace', (blocked.existing || []).length === 1);

  const replaced = schoolFees.raiseSchoolFees(db, fees, {
    termId: 3, scope: 'school', confirmReplace: true,
    items: [{ description: 'Tuition Fee', amount: 500 }],
  });
  ck('confirming replaces the old bill', replaced.ok && replaced.replaced === 1);

  const bill = db.prepare(
    'SELECT * FROM student_bills WHERE student_id = 1 AND term_id = 3').get();
  ck('...the pupil is billed the NEW amount', bill.total_billed === 500);
  ck('...the money already received is still theirs', bill.total_paid === 300);
  ck('...so the balance is the difference, not the whole new bill', bill.balance === 200);
  ck('...and the old schedule is retired, not deleted',
    db.prepare("SELECT COUNT(*) AS n FROM fee_templates WHERE is_active = 0").get().n === 1);
  ck('...leaving exactly one live schedule for the term',
    db.prepare(`SELECT COUNT(*) AS n FROM fee_templates
                WHERE is_active = 1 AND term_id = 3`).get().n === 1);
}

// ── A replacement that lowers the bill below what was paid ──────────────────
{
  const db = makeDb();
  seed(db);
  schoolFees.raiseSchoolFees(db, fees, {
    termId: 3, scope: 'school', items: [{ description: 'Tuition Fee', amount: 800 }],
  });
  db.exec(`INSERT INTO payments (student_id, term_id, amount, payment_date, receipt_number)
           VALUES (1, 3, 800, '2026-05-01', 'RCT-2')`);
  schoolFees.raiseSchoolFees(db, fees, {
    termId: 3, scope: 'school', confirmReplace: true,
    items: [{ description: 'Tuition Fee', amount: 500 }],
  });
  const bill = db.prepare('SELECT * FROM student_bills WHERE student_id = 1').get();
  ck('a parent who overpaid after a correction is in credit, not in arrears',
    bill.balance === -300 && bill.total_paid === 800);
}

// ── Copying a previous term forward ─────────────────────────────────────────
{
  const db = makeDb();
  seed(db);
  db.exec(`
    INSERT INTO fee_templates (id,name,class_group_id,term_id,bill_type,is_active)
      VALUES (9,'Second Term',NULL,2,'school_fees',1);
    INSERT INTO fee_line_items (fee_template_id,item_number,description,amount) VALUES
      (9,1,'Tuition Fee',200),(9,2,'PTA Dues',20);
  `);
  const r = schoolFees.raiseSchoolFees(db, fees, {
    termId: 3, scope: 'school', source: 'previous', sourceTemplateId: 9,
    adjustPercent: 10, confirmReplace: true,
  });
  ck('last term\'s bill can be carried forward', r.ok && r.per_pupil === 242);
  const lines = db.prepare(
    'SELECT * FROM fee_line_items WHERE fee_template_id = ? ORDER BY item_number'
  ).all(r.templates[0].id);
  ck('...with every amount uplifted by the stated percentage',
    lines[0].amount === 220 && lines[1].amount === 22);
  ck('...and the descriptions carried over', lines[1].description === 'PTA Dues');
}

// ── Extra charges survive a replacement ─────────────────────────────────────
{
  const db = makeDb();
  seed(db);
  schoolFees.raiseSchoolFees(db, fees, {
    termId: 3, scope: 'school', items: [{ description: 'Tuition Fee', amount: 400 }],
  });
  const billId = db.prepare(
    'SELECT id FROM student_bills WHERE student_id = 1 AND term_id = 3').get().id;
  db.prepare(`INSERT INTO bill_line_items (student_bill_id, item_number, description, amount, charge_type)
              VALUES (?, 90, 'Excursion — Kakum', 60, 'extra')`).run(billId);
  billing.recomputeBillTotals(db, billId);

  schoolFees.raiseSchoolFees(db, fees, {
    termId: 3, scope: 'school', confirmReplace: true,
    items: [{ description: 'Tuition Fee', amount: 500 }],
  });
  const bill = db.prepare('SELECT * FROM student_bills WHERE id = ?').get(billId);
  ck('an excursion already charged is not wiped by re-raising the term bill',
    bill.total_billed === 560 && bill.supplementary_total === 60);
}

// ── The plan a school is shown before committing ────────────────────────────
{
  const db = makeDb();
  seed(db);
  schoolFees.raiseSchoolFees(db, fees, {
    termId: 3, scope: 'school', items: [{ description: 'Tuition Fee', amount: 400 }],
  });
  db.exec(`INSERT INTO payments (student_id, term_id, amount, payment_date, receipt_number)
           VALUES (1, 3, 150, '2026-05-01', 'RCT-3')`);
  billing.recomputeBillTotals(db,
    db.prepare('SELECT id FROM student_bills WHERE student_id = 1').get().id);

  const plan = schoolFees.billsSummary(db, 3);
  ck('the bills home names the term with its year', plan.term.full_label === 'Third Term · 2025/2026');
  const fee = plan.kinds.find(k => k.key === 'school_fees');
  ck('...and shows school fees billed, collected and outstanding',
    fee.billed === 1200 && fee.paid === 150 && fee.outstanding === 1050);
  ck('...counting only the pupils who actually owe', fee.debtors === 3);
  ck('...with every kind of bill a school raises listed',
    plan.kinds.map(k => k.key).join(',') === 'school_fees,books,canteen,transport,extras');
  ck('the debtors list is merged into the home', plan.debtors.length === 3
    && plan.debtor_total === 1050);
  ck('...and the biggest debtor is first', plan.debtors[0].balance >= plan.debtors[1].balance);
  ck('collection is broken down by class', plan.by_class.length === 3
    && plan.by_class.find(c => c.short_code === 'BS5').bills === 2);
}

// ── An empty bill is refused ────────────────────────────────────────────────
{
  const db = makeDb();
  seed(db);
  const r = schoolFees.raiseSchoolFees(db, fees, { termId: 3, scope: 'school', items: [] });
  ck('a bill with no lines is refused before anything is written',
    !r.ok && /at least one line/i.test(r.error));
  ck('...and no schedule was created',
    db.prepare('SELECT COUNT(*) AS n FROM fee_templates').get().n === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
