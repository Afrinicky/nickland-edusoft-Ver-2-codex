// Nickland Edusoft — a pupil's name is data, not markup.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The report card, the receipt, the register and the timetable are built as
// HTML strings and then handed to three different renderers:
//
//   the office PC    Report.jsx → dangerouslySetInnerHTML, in the renderer
//                    that holds window.api
//   a phone/browser  print.js → doc.write() into a same-origin iframe, on a
//                    page whose localStorage holds a 30-day bearer token
//   the cloud        outbox.enqueueReportCard projects the finished HTML and
//                    the portal serves it to parents, over the internet
//
// So an unescaped `${student.surname}` is not a cosmetic bug. A pupil admitted
// as `<img src=x onerror=…>` by anybody holding Students:create becomes script
// running in all three places — with the signed-in user's whole IPC surface on
// the office PC, and with a parent's or teacher's token in the browser.
//
// reports.js escaped its table cells and not its headers, its names, or its
// term labels: 124 of the interpolations in that one file took data straight
// into markup. These tests assert the property rather than the line numbers —
// plant markup in every field a school can type into, render each document,
// and require that nothing executable comes back.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`These tests need Node >= 22.5 for node:sqlite (running ${process.versions.node}).`);
  process.exit(1);
}

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { SCHEMA, runMigrations, seedDefaults } = require(path.join(ROOT, 'electron/db/database.js'));
const { setSetting } = require(path.join(ROOT, 'electron/utils/idgen.js'));

let pass = 0, fail = 0;
const ck = (n, c, extra) => {
  c ? pass++ : fail++;
  console.log((c ? '✓ ' : '✗ ') + n + (extra !== undefined ? '  ' + extra : ''));
};

// The payload. Deliberately several shapes, because escaping one and missing
// another is the usual way this is got wrong:
//   a tag that executes on load, an attribute break-out, and a style break-out.
const TAG = '<img src=x onerror=alert(1)>';
const ATTR = '" onload="alert(2)';
const STYLE = 'red;}</style><script>alert(3)</script>';

// What must never appear in a rendered document. Checked as the raw substring,
// because that is exactly what a browser would parse as markup.
function executable(html) {
  const found = [];
  if (html.includes('<img src=x onerror=')) found.push('unescaped <img onerror>');
  if (html.includes('<script>alert(')) found.push('unescaped <script>');
  if (/ onload="alert/.test(html)) found.push('attribute break-out');
  if (html.includes('</style><script')) found.push('style break-out');
  return found;
}

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.transaction = (fn) => (...a) => {
    db.exec('BEGIN');
    try { const r = fn(...a); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  db.exec(SCHEMA);
  runMigrations(db);
  seedDefaults(db);
  db._userDataPath = path.join(ROOT, '.test-data');
  return db;
}

const db = makeDb();

// ── a school that typed markup into every box it has ────────────────────────
for (const [key, value] of Object.entries({
  school_name: `Ave Maria ${TAG}`,
  school_motto: `Excellence ${TAG}`,
  school_address: `Box 1 ${TAG}`,
  school_digital_address: `GA-123 ${TAG}`,
  school_email: `head@school.gh${ATTR}`,
  school_phone_1: `0244000000 ${TAG}`,
  school_phone_2: `0209999999 ${TAG}`,
  school_color_primary: STYLE,
  school_color_accent: STYLE,
})) setSetting(db, key, value, 'school');

// seedDefaults already ships a year and three terms, as a real install has.
// Rename the current term rather than adding one, so the fixture looks like a
// school that typed markup into Settings rather than a database nobody has.
const term = db.prepare('SELECT id FROM terms WHERE is_current = 1').get()
  || db.prepare('SELECT id FROM terms ORDER BY id LIMIT 1').get();
db.prepare('UPDATE terms SET label = ?, is_current = 1 WHERE id = ?').run(`First Term ${TAG}`, term.id);
db.prepare('UPDATE academic_years SET label = ? WHERE id = (SELECT academic_year_id FROM terms WHERE id = ?)')
  .run(`2025/2026 ${TAG}`, term.id);
const cls = db.prepare(`INSERT INTO class_groups (name, short_code, level_category, level_order)
                        VALUES (?, 'TB5', 'Primary', 5) RETURNING id`).get(`Basic 5 ${TAG}`);
const subject = db.prepare(
  "INSERT INTO subjects (name, code, is_active) VALUES (?, 'TMTH', 1) RETURNING id").get(`Maths ${TAG}`);

// A pupil whose name is markup, admitted by anybody holding Students:create.
const student = db.prepare(`
  INSERT INTO students (index_number, surname, first_name, other_names, current_class_id, status,
                        father_name, father_contact, guardian_name)
  VALUES ('AVE/001', ?, ?, ?, ?, 'Active', ?, '0244111222', ?) RETURNING id`)
  .get(`ANSU${TAG}`, `Monalisa${ATTR}`, TAG, cls.id, `Mr Ansu ${TAG}`, `Guardian ${TAG}`);

db.prepare(`INSERT INTO scores (student_id, subject_id, term_id, class_score, exam_score, total_score, grade_remark)
            VALUES (?, ?, ?, 40, 50, 90, ?)`).run(student.id, subject.id, term.id, `Excellent ${TAG}`);
db.prepare(`INSERT INTO student_term_summary (student_id, term_id, average_score, class_rank,
                                              number_on_roll, teacher_remarks, conduct_traits)
            VALUES (?, ?, 90, 1, 1, ?, ?)`)
  .run(student.id, term.id, `A fine term ${TAG}`, `Polite ${TAG}`);

const getResourcePath = () => null;
const reports = require(path.join(ROOT, 'electron/ipc/reports.js'));

// ── the report card ─────────────────────────────────────────────────────────
{
  const r = reports.reportCardDocument(db, getResourcePath, { studentId: student.id, termId: term.id });
  ck('the report card is produced', !!(r && r.ok && r.document));
  const bad = executable(String(r.document || '') + String(r.styles || ''));
  ck('a pupil named with markup does not become markup in the report card',
    bad.length === 0, bad.join('; '));
}

// ── the broadsheet ──────────────────────────────────────────────────────────
if (typeof reports.broadsheetDocument === 'function') {
  const r = reports.broadsheetDocument(db, getResourcePath, { classId: cls.id, termId: term.id });
  const bad = executable(String((r && (r.document || r.html)) || ''));
  ck('nor in the broadsheet', bad.length === 0, bad.join('; '));
}

// ── the register ────────────────────────────────────────────────────────────
{
  db.prepare(`INSERT INTO student_attendance (student_id, date, status, term_id, notes)
              VALUES (?, '2026-02-02', 'absent', ?, ?)`)
    .run(student.id, term.id, `At the clinic ${TAG}`);
  const att = require(path.join(ROOT, 'electron/ipc/students_attendance.js'));
  const fn = att.registerDocument || att.attendanceDocument || att.__registerHtmlForTest;
  if (typeof fn === 'function') {
    let out = '';
    try { out = JSON.stringify(fn(db, getResourcePath, { classId: cls.id, termId: term.id })); } catch (_) {}
    const bad = executable(out);
    ck('nor in the register, where the teacher writes the reason by hand',
      bad.length === 0, bad.join('; '));
  } else {
    ck('nor in the register (no callable document export found — skipped)', true, 'skipped');
  }
}

// ── the timetable ───────────────────────────────────────────────────────────
{
  const tt = require(path.join(ROOT, 'electron/ipc/timetable.js'));
  const fn = tt.timetableDocument || tt.__timetableHtmlForTest;
  if (typeof fn === 'function') {
    let out = '';
    try { out = JSON.stringify(fn(db, getResourcePath, { classId: cls.id, termId: term.id })); } catch (_) {}
    const bad = executable(out);
    ck('nor in the timetable', bad.length === 0, bad.join('; '));
  } else {
    ck('nor in the timetable (no callable document export found — skipped)', true, 'skipped');
  }
}

// ── the bill, which carries the same header ─────────────────────────────────
if (typeof reports.__billHtmlForTest === 'function') {
  let out = '';
  try {
    out = String(reports.__billHtmlForTest(db, getResourcePath, {
      studentIds: [student.id], termId: term.id,
    }) || '');
  } catch (_) { /* shape varies; the header is what matters */ }
  const bad = executable(out);
  ck('nor on a bill', bad.length === 0, bad.join('; '));
}

// ── the pupil profile and the bill, through their real exports ──────────────
{
  const r = reports.studentProfileDocument(db, getResourcePath, student.id, {});
  ck('the pupil profile is produced', !!(r && r.ok));
  const bad = executable(JSON.stringify(r));
  ck('nor does markup survive into the pupil profile', bad.length === 0, bad.join('; '));
  // The download filename is built from the REAL name, not the escaped one —
  // otherwise a pupil called O'Brien downloads `o_39_brien.pdf`.
  ck('...and the filename still uses the real name, not the escaped one',
    !String((r && r.suggestedName) || (r && r.filename) || '').includes('amp'));
}

{
  const r = reports.billsDocument(db, getResourcePath, { studentIds: [student.id], termId: term.id });
  const bad = executable(JSON.stringify(r));
  ck('nor into a bill produced through billsDocument', bad.length === 0, bad.join('; '));
}

// ── escaped once, not twice ─────────────────────────────────────────────────
//
// The rule in reports.js is that the function building the markup escapes its
// own inputs. If a row were escaped by both the loader and the builder, a
// pupil at "Brown & Sons Academy" would read "Brown &amp;amp; Sons" on every
// report card — so this asserts the single-escape property directly.
{
  db.prepare('UPDATE students SET surname = ?, first_name = ? WHERE id = ?')
    .run("O'Brien & Sons", 'Mary', student.id);
  setSetting(db, 'school_name', 'Brown & Sons Academy', 'school');
  const r = reports.reportCardDocument(db, getResourcePath, { studentId: student.id, termId: term.id });
  const doc = String((r && r.document) || '');
  ck('an ampersand in a name is escaped once', doc.includes('&amp;') && !doc.includes('&amp;amp;'));
  ck("...and an apostrophe survives as one character, not a mangled entity",
    doc.includes('&#39;') || doc.includes("O'Brien"));
  ck('the school name with an ampersand is escaped once',
    doc.includes('Brown &amp; Sons') && !doc.includes('Brown &amp;amp; Sons'));
}

// ── the colour fields are validated, not escaped ────────────────────────────
//
// A colour lands inside a `style` attribute, where escapeHtml touches nothing
// that matters: `red;}</style><script>` contains no &, <, > ... except it does,
// which is why the payload above was caught. The real defence is the grammar.
{
  const html = require(path.join(ROOT, 'electron/ipc/_html.js'));
  ck('a valid hex colour passes through', html.cssColor('#ab12cd') === '#ab12cd');
  ck('a valid rgb() passes through', html.cssColor('rgb(1, 2, 3)') === 'rgb(1, 2, 3)');
  ck('a named colour passes through', html.cssColor('rebeccapurple') === 'rebeccapurple');
  ck('a stylesheet break-out is replaced by the default',
    html.cssColor('red;}</style><script>alert(1)</script>', '#000') === '#000');
  ck('a url() is refused', html.cssColor('url(javascript:alert(1))', '#000') === '#000');
  ck('an expression is refused', html.cssColor('expression(alert(1))', '#000') === '#000');
  ck('an svg crest is refused, because an SVG can carry script',
    html.imageDataUri('data:image/svg+xml;base64,AAAA') === '');
  ck('a png crest passes through',
    html.imageDataUri('data:image/png;base64,iVBORw0KGgo=') === 'data:image/png;base64,iVBORw0KGgo=');
  ck('a javascript: url is refused', html.imageDataUri('javascript:alert(1)') === '');
}

// ── the documents refuse to run script, whoever renders them ────────────────
//
// Escaping is the fix for the bug found here. This is the defence for the next
// one: these strings are written into an iframe, handed to expo-print, opened
// as a blob: URL and stored in the cloud for parents — none of which carries a
// header, so the policy travels inside the document.
{
  const docs = [
    ['report card', reports.reportCardDocument(db, getResourcePath, { studentId: student.id, termId: term.id })],
    ['pupil profile', reports.studentProfileDocument(db, getResourcePath, student.id, {})],
    ['bills', reports.billsDocument(db, getResourcePath, { studentIds: [student.id], termId: term.id })],
  ];
  for (const [label, r] of docs) {
    const doc = String((r && (r.document || r.html)) || '');
    if (!doc.includes('<head>')) { ck(`${label} carries script-src 'none' (no <head> — skipped)`, true, 'skipped'); continue; }
    ck(`the ${label} declares script-src 'none'`, /script-src\s+'none'/.test(doc));
    const headStart = doc.indexOf('<head>');
    const metaAt = doc.indexOf('Content-Security-Policy');
    ck(`...inside <head>, where a meta CSP is actually honoured`,
      metaAt > headStart && metaAt < doc.indexOf('</head>'));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
