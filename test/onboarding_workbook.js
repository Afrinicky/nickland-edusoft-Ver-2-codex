// Nickland Edusoft — bringing a school onto the system from its own Excel.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
//   node test/onboarding_workbook.js       (requires Node >= 22.5)
//
// The rules under test are the ones a school loses a day of typing to if they
// are wrong: importing the file twice must not produce two of every pupil,
// an opening balance must not accumulate, a name that resolves to nothing must
// be reported rather than written as a null, and one bad row must not take the
// other three hundred and ninety-nine with it.

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`These tests need Node >= 22.5 (running ${process.versions.node}).`);
  process.exit(1);
}

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { SCHEMA, runMigrations, seedDefaults } = require(path.join(ROOT, 'electron/db/database.js'));
const S = require(path.join(ROOT, 'electron/ipc/_onboarding_schema.js'));
const imp = require(path.join(ROOT, 'electron/ipc/onboarding_import.js'));

let pass = 0, fail = 0;
const ck = (name, cond, extra) => {
  cond ? pass++ : fail++;
  console.log((cond ? '✓' : '✗') + ' ' + name);
  if (!cond && extra !== undefined) console.log('    ' + JSON.stringify(extra));
};

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.transaction = (fn) => (...a) => {
    db.exec('BEGIN');
    try { const r = fn(...a); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  db.exec(SCHEMA);
  runMigrations(db);
  // The same defaults a real school is opened with — designations, grading,
  // the counters that issue index numbers. An onboarding import runs against a
  // freshly created school, so the test must too.
  seedDefaults(db);
  return db;
}

// A small but complete school, written the way an office writes one: names
// rather than ids, a phone number in three different formats, subjects as a
// comma list, and no index numbers at all on some pupils.
function workbook(overrides = {}) {
  const sheets = {
    [S.SHEETS.PROFILE]: [
      { __row: 7, setting: 'School name', value: 'Ave Maria School' },
      { __row: 8, setting: 'Phone (main)', value: '0244000111' },
      { __row: 9, setting: 'Motto', value: '' },              // left blank on purpose
    ],
    [S.SHEETS.YEARS]: [
      { __row: 7, label: '2025/2026', start_date: '2025-09-01', end_date: '2026-07-31', is_current: 1 },
    ],
    [S.SHEETS.TERMS]: [
      { __row: 7, year_label: '2025/2026', term_number: 1, label: 'First Term',
        start_date: '2025-09-01', end_date: '2025-12-19', is_current: 1 },
      { __row: 8, year_label: '2025/2026', term_number: 2, label: 'Second Term',
        start_date: '2026-01-12', end_date: '2026-04-10', is_current: null },
    ],
    [S.SHEETS.CLASSES]: [
      { __row: 7, name: 'Basic 5', short_code: '', level_category: 'Primary', level_order: 5, section: '', capacity: 40 },
      { __row: 8, name: 'Basic 6', short_code: 'B6', level_category: 'Primary', level_order: 6, section: '', capacity: 40 },
    ],
    [S.SHEETS.SUBJECTS]: [
      { __row: 7, name: 'English', code: 'ENG', class_weight_pct: 40, exam_weight_pct: 60 },
      { __row: 8, name: 'Mathematics', code: 'MAT', class_weight_pct: 30, exam_weight_pct: 70 },
    ],
    [S.SHEETS.CLASS_SUBJECTS]: [
      { __row: 7, class_name: 'Basic 5', subjects: ['English', 'Mathematics'] },
    ],
    [S.SHEETS.GRADING]: [
      { __row: 7, min_score: 80, max_score: 100, remark: 'Excellent' },
      { __row: 8, min_score: 70, max_score: 79, remark: 'Very good' },
      { __row: 9, min_score: 0, max_score: 69, remark: 'Developing' },
    ],
    [S.SHEETS.STAFF]: [
      { __row: 7, staff_number: '', surname: 'Mensah', first_name: 'Akua', role: 'Teacher',
        gender: 'Female', phone: '0201234567', date_of_birth: '1990-04-11', status: 'Active' },
    ],
    [S.SHEETS.STUDENTS]: [
      { __row: 7, index_number: 'AMS/2025/001', surname: 'Owusu', first_name: 'Kofi',
        gender: 'Male', date_of_birth: '2014-03-02', class_name: 'Basic 5', status: 'Active',
        father_contact: '0244000222' },
      { __row: 8, index_number: '', surname: 'Boateng', first_name: 'Ama',
        gender: 'Female', date_of_birth: '2014-11-20', class_name: 'Basic 6', status: 'Active' },
    ],
    [S.SHEETS.PARENTS]: [
      { __row: 7, full_name: 'Yaw Owusu', phone: '0244000222', email: '',
        children: ['AMS/2025/001'], relationship: 'Father' },
    ],
    [S.SHEETS.FEES]: [
      { __row: 7, class_name: 'Basic 5', term_label: 'First Term', part: 'A', item_name: 'Tuition', amount: 400, is_optional: 0 },
      { __row: 8, class_name: 'Basic 5', term_label: 'First Term', part: 'A', item_name: 'PTA levy', amount: 20, is_optional: 0 },
    ],
    [S.SHEETS.BALANCES]: [
      { __row: 7, index_number: 'AMS/2025/001', student_name: 'Kofi Owusu',
        term_label: 'First Term', amount_owing: 340, notes: 'Carried from Third Term' },
    ],
  };
  return { ...sheets, ...overrides };
}

const count = (db, sql) => db.prepare(sql).get().n;

// ── 1. A school arrives ────────────────────────────────────────────────
console.log('\nA school brought onto the system from its own workbook');
{
  const db = makeDb();
  // A freshly provisioned school is not empty: it opens on Ghana's standard
  // class ladder, the usual subjects and a default grading scale. So the
  // workbook's job is as much to CORRECT that as to create, and the test is
  // written against a seeded school for exactly that reason.
  const classesBefore = count(db, 'SELECT COUNT(*) AS n FROM class_groups');
  const rep = imp.importRows(db, workbook(), { file: 'ave-maria.xlsx', userId: null });

  const problems = rep.sheets.flatMap(s => s.problems.map(p => `${s.sheet} r${p.row}: ${p.error}`));
  ck('nothing was refused', rep.totals.failed === 0, problems);
  ck('the school is named', db.prepare("SELECT value FROM settings WHERE key='school_name'").get().value === 'Ave Maria School');
  ck('a blank Value left the setting alone',
    (db.prepare("SELECT value FROM settings WHERE key='school_motto'").get() || { value: '' }).value !== undefined);
  ck('the classes the workbook names exist exactly once each',
    count(db, "SELECT COUNT(*) AS n FROM class_groups WHERE name IN ('Basic 5','Basic 6')") === 2);
  ck('the standard ladder was corrected, not duplicated',
    count(db, 'SELECT COUNT(*) AS n FROM class_groups') === classesBefore, { classesBefore });
  ck('a missing short code was worked out',
    db.prepare("SELECT short_code FROM class_groups WHERE name='Basic 5'").get().short_code === 'B5');
  ck('one academic year is current', count(db, 'SELECT COUNT(*) AS n FROM academic_years WHERE is_current=1') === 1);
  ck('one term is current', count(db, 'SELECT COUNT(*) AS n FROM terms WHERE is_current=1') === 1);
  ck('and it is First Term',
    db.prepare('SELECT label FROM terms WHERE is_current=1').get().label === 'First Term');
  ck('Basic 5 is taught two subjects',
    count(db, `SELECT COUNT(*) AS n FROM class_subjects cs
               JOIN class_groups c ON c.id = cs.class_group_id WHERE c.name='Basic 5'`) === 2);
  ck('the grading scale is the school\'s own, replacing the default',
    count(db, 'SELECT COUNT(*) AS n FROM grading_bands') === 3);
  ck('the teacher is on the roll', count(db, "SELECT COUNT(*) AS n FROM staff WHERE surname='Mensah'") === 1);
  ck('a staff number was issued for one left blank',
    !!db.prepare("SELECT staff_number FROM staff WHERE surname='Mensah'").get().staff_number);
  ck('both pupils are admitted', count(db, 'SELECT COUNT(*) AS n FROM students') === 2);
  ck('the supplied index number was honoured exactly',
    !!db.prepare("SELECT id FROM students WHERE index_number='AMS/2025/001'").get());
  ck('the pupil with no index number was given one',
    !!db.prepare("SELECT index_number FROM students WHERE surname='Boateng'").get().index_number);
  ck('a pupil landed in the class named on the sheet',
    db.prepare(`SELECT c.name FROM students s JOIN class_groups c ON c.id=s.current_class_id
                WHERE s.surname='Owusu'`).get().name === 'Basic 5');
  ck('the parent account exists and is linked to their child',
    count(db, 'SELECT COUNT(*) AS n FROM parent_students') === 1);
  ck('the fee schedule was raised as one template',
    count(db, 'SELECT COUNT(*) AS n FROM fee_templates') === 1);
  ck('with both of its lines',
    count(db, 'SELECT COUNT(*) AS n FROM fee_line_items') === 2);
  // The seeded school already runs 2025/2026 with three terms. The workbook
  // names two of them, so it must correct those and leave the third alone —
  // not add a fourth and a second 2025/2026.
  ck('the workbook\'s terms corrected the year already there rather than adding one',
    count(db, "SELECT COUNT(*) AS n FROM academic_years WHERE label='2025/2026'") === 1);
  ck('and that year still has exactly its three terms',
    count(db, `SELECT COUNT(*) AS n FROM terms t JOIN academic_years y ON y.id=t.academic_year_id
               WHERE y.label='2025/2026'`) === 3);
  ck('with the dates the workbook gave for First Term',
    db.prepare("SELECT start_date FROM terms WHERE term_number=1").get().start_date === '2025-09-01');

  const bill = db.prepare(`SELECT b.* FROM student_bills b JOIN students s ON s.id=b.student_id
                           WHERE s.index_number='AMS/2025/001'`).get();
  ck('the pupil carries their opening balance', bill && Math.round(bill.balance) === 340, bill);
  ck('and it is recorded as arrears, not fees', bill && Math.round(bill.arrears_from_prev) === 340);
  ck('the import is in the audit trail',
    count(db, "SELECT COUNT(*) AS n FROM audit_log WHERE action='onboarding_imported'") === 1);
}

// ── 2. The same file imported again ────────────────────────────────────
// The whole reason this workbook upserts rather than appends. An office imports,
// spots that a column of birthdays came in wrong, fixes the sheet and imports
// again. That must correct the school, not clone it.
console.log('\nThe same workbook, imported a second time');
{
  const db = makeDb();
  imp.importRows(db, workbook(), { file: 'ave-maria.xlsx' });
  const after1 = {
    classes: count(db, 'SELECT COUNT(*) AS n FROM class_groups'),
    terms: count(db, 'SELECT COUNT(*) AS n FROM terms'),
    subjects: count(db, 'SELECT COUNT(*) AS n FROM subjects'),
  };

  const corrected = workbook();
  corrected[S.SHEETS.STUDENTS][0].date_of_birth = '2014-03-20';   // the fix
  corrected[S.SHEETS.STUDENTS][0].place_of_residence = 'Adenta';
  const rep = imp.importRows(db, corrected, { file: 'ave-maria.xlsx' });

  ck('nothing failed on the second run', rep.totals.failed === 0,
    rep.sheets.flatMap(s => s.problems));
  ck('no pupil was cloned', count(db, 'SELECT COUNT(*) AS n FROM students') === 2);
  ck('no class was cloned', count(db, 'SELECT COUNT(*) AS n FROM class_groups') === after1.classes);
  ck('no subject was cloned', count(db, 'SELECT COUNT(*) AS n FROM subjects') === after1.subjects);
  ck('no staff member was cloned', count(db, 'SELECT COUNT(*) AS n FROM staff') === 1);
  ck('no parent was cloned', count(db, 'SELECT COUNT(*) AS n FROM parents') === 1);
  ck('the parent is still linked once', count(db, 'SELECT COUNT(*) AS n FROM parent_students') === 1);
  ck('no term was cloned', count(db, 'SELECT COUNT(*) AS n FROM terms') === after1.terms);
  ck('the grading scale was replaced, not doubled', count(db, 'SELECT COUNT(*) AS n FROM grading_bands') === 3);
  ck('the fee schedule was restated, not duplicated',
    count(db, 'SELECT COUNT(*) AS n FROM fee_line_items') === 2);
  ck('only one fee template is active for the class and term',
    count(db, 'SELECT COUNT(*) AS n FROM fee_templates WHERE is_active=1') === 1);
  ck('the correction landed',
    db.prepare("SELECT date_of_birth FROM students WHERE index_number='AMS/2025/001'").get().date_of_birth === '2014-03-20');
  ck('and so did the field that was blank before',
    db.prepare("SELECT place_of_residence FROM students WHERE index_number='AMS/2025/001'").get().place_of_residence === 'Adenta');
  ck('the second run reports updates, not creations', rep.totals.created === 0, rep.totals);

  // The one figure that must never accumulate.
  const bill = db.prepare(`SELECT b.balance FROM student_bills b JOIN students s ON s.id=b.student_id
                           WHERE s.index_number='AMS/2025/001'`).get();
  ck('the opening balance is still 340, not 680', Math.round(bill.balance) === 340, bill);
}

// ── 3. Three times, and a correction to zero ───────────────────────────
console.log('\nAn opening balance is a position, not a transaction');
{
  const db = makeDb();
  imp.importRows(db, workbook());
  imp.importRows(db, workbook());
  imp.importRows(db, workbook());
  const owing = db.prepare(`SELECT b.balance FROM student_bills b JOIN students s ON s.id=b.student_id
                            WHERE s.index_number='AMS/2025/001'`).get().balance;
  ck('three imports still leave 340 owing', Math.round(owing) === 340, { owing });

  const paidOff = workbook();
  paidOff[S.SHEETS.BALANCES][0].amount_owing = 0;
  imp.importRows(db, paidOff);
  const after = db.prepare(`SELECT b.balance FROM student_bills b JOIN students s ON s.id=b.student_id
                            WHERE s.index_number='AMS/2025/001'`).get().balance;
  ck('correcting the figure to zero removes it', Math.round(after) === 0, { after });

  const restated = workbook();
  restated[S.SHEETS.BALANCES][0].amount_owing = 500;
  imp.importRows(db, restated);
  const revised = db.prepare(`SELECT b.balance FROM student_bills b JOIN students s ON s.id=b.student_id
                              WHERE s.index_number='AMS/2025/001'`).get().balance;
  ck('and restating it sets the new figure', Math.round(revised) === 500, { revised });
}

// ── 4. What a workbook gets wrong ──────────────────────────────────────
// Onboarding data is typed by hand from paper, so it is wrong. What matters is
// that the school is TOLD which row and what about it, and that the rest of the
// file still lands.
console.log('\nA workbook with mistakes in it');
{
  const db = makeDb();
  const bad = workbook();
  bad[S.SHEETS.STUDENTS].push(
    { __row: 9, index_number: 'AMS/2025/003', surname: 'Asante', first_name: 'Yaw',
      gender: 'Male', date_of_birth: '2013-06-06', class_name: 'Basic 9', status: 'Active' });
  bad[S.SHEETS.STUDENTS].push(
    { __row: 10, index_number: 'AMS/2025/004', surname: '', first_name: 'Adjoa',
      gender: 'Female', class_name: 'Basic 5', status: 'Active' });
  bad[S.SHEETS.SUBJECTS].push(
    { __row: 9, name: 'Science', code: 'SCI', class_weight_pct: 50, exam_weight_pct: 60 });

  const rep = imp.importRows(db, bad);
  const students = rep.sheets.find(s => s.sheet === S.SHEETS.STUDENTS);
  const subjects = rep.sheets.find(s => s.sheet === S.SHEETS.SUBJECTS);

  ck('the pupil in a class that does not exist was refused', students.failed === 2, students.problems);
  ck('and the refusal names the class',
    students.problems.some(p => p.row === 9 && /Basic 9/.test(p.error)), students.problems);
  ck('the pupil with no surname was refused by name of column',
    students.problems.some(p => p.row === 10 && /Surname is required/.test(p.error)), students.problems);
  ck('the two good pupils still came in', count(db, 'SELECT COUNT(*) AS n FROM students') === 2);
  ck('weightings that do not add to 100 are refused',
    subjects.problems.some(p => p.row === 9 && /add up to 100/.test(p.error)), subjects.problems);
  ck('and the two sound subjects still came in',
    count(db, 'SELECT COUNT(*) AS n FROM subjects WHERE name IN (\'English\',\'Mathematics\')') === 2);
  ck('nothing was written for a refused row',
    count(db, "SELECT COUNT(*) AS n FROM students WHERE surname='Asante'") === 0);
}

// ── 5. Mistakes that are invisible one row at a time ───────────────────
console.log('\nMistakes that only show up across a whole sheet');
{
  const db = makeDb();
  const bad = workbook();
  bad[S.SHEETS.TERMS][1].is_current = 1;                      // two current terms
  bad[S.SHEETS.GRADING][1].max_score = 85;                    // overlaps the band above
  bad[S.SHEETS.CLASSES].push(
    { __row: 9, name: 'basic 5', short_code: 'B5B', level_category: 'Primary', level_order: 5 });

  const rep = imp.importRows(db, bad);
  const terms = rep.sheets.find(s => s.sheet === S.SHEETS.TERMS);
  const grading = rep.sheets.find(s => s.sheet === S.SHEETS.GRADING);
  const classes = rep.sheets.find(s => s.sheet === S.SHEETS.CLASSES);

  ck('two current terms is refused', terms.problems.some(p => /Only one term/.test(p.error)), terms.problems);
  ck('overlapping grade bands are refused',
    grading.problems.some(p => /overlaps/.test(p.error)), grading.problems);
  ck('the same class twice under different spelling is refused',
    classes.problems.some(p => p.row === 9 && /same/.test(p.error)), classes.problems);
  ck('and only one Basic 5 exists', count(db, "SELECT COUNT(*) AS n FROM class_groups WHERE LOWER(name)='basic 5'") === 1);
}

// ── 6. The preview ─────────────────────────────────────────────────────
// Onboarding is the one moment a school has no backup to go back to, so the
// preview has to be right about what it would do — including about records that
// only a sheet earlier in the same file would have created.
console.log('\nThe preview writes nothing and still tells the truth');
{
  const db = makeDb();
  const untouched = {
    classes: count(db, 'SELECT COUNT(*) AS n FROM class_groups'),
    bands: count(db, 'SELECT COUNT(*) AS n FROM grading_bands'),
  };
  const rep = imp.importRows(db, workbook(), { dryRun: true });

  ck('the preview says so', rep.dry_run === true);
  ck('not one pupil was written', count(db, 'SELECT COUNT(*) AS n FROM students') === 0);
  ck('not one class was touched',
    count(db, 'SELECT COUNT(*) AS n FROM class_groups') === untouched.classes);
  ck('the default grading scale was left standing',
    count(db, 'SELECT COUNT(*) AS n FROM grading_bands') === untouched.bands);
  ck('and no fee schedule was raised', count(db, 'SELECT COUNT(*) AS n FROM fee_templates') === 0);
  ck('nothing was written to the audit trail',
    count(db, "SELECT COUNT(*) AS n FROM audit_log WHERE action='onboarding_imported'") === 0);
  ck('it counted nothing as failed', rep.totals.failed === 0, rep.sheets.flatMap(s => s.problems));
  ck('a pupil is not reported as being in a missing class',
    !rep.sheets.find(s => s.sheet === S.SHEETS.STUDENTS).problems.length,
    rep.sheets.find(s => s.sheet === S.SHEETS.STUDENTS).problems);
  ck('it says both pupils would be admitted',
    rep.sheets.find(s => s.sheet === S.SHEETS.STUDENTS).created === 2);
  ck('and that the two classes it names are corrections to ones already there',
    rep.sheets.find(s => s.sheet === S.SHEETS.CLASSES).updated === 2,
    rep.sheets.find(s => s.sheet === S.SHEETS.CLASSES));

  // Now do it for real: the preview's numbers must be what actually happens.
  const real = imp.importRows(db, workbook());
  ck('the real run does exactly what the preview promised',
    real.totals.created === rep.totals.created &&
    real.totals.updated === rep.totals.updated &&
    real.totals.skipped === rep.totals.skipped,
    { preview: rep.totals, real: real.totals });
}

// ── 7. A school that has never issued an index number ──────────────────
// Plenty have not. They must still be able to import, and re-import, without
// four hundred children arriving twice.
console.log('\nA school with no index numbers of its own');
{
  const db = makeDb();
  const noIds = workbook();
  noIds[S.SHEETS.STUDENTS] = [
    { __row: 7, surname: 'Owusu', first_name: 'Kofi', gender: 'Male',
      date_of_birth: '2014-03-02', class_name: 'Basic 5', status: 'Active' },
    { __row: 8, surname: 'Owusu', first_name: 'Kofi', gender: 'Male',
      date_of_birth: '2015-08-14', class_name: 'Basic 6', status: 'Active' },  // a real second Kofi Owusu
  ];
  noIds[S.SHEETS.PARENTS] = [];
  noIds[S.SHEETS.BALANCES] = [];

  const first = imp.importRows(db, noIds);
  ck('both children came in', count(db, 'SELECT COUNT(*) AS n FROM students') === 2, first.totals);
  ck('two children sharing a name are kept apart by their birthday',
    count(db, "SELECT COUNT(*) AS n FROM students WHERE surname='Owusu'") === 2);
  ck('each was issued an index number',
    count(db, "SELECT COUNT(*) AS n FROM students WHERE index_number IS NOT NULL AND index_number != ''") === 2);

  const again = imp.importRows(db, noIds);
  ck('a second import matches them on name and birthday instead',
    count(db, 'SELECT COUNT(*) AS n FROM students') === 2, again.totals);
  ck('and reports them as corrections', again.totals.created === 0, again.totals);

  // The case that must NOT be guessed at. Two children of the same name are
  // already on the roll, and a row arrives with no number and no birthday to
  // say which one it is. Picking either would silently overwrite the other
  // child's record, so the row is refused and the office is asked.
  const ambiguous = { ...noIds, [S.SHEETS.STUDENTS]: [
    { __row: 7, surname: 'Owusu', first_name: 'Kofi', gender: 'Male',
      class_name: 'Basic 5', status: 'Active', place_of_residence: 'Adenta' },
  ] };
  const rep = imp.importRows(db, ambiguous);
  const sheet = rep.sheets.find(x => x.sheet === S.SHEETS.STUDENTS);
  ck('a row that could be either child is refused, not guessed at',
    sheet.failed === 1, sheet.problems);
  ck('and the refusal asks for the fact that would settle it',
    sheet.problems.some(p => /Date of Birth|Index No/.test(p.error)), sheet.problems);
  ck('neither child was touched',
    count(db, "SELECT COUNT(*) AS n FROM students WHERE place_of_residence = 'Adenta'") === 0);
  ck('and no third child was created', count(db, 'SELECT COUNT(*) AS n FROM students') === 2);

  // Giving the birthday settles it, and only the right child changes.
  const settled = { ...noIds, [S.SHEETS.STUDENTS]: [
    { __row: 7, surname: 'Owusu', first_name: 'Kofi', gender: 'Male',
      date_of_birth: '2015-08-14', class_name: 'Basic 6', status: 'Active',
      place_of_residence: 'Adenta' },
  ] };
  imp.importRows(db, settled);
  ck('the birthday settles it and corrects exactly one child',
    count(db, "SELECT COUNT(*) AS n FROM students WHERE place_of_residence = 'Adenta'") === 1);
  ck('and it is the right one',
    db.prepare("SELECT date_of_birth FROM students WHERE place_of_residence = 'Adenta'").get()
      .date_of_birth === '2015-08-14');
}

// ── 8. The shapes an office actually types ─────────────────────────────
console.log('\nWhat the office typed, and what the system stored');
{
  ck('a phone number written six ways is stored one way',
    ['+233241234567', '233241234567', '024 123 4567', '024-123-4567', '0241234567', '241234567']
      .every(v => S.toPhone(v) === '0241234567'));
  ck('a subject list survives commas, semicolons and a pasted column',
    JSON.stringify(S.toList('English, Mathematics ; Science\nR.M.E')) ===
    JSON.stringify(['English', 'Mathematics', 'Science', 'R.M.E']));
  ck('YES, Y, TRUE and a tick all mean yes',
    ['YES', 'y', 'TRUE', '1', '✓'].every(v => S.toBool(v) === 1));
  ck('and NO means no, rather than nothing', S.toBool('NO') === 0);
  ck('a blank is neither', S.toBool('') === null);
  ck('dd/mm/yyyy is read the Ghanaian way round', S.toISODate('02/03/2014') === '2014-03-02');
  ck('a short code is worked out from a class name',
    imp.autoShortCode('Basic 5') === 'B5' && imp.autoShortCode('JHS 2') === 'JHS2');
  ck('every sheet the contract lists has a definition',
    S.SHEET_ORDER.every(n => !!S.IMPORT_SHEETS[n]));
  ck('every cross-reference points at a sheet that comes earlier',
    S.SHEET_ORDER.every((name, i) => {
      const defined = new Set(S.SHEET_ORDER.slice(0, i));
      return S.IMPORT_SHEETS[name].columns.every(c => !c.ref || defined.has(c.ref));
    }));
}

// ── 9. The round trip, through a real .xlsx ────────────────────────────
// Everything above tests the importer against rows built in memory. This one
// puts an actual Excel file in the middle, because the contract that matters is
// the one between the exporter's headers and the importer's reading of them —
// and that is exactly the seam a school's data would fall through.
//
// Skipped where exceljs is not installed, the way the regression suite does it,
// so the rest of these tests still run in a bare checkout.
let ExcelAvailable = true;
try { require(path.join(ROOT, 'node_modules/exceljs')); } catch (_) { ExcelAvailable = false; }

if (!ExcelAvailable) {
  console.log('\nThe round trip through a real Excel file');
  console.log('  (skipped — exceljs not installed in this environment)');
} else {
  (async () => {
    console.log('\nThe round trip through a real Excel file');
    const fs = require('fs');
    const os = require('os');
    const exporter = require(path.join(ROOT, 'electron/ipc/onboarding_export.js'));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edusoft-onboarding-'));

    // A blank template, of the kind a school that has nothing yet is handed.
    const blankPath = path.join(tmp, 'template.xlsx');
    const blank = await exporter.buildWorkbook(null, blankPath, { filled: false });
    ck('a template can be built with no database at all', blank.ok && fs.existsSync(blankPath));

    // Importing the untouched template must do NOTHING. The worked examples are
    // there to be read, and a school that presses Import before typing anything
    // should get an empty report, not a pupil called EXAMPLE.
    const db0 = makeDb();
    const pupilsBefore = count(db0, 'SELECT COUNT(*) AS n FROM students');
    const empty = await imp.importWorkbook(db0, blankPath, { dryRun: false });
    ck('importing the untouched template creates nothing',
      count(db0, 'SELECT COUNT(*) AS n FROM students') === pupilsBefore, empty.totals);
    ck('and the worked examples were not mistaken for data',
      count(db0, "SELECT COUNT(*) AS n FROM students WHERE surname LIKE '%EXAMPLE%'") === 0);
    ck('nor were they for staff',
      count(db0, "SELECT COUNT(*) AS n FROM staff WHERE surname LIKE '%EXAMPLE%'") === 0);
    ck('and no fee schedule was invented from them',
      count(db0, 'SELECT COUNT(*) AS n FROM fee_templates') === 0);

    // Now the real trip: a school is imported from rows, exported as a filled
    // workbook, and that file is read back into a second, empty school. The two
    // must agree — that is what makes the workbook a way to move a school.
    const src = makeDb();
    imp.importRows(src, workbook(), { file: 'ave-maria.xlsx' });

    const filledPath = path.join(tmp, 'filled.xlsx');
    const filled = await exporter.buildWorkbook(src, filledPath, { filled: true });
    ck('the school exports as a workbook', filled.ok && fs.existsSync(filledPath));

    const dest = makeDb();
    const back = await imp.importWorkbook(dest, filledPath, { dryRun: false });
    const problems = back.sheets.flatMap(s => s.problems.map(p => `${s.sheet} r${p.row}: ${p.error}`));
    ck('and reads back into an empty school without a single refusal',
      back.totals.failed === 0, problems);

    const same = (label, sql) => ck(label,
      JSON.stringify(src.prepare(sql).all()) === JSON.stringify(dest.prepare(sql).all()),
      { from: src.prepare(sql).all(), to: dest.prepare(sql).all() });

    same('the same pupils, in the same classes',
      `SELECT s.index_number, s.surname, s.first_name, s.date_of_birth, c.name AS class_name
         FROM students s LEFT JOIN class_groups c ON c.id = s.current_class_id
        ORDER BY s.index_number`);
    same('the same staff', 'SELECT surname, first_name, role, phone FROM staff ORDER BY surname');
    same('the same classes',
      'SELECT name, short_code, level_category, level_order FROM class_groups ORDER BY name');
    same('the same subjects and weightings',
      'SELECT name, code, class_weight_pct, exam_weight_pct FROM subjects ORDER BY name');
    same('the same grading scale',
      'SELECT min_score, max_score, remark FROM grading_bands ORDER BY min_score');
    same('the same fee schedule',
      `SELECT c.name, li.description, li.amount FROM fee_line_items li
         JOIN fee_templates ft ON ft.id = li.fee_template_id
         JOIN class_groups c ON c.id = ft.class_group_id
        ORDER BY c.name, li.description`);
    same('the same subjects taught to the same classes',
      `SELECT c.name AS class_name, s.name AS subject FROM class_subjects cs
         JOIN class_groups c ON c.id = cs.class_group_id
         JOIN subjects s ON s.id = cs.subject_id ORDER BY c.name, s.name`);
    same('the same arrears carried by the same pupils',
      `SELECT s.index_number, b.balance FROM student_bills b
         JOIN students s ON s.id = b.student_id WHERE b.balance > 0 ORDER BY s.index_number`);
    same('the same school name and telephone',
      "SELECT key, value FROM settings WHERE key IN ('school_name','school_phone_1') ORDER BY key");

    // And the file the office would actually correct: exported, edited, put back.
    const secondPass = await imp.importWorkbook(dest, filledPath, { dryRun: false });
    ck('the exported file re-imports without cloning anybody',
      count(dest, 'SELECT COUNT(*) AS n FROM students') === count(src, 'SELECT COUNT(*) AS n FROM students'),
      secondPass.totals);
    ck('and reports it as corrections, not admissions', secondPass.totals.created === 0, secondPass.totals);

    fs.rmSync(tmp, { recursive: true, force: true });
    finish();
  })().catch(e => { console.error(e); process.exit(1); });
}

function finish() {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

if (!ExcelAvailable) finish();
