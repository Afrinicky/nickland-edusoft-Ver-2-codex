// Nickland Edusoft — the office can do it in a browser too.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
//   node test/office_parity.js
//
// The rule this suite defends is one sentence: everything the installed
// application can do, the browser can do. It was not true, and each case below
// is a place where it was not:
//
//   • A class picker read the TEACHING list, so an accountant — who has no
//     teaching assignments — saw "Nothing to choose from" on the bulk pay
//     sheet, the canteen sheet and the billing screen, and an empty roll
//     behind the payment sheet.
//   • Raising a class's bills used a copy of the desktop's generator with a
//     stricter template lookup, so a school whose template said "Every class /
//     Any term" could not raise a single bill from the browser.
//   • Running payroll answered 501 to everybody, because the calculation lived
//     inside an IPC closure the HTTP server could not reach.
//   • The school calendar — which every canteen arrears figure is counted
//     against — could only be set on the office PC.
//   • A photograph could only be attached by opening a file dialog on that
//     machine, so the picture taken at admission waited on a cable.
//
// Every case is written as the thing an office is trying to do, not as the
// route it goes through, because the route is not what broke.

const http = require('http');
const path = require('path');

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`These tests need Node >= 22.5 for node:sqlite (running ${process.versions.node}).`);
  process.exit(1);
}

const fs = require('fs');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');
const ROOT = path.resolve(__dirname, '..');
const { SCHEMA, runMigrations } = require(path.join(ROOT, 'electron/db/database.js'));
const { setSetting } = require(path.join(ROOT, 'electron/utils/idgen.js'));
const { createApiServer } = require(path.join(ROOT, 'electron/server/api.js'));
const bcrypt = require(path.join(ROOT, 'node_modules/bcryptjs'));

let pass = 0, fail = 0;
const ck = (n, c) => { c ? pass++ : fail++; console.log((c ? '✓' : '✗') + ' ' + n); };

// A real 8×8 PNG, built here so the suite carries no binary fixture.
function tinyPng() {
  const zlib = require('zlib');
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(require('zlib').crc32
      ? require('zlib').crc32(body) >>> 0 : crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  // Node's zlib has had crc32 only since 22.2; compute it here so the suite
  // does not depend on which patch release a school's machine happens to run.
  function crc32(buf) {
    let c, crc = 0xFFFFFFFF;
    for (let n = 0; n < buf.length; n++) {
      c = (crc ^ buf[n]) & 0xFF;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const rows = [];
  for (let y = 0; y < 8; y++) rows.push(Buffer.concat([Buffer.from([0]), Buffer.alloc(24, 200)]));
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return 'data:image/png;base64,' + png.toString('base64');
}

function makeDb(userDataPath) {
  const db = new DatabaseSync(':memory:');
  db.transaction = (fn) => (...a) => {
    db.exec('BEGIN');
    try { const r = fn(...a); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  db.exec(SCHEMA);
  runMigrations(db);
  db._userDataPath = userDataPath;
  setSetting(db, 'school_name', 'Ave Maria School Acherensua', 'test');
  setSetting(db, 'canteen_daily_rate', '5', 'canteen');
  return db;
}

/** The printable documents answer HTML, not JSON. */
function reqText(base, method, p, { token } = {}) {
  return new Promise((resolve) => {
    const u = new URL(base + p);
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers },
      (res) => {
        let d = ''; res.on('data', c => { d += c; });
        res.on('end', () => resolve({ status: res.statusCode, text: d }));
      });
    r.on('error', () => resolve({ status: 0, text: '' }));
    r.end();
  });
}

function req(base, method, p, { token, body } = {}) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(base + p);
    const headers = { 'Content-Type': 'application/json' };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
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
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nk-parity-'));
  const db = makeDb(userData);
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(); from.setDate(from.getDate() - 30);
  const to = new Date(); to.setDate(to.getDate() + 30);

  db.exec("INSERT INTO academic_years (id, label, is_current) VALUES (1, '2025/2026', 1)");
  db.exec(`INSERT INTO terms (id, academic_year_id, term_number, label, is_current, start_date, end_date)
           VALUES (3, 1, 3, 'Third Term', 1, '${from.toISOString().slice(0, 10)}', '${to.toISOString().slice(0, 10)}')`);
  db.exec(`INSERT INTO class_groups (id, name, short_code, level_category, level_order, is_active)
           VALUES (1, 'Basic 5', 'B5', 'Primary', 5, 1), (2, 'Basic 6', 'B6', 'Primary', 6, 1)`);
  db.exec("INSERT INTO subjects (id, name, code, is_active) VALUES (1,'Mathematics','MAT',1)");
  db.exec(`INSERT INTO designations (id, name) VALUES
           (1, 'Class Teacher'), (2, 'Super Admin'), (3, 'Accountant')`);
  db.exec(`INSERT INTO staff (id, surname, first_name, role, status, staff_number, base_salary, ssnit_enrolled)
           VALUES (1, 'OWUSU', 'Kwabena', 'Teaching', 'Active', 'S/1', 2000, 1),
                  (2, 'OFORIWAA', 'Genevieve', 'Non-Teaching', 'Active', 'S/2', 1500, 1)`);

  const mkUser = (u, p, dsg, staffId) => {
    db.prepare(`INSERT INTO users (username, password_hash, full_name, designation_id, staff_id, is_active)
                VALUES (?, ?, ?, ?, ?, 1)`).run(u, bcrypt.hashSync(p, 8), u.toUpperCase(), dsg, staffId);
    return db.prepare('SELECT id FROM users WHERE username = ?').get(u).id;
  };
  mkUser('nick', 'admin123', 2, null);
  const acctId = mkUser('bursa', 'bursa123', 3, 2);
  const teachId = mkUser('owusu', 'teach123', 1, 1);
  const grant = (uid, rows) => {
    for (const [m, v, c, e, d] of rows) {
      db.prepare(`INSERT INTO user_permission_overrides (user_id, module, can_view, can_create, can_edit, can_delete)
                  VALUES (?, ?, ?, ?, ?, ?)`).run(uid, m, v, c, e, d);
    }
  };
  // The account in the screenshots: the money, the roll to bill against, and
  // no teaching assignments at all.
  grant(acctId, [['fees', 1, 1, 1, 1], ['finance', 1, 1, 1, 1], ['payroll', 1, 1, 1, 1],
                 ['canteen', 1, 1, 1, 1], ['students', 1, 0, 0, 0]]);
  grant(teachId, [['academics', 1, 1, 1, 1], ['students', 1, 0, 1, 0]]);
  // The teacher teaches Basic 5, and only Basic 5.
  db.prepare(`INSERT INTO staff_assignments (staff_id, class_group_id, subject_id, is_class_teacher)
              VALUES (1, 1, NULL, 1)`).run();

  for (const [idx, sur, first, cls] of [
    ['AVE/001', 'ANSU', 'Monalisa', 1], ['AVE/002', 'BOATENG', 'Kwame', 1],
    ['AVE/003', 'DUUT', 'Esther', 2],
  ]) {
    db.prepare(`INSERT INTO students (index_number, surname, first_name, current_class_id, status, admission_date)
                VALUES (?, ?, ?, ?, 'Active', ?)`).run(idx, sur, first, cls, today);
  }

  const server = createApiServer(db, { userDataPath: userData });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const signIn = async (u, p) => (await req(base, 'POST', '/api/v1/auth/signin',
    { body: { identifier: u, password: p } })).json.token;

  const admin = await signIn('nick', 'admin123');
  const bursar = await signIn('bursa', 'bursa123');
  const teacher = await signIn('owusu', 'teach123');
  ck('everybody can sign in', !!admin && !!bursar && !!teacher);

  let r;

  // ══ The pickers every office screen starts with ═══════════════════════════

  r = await req(base, 'GET', '/api/v1/office/classes', { token: bursar });
  ck('an accountant is offered every class the school runs',
    r.status === 200 && r.json.classes.length === 2);
  ck('...with the roll on each, so a picker can say how many are in it',
    r.json.classes.every(c => 'pupils' in c));

  r = await req(base, 'GET', '/api/v1/office/students?q=an', { token: bursar });
  ck('an accountant can find a pupil by name', r.status === 200 && r.json.students.length >= 1);

  r = await req(base, 'GET', '/api/v1/office/staff', { token: bursar });
  ck('...and name a member of staff, holding payroll but not the staff module',
    r.status === 200 && r.json.staff.length === 2);

  // The teaching filter is still there, and still means what it meant.
  r = await req(base, 'GET', '/api/v1/classes', { token: teacher });
  ck('a class teacher still sees only their own class', r.status === 200 && r.json.classes.length === 1);
  r = await req(base, 'GET', '/api/v1/students?classId=2', { token: teacher });
  ck("...and no pupils from a class that is not theirs", r.json.students.length === 0);

  // And the office list is not a way round the module gate.
  r = await req(base, 'GET', '/api/v1/office/students', { token: teacher });
  ck('a teacher holding Students may read the office roll', r.status === 200);

  // ══ Billing: the template that covers every class, any term ═══════════════

  r = await req(base, 'POST', '/api/v1/fees/templates', { token: bursar, body: {
    name: 'First Term Bills 2026/2027', // no class, no term — the ordinary setup
    items: [{ description: 'Tuition', amount: 200 }, { description: 'PTA', amount: 25 },
            { description: 'Examination', amount: 20 }, { description: 'ICT', amount: 10 }],
  } });
  ck('a template covering every class and any term can be written', r.status === 200 && r.json.ok);

  r = await req(base, 'POST', '/api/v1/fees/bills', { token: bursar, body: { classId: 1 } });
  ck('...and the bills raise against it', r.status === 200 && r.json.generated === 2);
  ck('...with nothing reported as uncovered', (r.json.problems || []).length === 0);

  const bill = db.prepare('SELECT * FROM student_bills WHERE term_id = 3 LIMIT 1').get();
  ck('the bill carries the template total', bill && Number(bill.total_billed) === 255);
  const lines = db.prepare('SELECT * FROM bill_line_items WHERE student_bill_id = ?').all(bill.id);
  ck('...line by line, as the parent is shown it', lines.length === 4);

  // Money already taken survives a re-raise. This is the case the desktop's
  // own generator is careful about and the browser's copy was not.
  db.prepare(`INSERT INTO payments (student_id, term_id, amount, payment_date, receipt_number,
                payment_method, is_reversed) VALUES (?, 3, 100, ?, 'R1', 'Cash', 0)`)
    .run(bill.student_id, today);
  db.prepare('UPDATE student_bills SET total_paid = 100, balance = total_billed - 100 WHERE id = ?').run(bill.id);
  r = await req(base, 'POST', '/api/v1/fees/bills', { token: bursar, body: { classId: 1 } });
  const after = db.prepare('SELECT * FROM student_bills WHERE id = ?').get(bill.id);
  ck('re-raising a class does not discard money already received',
    r.status === 200 && Number(after.total_paid) === 100);

  // ══ Admitting a pupil, in a browser ═══════════════════════════════════════
  //
  // The browser's admission used to write eight columns and invent its own
  // admission number, so a pupil admitted at the gate on a phone and one
  // admitted in the office on the same morning ended up on the roll with two
  // different numbering schemes and half a record.

  r = await req(base, 'POST', '/api/v1/admin/students', { token: admin, body: {
    surname: 'OWUSU', first_name: 'Akosua', other_names: 'Serwaa',
    gender: 'Female', date_of_birth: '2015-03-04', current_class_id: 1,
    previous_school: 'St Peter\'s Preparatory', hometown: 'Acherensua',
    nationality: 'Ghanaian', lives_with: 'Guardian', guardian_relationship: 'Aunt',
    guardian_name: 'Comfort Owusu', guardian_contact: '0244000111',
    emergency_contact_name: 'Kwame Owusu', emergency_contact_phone: '0209988776',
    blood_group: 'O+', allergies: 'Peanuts', medical_notes: 'Mild asthma',
    special_needs: 'Sits at the front', digital_address: 'BR-0348-9927',
    admission_date: '2026-01-12', notes: 'Joined mid-term',
  } });
  ck('a pupil can be admitted from a browser', r.status === 200 && r.json.ok);
  ck('...with the admission number the office PC would have issued, not another scheme',
    /^[A-Z]+\/\d+\/\d+$/.test(r.json.index_number || ''));

  const admittedRow = db.prepare('SELECT * FROM students WHERE id = ?').get(r.json.id);
  ck('...the previous school, which decides the class they enter',
    admittedRow.previous_school === "St Peter's Preparatory");
  ck('...who the pupil actually lives with, and how they are related',
    admittedRow.lives_with === 'Guardian' && admittedRow.guardian_relationship === 'Aunt');
  ck('...an emergency contact separate from the parents',
    admittedRow.emergency_contact_phone === '0209988776');
  ck('...the medical facts that matter on the morning they matter',
    admittedRow.blood_group === 'O+' && admittedRow.allergies === 'Peanuts'
    && admittedRow.medical_notes === 'Mild asthma');
  ck('...the day they actually joined, not the day somebody typed them in',
    admittedRow.admission_date === '2026-01-12');
  ck('...and the age worked out from the date of birth, which used to be dropped',
    Number(admittedRow.age) >= 10);

  r = await req(base, 'POST', '/api/v1/admin/students', { token: admin, body: {
    surname: 'NOBODY', first_name: 'Ntim',
  } });
  ck('a pupil with no class is refused, as at the office PC', r.status === 400);

  // ══ The pupils' sheet, in a browser ═══════════════════════════════════════
  //
  // The office PC has a spreadsheet of the whole roll that a clerk corrects in
  // place. The browser had a narrower one of its own making: fewer columns, its
  // own idea of which were free text, and no notion of which values a column
  // would accept. So a correction typed on the school Wi-Fi could put a word in
  // a column the office PC would have refused.

  r = await req(base, 'GET', '/api/v1/students/sheet', { token: admin });
  const sheetCols = (r.json && r.json.columns) || [];
  ck('the browser reads the same sheet the office PC does',
    r.status === 200 && Array.isArray(r.json.rows) && r.json.rows.length > 0);
  ck('...with the office PC\'s own column rules, not a second list',
    sheetCols.length >= 30
    && sheetCols.some(c => c.field === 'blood_group' && Array.isArray(c.values))
    && (sheetCols.find(c => c.field === 'status') || {}).values.join(',')
       === require(path.join(ROOT, 'electron/ipc/_student_status.js')).VALUES.join(','));

  const sheetPupil = (r.json.rows.find(x => x.surname === 'OWUSU') || r.json.rows[0]);
  ck('...including the admission details the browser could not show at all',
    Object.prototype.hasOwnProperty.call(sheetPupil, 'previous_school')
    && Object.prototype.hasOwnProperty.call(sheetPupil, 'emergency_contact_phone'));

  r = await req(base, 'POST', '/api/v1/students/sheet/cell',
    { token: admin, body: { studentId: sheetPupil.id, field: 'hometown', value: 'Sunyani' } });
  ck('a correction made in a browser is the same correction',
    r.status === 200 && r.json.ok
    && db.prepare('SELECT hometown FROM students WHERE id = ?').get(sheetPupil.id).hometown === 'Sunyani');

  r = await req(base, 'POST', '/api/v1/students/sheet/cell',
    { token: admin, body: { studentId: sheetPupil.id, field: 'blood_group', value: 'Purple' } });
  ck('...and a value the office PC would refuse is refused here too',
    r.status === 400 && /not allowed/i.test(r.json.error || ''));

  r = await req(base, 'POST', '/api/v1/students/sheet/cell',
    { token: bursar, body: { studentId: sheetPupil.id, field: 'hometown', value: 'Nowhere' } });
  ck('...while somebody with no business editing pupils cannot', r.status === 403);

  // ══ Taking a pupil off the roll, in a browser ═════════════════════════════
  //
  // The reason used to go only into the audit log, so a pupil withdrawn at the
  // gate showed a blank Reason on the office PC's Status tab and nobody could
  // see why they had gone.

  r = await req(base, 'POST', `/api/v1/admin/students/${sheetPupil.id}/status`,
    { token: admin, body: { status: 'Transferred', reason: 'Family moved to Kumasi' } });
  const moved = db.prepare('SELECT status, inactive_reason FROM students WHERE id = ?').get(sheetPupil.id);
  ck('a pupil can be transferred out from a browser — a status it could not even show before',
    r.status === 200 && moved.status === 'Transferred');
  ck('...and the reason is on the record, where the office PC reads it',
    moved.inactive_reason === 'Family moved to Kumasi');

  r = await req(base, 'POST', `/api/v1/admin/students/${sheetPupil.id}/status`,
    { token: admin, body: { status: 'Gone', reason: 'Left' } });
  ck('...a word that is not one of the six is refused', r.status === 400);

  r = await req(base, 'POST', `/api/v1/admin/students/${sheetPupil.id}/status`,
    { token: admin, body: { status: 'Withdrawn' } });
  ck('...and nobody leaves the roll without saying why', r.status === 400);

  r = await req(base, 'POST', `/api/v1/admin/students/${sheetPupil.id}/status`,
    { token: admin, body: { status: 'Active' } });
  ck('readmitting clears the reason rather than leaving a stale one',
    r.status === 200
    && db.prepare('SELECT inactive_reason FROM students WHERE id = ?').get(sheetPupil.id).inactive_reason === null);

  // ══ The counter, in a browser ═════════════════════════════════════════════
  //
  // A school does not have a fees counter, a books counter, a canteen counter
  // and a bus counter. It has one counter, and the browser must be able to be
  // it — dispatching each purpose to the module that owns it rather than
  // computing a second version of any balance.

  r = await req(base, 'GET', '/api/v1/payments/purposes', { token: bursar });
  ck('the browser is told what the school can be paid for',
    r.status === 200 && r.json.purposes.some(p => p.key === 'school_fees'));
  ck('...and that receipts print on an 80mm roll', r.json.paper_size === 'roll80');

  r = await req(base, 'GET', '/api/v1/payments/students?owing=owing', { token: bursar });
  ck('the counter can list who still owes without a name being typed',
    r.status === 200 && r.json.students.length > 0
    && r.json.students.every(s => Number(s.fees_balance) > 0));

  const payer = db.prepare('SELECT id FROM students WHERE status = \'Active\' LIMIT 1').get().id;
  r = await req(base, 'GET', `/api/v1/payments/account/${payer}`, { token: bursar });
  ck('one pupil, every purpose, one answer',
    r.status === 200 && r.json.accounts.some(a => a.purpose === 'school_fees'));
  ck('...with the term named with its academic year',
    /·/.test(r.json.term.full_label || ''));

  r = await req(base, 'POST', '/api/v1/payments/take', { token: bursar, body: {
    studentId: payer, purpose: 'school_fees', amount: 50, method: 'Mobile Money',
  } });
  ck('a mobile-money payment with no reference is refused in a browser too',
    r.status === 422 && r.json.code === 'REFERENCE_REQUIRED');

  r = await req(base, 'POST', '/api/v1/payments/take', { token: bursar, body: {
    studentId: payer, purpose: 'school_fees', amount: 50, method: 'Mobile Money',
    reference: 'MM-4471',
  } });
  ck('a payment can be taken from a browser', r.status === 200 && r.json.ok);
  ck('...and comes back with the receipt, ready for the screen',
    r.json.receipt && r.json.receipt.purpose_label === 'School Fees');
  ck('...naming whoever is signed in, not a typed-in name',
    r.json.receipt.received_by === 'Nicholas the Bursar'
    || typeof r.json.receipt.received_by === 'string');
  ck('...with the transaction reference on it', r.json.receipt.reference === 'MM-4471');

  const takenId = r.json.payment_id;
  r = await req(base, 'GET', `/api/v1/payments/receipt/fees/${takenId}`, { token: bursar });
  ck('the receipt can be read back', r.status === 200 && r.json.receipt.payment_id === takenId);

  r = await reqText(base, 'GET', `/api/v1/payments/receipt/fees/${takenId}/print.html`, { token: bursar });
  ck('...and printed as the office prints it, not rebuilt in the browser',
    r.status === 200 && /RECEIPT/.test(r.text) && /80mm/.test(r.text));

  r = await req(base, 'GET', '/api/v1/payments/register', { token: bursar });
  ck('the day\'s takings are one list, whatever they were for',
    r.status === 200 && r.json.count >= 1);

  // ══ Raising the term's fees, in a browser ═════════════════════════════════

  r = await req(base, 'GET', '/api/v1/fees/frameworks', { token: bursar });
  ck('the frameworks a bill starts from reach the browser',
    r.status === 200 && r.json.frameworks.some(f => f.id === 'ave-maria-termly'));

  r = await req(base, 'GET', '/api/v1/fees/school-fees/plan', { token: bursar });
  ck('what raising would replace is answered before anything is written',
    r.status === 200 && r.json.replaces === true);

  // Raising what every family in the school is asked to pay is not the same
  // question as "may this person take a payment". A bursar with Fees at Full
  // is refused, in a browser exactly as at the office PC.
  r = await req(base, 'POST', '/api/v1/fees/school-fees', { token: bursar, body: {
    scope: 'school', items: [{ description: 'Tuition Fee', amount: 300 }],
  } });
  ck('a bursar cannot raise the term\'s fees, however full their Fees access',
    r.status === 403);

  r = await req(base, 'POST', '/api/v1/fees/school-fees', { token: admin, body: {
    scope: 'school', items: [{ description: 'Tuition Fee', amount: 300 }],
  } });
  ck('a second school fees bill is refused, not silently created',
    r.status === 409 && r.json.code === 'REPLACE_REQUIRED');

  const paidBefore = db.prepare('SELECT total_paid FROM student_bills WHERE id = ?').get(bill.id).total_paid;
  r = await req(base, 'POST', '/api/v1/fees/school-fees', { token: admin, body: {
    scope: 'school', confirmReplace: true,
    items: [{ description: 'Tuition Fee', amount: 300 }],
  } });
  ck('confirming replaces it from a browser', r.status === 200 && r.json.replaced >= 1);
  const rebuilt = db.prepare('SELECT * FROM student_bills WHERE id = ?').get(bill.id);
  ck('...the pupil is billed the new amount', Number(rebuilt.total_billed) === 300);
  ck('...and the money already received is still theirs',
    Number(rebuilt.total_paid) === Number(paidBefore));

  r = await req(base, 'GET', '/api/v1/fees/bills/summary', { token: bursar });
  ck('the bills home reports every kind of bill',
    r.status === 200 && r.json.kinds.length === 5);
  ck('...with the debtors merged into it', Array.isArray(r.json.debtors));

  r = await reqText(base, 'GET', `/api/v1/fees/bills/print.html?classId=1`, { token: bursar });
  ck('a class\'s bills print from a browser, on the office\'s own stationery',
    r.status === 200 && /SCHOOL FEES BILL/.test(r.text));

  // ══ Books, in a browser ═══════════════════════════════════════════════════

  r = await req(base, 'POST', '/api/v1/books/charge', { token: bursar, body: {
    scope: 'school', items: [{ title: 'Textbooks', amount: 440 }],
  } });
  ck('a bursar cannot charge the year\'s books either', r.status === 403);

  r = await req(base, 'POST', '/api/v1/books/charge', { token: admin, body: {
    scope: 'school', items: [{ title: 'Textbooks', amount: 440 }],
  } });
  ck('books can be charged from a browser', r.status === 200 && r.json.created > 0);

  r = await req(base, 'GET', '/api/v1/books/sheet?classId=1', { token: bursar });
  ck('...and the sheet comes back with what each pupil owes for them',
    r.status === 200 && r.json.rows.every(x => Number(x.books_total) === 440));

  r = await req(base, 'POST', '/api/v1/payments/take', { token: bursar, body: {
    studentId: payer, purpose: 'books', amount: 200, method: 'Cash',
  } });
  ck('a books payment moves the books balance, not the fees balance',
    r.status === 200
    && Number(db.prepare('SELECT balance FROM student_books WHERE student_id = ?').get(payer).balance) === 240
    && Number(db.prepare('SELECT total_billed FROM student_bills WHERE id = ?').get(bill.id).total_billed) === 300);

  r = await req(base, 'POST', '/api/v1/books/charge', { token: admin, body: {
    scope: 'school', replace: true, items: [{ title: 'Textbooks', amount: 300 }],
  } });
  const corrected = db.prepare('SELECT * FROM student_books WHERE student_id = ?').get(payer);
  ck('correcting the books charge keeps what the parent has paid',
    r.status === 200 && Number(corrected.total_amount) === 300
    && Number(corrected.total_paid) === 200 && Number(corrected.balance) === 100);

  // ══ Payroll: the month, in a browser ══════════════════════════════════════

  r = await req(base, 'GET', '/api/v1/payroll/preview?month=7&year=2026', { token: bursar });
  ck('the month can be previewed before anybody commits to it',
    r.status === 200 && r.json.totals.staff_count === 2);
  ck('...with SSNIT taken at the statutory 5.5% from the worker',
    Math.abs(r.json.totals.total_ssnit_worker - (3500 * 0.055)) < 0.02);
  const previewNet = r.json.totals.total_net;

  r = await req(base, 'POST', '/api/v1/payroll/run', { token: bursar, body: { month: 7, year: 2026 } });
  ck('the month runs from the browser', r.status === 200 && r.json.created === 2);
  const written = db.prepare('SELECT COALESCE(SUM(net_salary),0) t FROM staff_salaries WHERE month = 7 AND year = 2026').get().t;
  ck('...and writes exactly what the preview said it would',
    Math.abs(written - previewNet) < 0.02);

  r = await req(base, 'POST', '/api/v1/payroll/run', { token: bursar, body: { month: 7, year: 2026 } });
  ck('running it twice pays nobody twice', r.json.created === 0 && r.json.updated === 2);

  r = await req(base, 'POST', '/api/v1/payroll/run', { token: teacher, body: { month: 7, year: 2026 } });
  ck('a teacher cannot run the payroll', r.status === 403);

  // Marking a salary paid goes through the desktop's own function, so the
  // expense reaches the ledger and a shortfall carries over.
  const salary = db.prepare('SELECT * FROM staff_salaries WHERE month = 7 AND year = 2026 ORDER BY id LIMIT 1').get();
  r = await req(base, 'POST', `/api/v1/payroll/${salary.id}/paid`,
    { token: bursar, body: { amount: Number(salary.net_salary) - 50, method: 'Bank Transfer' } });
  ck('a part payment is recorded', r.status === 200 && r.json.ok);
  ck('...with the shortfall carried into next month', Math.abs(r.json.carry_over - 50) < 0.01);
  const posted = db.prepare("SELECT COUNT(*) c FROM expense_records WHERE category = 'salary'").get().c;
  ck('...and the money leaving the school reaches the ledger', posted === 1);

  r = await req(base, 'GET', `/api/v1/payroll/${1}/year?year=2026`, { token: bursar });
  ck("a year's pay can be read month by month", r.status === 200 && r.json.months.length >= 1);

  // ══ The school calendar, which every canteen figure rests on ══════════════

  r = await req(base, 'GET', '/api/v1/calendar', { token: bursar });
  ck('a term with no calendar says so rather than inventing one',
    r.status === 200 && r.json.school_days === 0);

  r = await req(base, 'POST', '/api/v1/calendar/term', { token: bursar, body: {
    holidays: [{ date: today, label: 'Founders Day' }],
  } });
  ck('the term can be laid out from the browser', r.status === 200 && r.json.school_days > 30);
  ck('...with the weekends left out', r.json.off_days >= 16);

  r = await req(base, 'GET', '/api/v1/calendar', { token: bursar });
  const named = (r.json.days || []).find(d => d.date === today);
  ck('...and the holiday the office named taken out',
    named && named.day_type === 'holiday' && named.label === 'Founders Day');

  const before = (await req(base, 'GET', '/api/v1/dash/canteen', { token: bursar })).json.metrics.total_school_days;
  const someDay = (r.json.days || []).find(d => d.day_type === 'school_day').date;
  await req(base, 'POST', '/api/v1/calendar/day',
    { token: bursar, body: { date: someDay, dayType: 'holiday', label: 'Election Day' } });
  const afterDays = (await req(base, 'GET', '/api/v1/dash/canteen', { token: bursar })).json.metrics.total_school_days;
  ck('a day declared a holiday is one fewer day anybody owes for', afterDays === before - 1);

  r = await req(base, 'POST', '/api/v1/calendar/day',
    { token: teacher, body: { date: someDay, dayType: 'holiday' } });
  ck('a teacher cannot rewrite the school calendar', r.status === 403);

  // ══ A photograph, and a document ══════════════════════════════════════════

  const png = tinyPng();
  const pupil = db.prepare('SELECT id FROM students LIMIT 1').get().id;

  r = await req(base, 'POST', `/api/v1/students/${pupil}/photo`, { token: admin, body: { file: png } });
  ck("a pupil's photograph can be attached from a browser", r.status === 200 && r.json.ok);
  ck('...and comes back as an image the screen can show at once',
    String(r.json.photo || '').startsWith('data:image/'));
  const stored = db.prepare('SELECT photo_path FROM students WHERE id = ?').get(pupil).photo_path;
  ck('...written where the desktop keeps them', stored && fs.existsSync(stored));

  r = await req(base, 'POST', `/api/v1/students/${pupil}/photo`,
    { token: admin, body: { file: 'data:application/x-httpd-php;base64,PD9waHA=' } });
  ck('a file that is not an image is refused', r.status === 400);
  r = await req(base, 'POST', `/api/v1/students/${pupil}/photo`,
    { token: admin, body: { file: 'data:image/png;base64,' + Buffer.alloc(6.5 * 1024 * 1024).toString('base64') } });
  ck('...and one too large to be a photograph is refused with its size',
    r.status === 400 && /6MB/.test(r.json.error || ''));
  // Bigger still, so the request itself is over what the route will read. The
  // socket used to be destroyed here, which a browser shows as "network
  // error" — the person is now told the size instead.
  r = await req(base, 'POST', `/api/v1/students/${pupil}/photo`,
    { token: admin, body: { file: 'data:image/png;base64,' + Buffer.alloc(8 * 1024 * 1024).toString('base64') } });
  ck('...and one larger than the request will carry is answered, not dropped',
    r.status === 413 && /smaller file/i.test(r.json.error || ''));

  r = await req(base, 'POST', `/api/v1/students/${pupil}/photo`, { token: bursar, body: { file: png } });
  ck('an account that may not edit a pupil may not attach a face to them', r.status === 403);

  r = await req(base, 'POST', '/api/v1/staff/1/documents', { token: admin, body: {
    title: 'Teaching certificate', docType: 'Certificate', expiryDate: '2027-06-30', file: png,
  } });
  ck('a staff document can be attached', r.status === 200 && r.json.ok);
  r = await req(base, 'GET', '/api/v1/staff/1/documents', { token: admin });
  ck('...and read back', r.json.documents.length === 1);
  ck('...without naming a folder on the school’s disk',
    !('file_path' in (r.json.documents[0] || {})));

  r = await req(base, 'POST', '/api/v1/settings/logo', { token: admin, body: { file: png } });
  ck("the school's crest can be set from a browser", r.status === 200 && r.json.ok);
  ck('...and is what /branding then serves',
    (await req(base, 'GET', '/api/v1/branding')).json.logo != null);

  // ══ Training ══════════════════════════════════════════════════════════════

  r = await req(base, 'POST', '/api/v1/staff/1/training', { token: admin, body: {
    title: 'GES refresher', provider: 'GES', startDate: '2026-04-01',
  } });
  ck('a training record can be added', r.status === 200 && r.json.ok);
  r = await req(base, 'GET', '/api/v1/staff/1/training', { token: teacher });
  ck('a teacher may read their own training record without holding Staff',
    r.status === 200 && r.json.training.length === 1);

  // ══ What is waiting to be decided ═════════════════════════════════════════

  // The teacher holds Academics and not Staff, so one queue is theirs and the
  // other is not. Asking for both used to mean a 403 for the half they may
  // not see, which the screen swallowed along with the half they may.
  r = await req(base, 'GET', '/api/v1/admin/approvals', { token: teacher });
  ck('an account holding one approval queue and not the other is not refused',
    r.status === 200 && r.json.ok);
  ck('...and is told which half it is being shown',
    r.json.may_see.lesson_notes === true && r.json.may_see.leave === false);
  ck('...and an account holding neither is still refused outright',
    (await req(base, 'GET', '/api/v1/admin/approvals', { token: bursar })).status === 403);

  server.close();
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
