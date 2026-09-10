// Nickland Edusoft — Onboarding workbook: export.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Builds the file a school fills in to come onto the system. It is the same
// workbook in two moods:
//
//   • BLANK (a new school). Every sheet has its headers, its one line of plain
//     help, its dropdowns and a few worked example rows greyed out beneath —
//     because "Level" means nothing until you have seen "Primary" in the cell
//     under it. The examples are marked EXAMPLE and the importer skips them.
//
//   • FILLED (a school already running). Every sheet carries what the system
//     currently holds. That makes the workbook a round trip rather than a
//     one-way form: export, correct four hundred phone numbers in Excel where
//     that is a two-minute job, import.
//
// The layout is the finance workbook's, deliberately — same head, same header
// row count, same navy and gold — so an office that has used one already knows
// where to type.

const S = require('./_onboarding_schema');
// The exporter reads back exactly the line the importer writes, so the label
// is taken from there rather than spelt a second time here.
const { OPENING_BALANCE_LABEL } = require('./onboarding_import');
const { SHEETS, SHEET_ORDER, IMPORT_SHEETS } = S;

function ExcelJS() { return require('exceljs'); }

const BRAND = {
  navy: 'FF1B3A6B', gold: 'FFC9961A', light: 'FFEEF3FA',
  grey: 'FFF5F5F5', white: 'FFFFFFFF', border: 'FFD9D9D9',
  example: 'FF9AA5B1', required: 'FFFFF4E5',
};

// A row the school is meant to look at and type underneath, never to import.
const EXAMPLE_MARK = 'EXAMPLE';

function getSetting(db, key, dflt = '') {
  try {
    const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return r && r.value != null ? r.value : dflt;
  } catch (_) { return dflt; }
}

// ── Sheet furniture ────────────────────────────────────────────────────
// Identical to the finance workbook's, including the row count, because
// `HEADER_ROWS` is what tells the importer where the data starts.
function addHead(ws, schoolName, title, help, width) {
  const span = Math.max(width, 4);
  const merge = (r) => ws.mergeCells(r, 1, r, span);

  ws.getRow(1).height = 22;
  merge(1);
  const c1 = ws.getCell(1, 1);
  c1.value = String(schoolName || 'NICKLAND EDUSOFT').toUpperCase();
  c1.font = { bold: true, size: 14, color: { argb: BRAND.navy } };
  c1.alignment = { horizontal: 'center', vertical: 'middle' };

  merge(2);
  const c2 = ws.getCell(2, 1);
  c2.value = 'Onboarding workbook — fill this in and import it under Settings → Onboarding';
  c2.font = { size: 9, color: { argb: 'FF666666' } };
  c2.alignment = { horizontal: 'center' };

  merge(4);
  const c4 = ws.getCell(4, 1);
  c4.value = String(title).toUpperCase();
  c4.font = { bold: true, size: 11, color: { argb: BRAND.white } };
  c4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.navy } };
  c4.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(4).height = 18;

  merge(5);
  const c5 = ws.getCell(5, 1);
  c5.value = help;
  c5.font = { size: 9, italic: true, color: { argb: 'FF555555' } };
  c5.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  ws.getRow(5).height = 16;
}

// A required column is tinted and its header carries an asterisk. An office
// filling four hundred rows should be able to see what it may not leave blank
// without reading a paragraph first.
function styleHeaderRow(ws, columns) {
  const row = ws.getRow(S.HEADER_ROWS);
  row.height = 22;
  columns.forEach((col, i) => {
    const cell = row.getCell(i + 1);
    cell.value = col.required ? `${col.header} *` : col.header;
    cell.font = { bold: true, size: 9, color: { argb: BRAND.white } };
    cell.fill = { type: 'pattern', pattern: 'solid',
                  fgColor: { argb: col.required ? BRAND.gold : BRAND.navy } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: BRAND.navy } } };
    ws.getColumn(i + 1).width = col.w || 14;
    if (col.money) ws.getColumn(i + 1).numFmt = '#,##0.00';
    if (col.date) ws.getColumn(i + 1).numFmt = 'dd/mm/yyyy';
  });
  ws.views = [{ state: 'frozen', ySplit: S.HEADER_ROWS }];
  ws.autoFilter = {
    from: { row: S.HEADER_ROWS, column: 1 },
    to: { row: S.HEADER_ROWS, column: columns.length },
  };
}

// Excel's own validation, so a wrong value is refused at the point of typing
// rather than at the point of importing. It is not a substitute for the
// importer's checks — a pasted column bypasses validation entirely — but it
// catches the mistake while the person is still looking at the row.
function addValidation(ws, columns, lists, lastRow) {
  columns.forEach((col, i) => {
    const letter = ws.getColumn(i + 1).letter;
    let values = null;
    if (col.enum) values = col.enum;
    else if (col.bool) values = ['YES', 'NO'];
    else if (col.ref === SHEETS.CLASSES && lists.classes.length) values = lists.classes;
    else if (col.ref === SHEETS.TERMS && lists.terms.length) values = lists.terms;
    else if (col.ref === SHEETS.YEARS && lists.years.length) values = lists.years;
    if (!values || !values.length) return;

    // Excel refuses an inline list longer than 255 characters. A school with
    // forty classes would silently get no dropdown at all, so the list is
    // dropped rather than the sheet being corrupted — the importer still
    // checks the value either way.
    const formula = `"${values.join(',')}"`;
    if (formula.length > 255) return;
    for (let r = S.HEADER_ROWS + 1; r <= lastRow; r++) {
      ws.getCell(`${letter}${r}`).dataValidation = {
        type: 'list', allowBlank: !col.required, formulae: [formula],
        showErrorMessage: true, errorStyle: 'warning',
        errorTitle: col.header,
        error: `Choose one of: ${values.slice(0, 12).join(', ')}${values.length > 12 ? '…' : ''}`,
      };
    }
  });
}

function writeRow(ws, rowNo, columns, values, opts = {}) {
  const row = ws.getRow(rowNo);
  columns.forEach((col, i) => {
    let v = values[col.key];
    if (Array.isArray(v)) v = v.join(', ');
    if (col.bool) v = v === 1 || v === true ? 'YES' : (v === 0 || v === false ? 'NO' : '');
    const cell = row.getCell(i + 1);
    cell.value = v == null || v === '' ? null : v;
    cell.alignment = { vertical: 'middle', wrapText: false };
    if (opts.example) {
      cell.font = { italic: true, size: 9, color: { argb: BRAND.example } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.grey } };
    } else {
      cell.font = { size: 10 };
    }
    cell.border = {
      top: { style: 'hair', color: { argb: BRAND.border } },
      bottom: { style: 'hair', color: { argb: BRAND.border } },
      left: { style: 'hair', color: { argb: BRAND.border } },
      right: { style: 'hair', color: { argb: BRAND.border } },
    };
  });
  return row;
}

// ── Worked examples ────────────────────────────────────────────────────
// One or two per sheet, in the shapes a Ghanaian school actually uses. They
// are greyed, italic and marked EXAMPLE in their first text column, and the
// importer drops any row carrying that mark — so a school that types underneath
// them without deleting them gets exactly what it expected.
const EXAMPLES = {
  [SHEETS.YEARS]: [{ label: '2025/2026', start_date: '2025-09-01', end_date: '2026-07-31', is_current: 1 }],
  [SHEETS.TERMS]: [
    { year_label: '2025/2026', term_number: 1, label: 'First Term', start_date: '2025-09-01', end_date: '2025-12-19', is_current: 1 },
    { year_label: '2025/2026', term_number: 2, label: 'Second Term', start_date: '2026-01-12', end_date: '2026-04-10', is_current: 0 },
  ],
  [SHEETS.CLASSES]: [
    { name: 'KG 1', short_code: 'KG1', level_category: 'Kindergarten', level_order: 1, capacity: 30 },
    { name: 'Basic 5', short_code: 'B5', level_category: 'Primary', level_order: 7, capacity: 40 },
  ],
  [SHEETS.SUBJECTS]: [
    { name: 'English Language', code: 'ENG', class_weight_pct: 40, exam_weight_pct: 60 },
    { name: 'Mathematics', code: 'MAT', class_weight_pct: 40, exam_weight_pct: 60 },
  ],
  [SHEETS.CLASS_SUBJECTS]: [
    { class_name: 'Basic 5', subjects: 'English Language, Mathematics, Science, R.M.E' },
  ],
  [SHEETS.GRADING]: [
    { min_score: 80, max_score: 100, remark: 'Excellent' },
    { min_score: 70, max_score: 79, remark: 'Very Good' },
  ],
  [SHEETS.STAFF]: [
    { staff_number: '', surname: 'Mensah', first_name: 'Akua', gender: 'Female',
      date_of_birth: '1990-04-11', role: 'Class Teacher', phone: '0201234567',
      hire_date: '2021-09-01', base_salary: 1500, status: 'Active' },
  ],
  [SHEETS.STUDENTS]: [
    { index_number: '', surname: 'Owusu', first_name: 'Kofi', other_names: 'Mensah',
      gender: 'Male', date_of_birth: '2014-03-02', class_name: 'Basic 5',
      admission_date: '2021-09-06', status: 'Active',
      father_name: 'Yaw Owusu', father_contact: '0244000222' },
  ],
  [SHEETS.PARENTS]: [
    { full_name: 'Yaw Owusu', phone: '0244000222', email: '',
      children: 'AMS/2025/001, AMS/2025/014', relationship: 'Father' },
  ],
  [SHEETS.FEES]: [
    { class_name: 'Basic 5', term_label: 'First Term', part: 'A', item_name: 'Tuition', amount: 400, is_optional: 0 },
    { class_name: 'Basic 5', term_label: 'First Term', part: 'A', item_name: 'PTA Levy', amount: 20, is_optional: 0 },
  ],
  [SHEETS.BALANCES]: [
    { index_number: 'AMS/2025/001', student_name: 'Kofi Owusu', term_label: 'First Term',
      amount_owing: 340, notes: 'Carried from last term' },
  ],
};

// ── What the school already holds ──────────────────────────────────────
// Only reached when exporting a running school. Every reader returns rows in
// the sheet's own column shape, so the exporter never has to know what a term
// or a fee line is.
function liveRows(db, sheetName) {
  const q = (sql, p = []) => { try { return db.prepare(sql).all(...p); } catch (_) { return []; } };
  switch (sheetName) {
    case SHEETS.PROFILE:
      return S.PROFILE_ROWS.map(r => ({ setting: r.setting, value: getSetting(db, r.key, '') }));

    case SHEETS.YEARS:
      return q('SELECT label, start_date, end_date, is_current FROM academic_years ORDER BY label');

    case SHEETS.TERMS:
      return q(`SELECT y.label AS year_label, t.term_number, t.label, t.start_date, t.end_date, t.is_current
                  FROM terms t JOIN academic_years y ON y.id = t.academic_year_id
                 ORDER BY y.label, t.term_number`);

    case SHEETS.CLASSES:
      return q(`SELECT name, short_code, level_category, level_order, section, capacity
                  FROM class_groups WHERE COALESCE(is_active,1) = 1 ORDER BY level_order, name`);

    case SHEETS.SUBJECTS:
      return q(`SELECT name, code, class_weight_pct, exam_weight_pct
                  FROM subjects WHERE COALESCE(is_active,1) = 1 ORDER BY name`);

    case SHEETS.CLASS_SUBJECTS:
      return q(`SELECT c.name AS class_name, GROUP_CONCAT(s.name, ', ') AS subjects
                  FROM class_subjects cs
                  JOIN class_groups c ON c.id = cs.class_group_id
                  JOIN subjects s ON s.id = cs.subject_id
                 WHERE COALESCE(c.is_active,1) = 1 AND COALESCE(s.is_active,1) = 1
                 GROUP BY c.id ORDER BY c.level_order, c.name`);

    case SHEETS.GRADING:
      return q('SELECT min_score, max_score, remark FROM grading_bands ORDER BY min_score DESC');

    case SHEETS.STAFF:
      return q(`SELECT staff_number, surname, first_name, other_names, gender, date_of_birth,
                       role, phone, email, address, qualification, hire_date, base_salary,
                       ssnit_number, bank_name, bank_account, status
                  FROM staff ORDER BY surname, first_name`);

    case SHEETS.STUDENTS:
      // Every column the Students sheet declares, and no fewer. A field the
      // importer writes but the export omits comes back as an empty cell and
      // CLEARS it — so exporting a school to correct one phone number would
      // quietly wipe every pupil's allergies. The two lists have to match, and
      // `test/onboarding_workbook.js` now checks that they do rather than
      // trusting this query to be kept in step by hand.
      return q(`SELECT s.index_number, s.surname, s.first_name, s.other_names, s.gender,
                       s.date_of_birth, c.name AS class_name, s.admission_date, s.status,
                       s.denomination, s.place_of_birth, s.place_of_residence, s.digital_address,
                       s.father_name, s.father_contact, s.mother_name, s.mother_contact,
                       s.guardian_name, s.guardian_contact, s.previous_school, s.nhis_number,
                       s.blood_group, s.allergies, s.notes
                  FROM students s LEFT JOIN class_groups c ON c.id = s.current_class_id
                 ORDER BY c.level_order, s.surname, s.first_name`);

    case SHEETS.PARENTS:
      return q(`SELECT p.full_name, p.phone, p.email,
                       GROUP_CONCAT(s.index_number, ', ') AS children,
                       MIN(ps.relationship) AS relationship
                  FROM parents p
                  JOIN parent_students ps ON ps.parent_id = p.id
                  JOIN students s ON s.id = ps.student_id
                 GROUP BY p.id ORDER BY p.full_name`);

    case SHEETS.FEES:
      // The term is written year-qualified — "First Term 2025/2026", not
      // "First Term". Two academic years each have a First Term, and an
      // unqualified name resolves to whichever is current: a schedule exported
      // from last year would be re-imported onto this year's term. A school
      // typing a sheet by hand may still write the bare name and have it mean
      // the current year, which is what they mean; an export cannot afford the
      // guess, because it is describing a year it may not be in.
      return q(`SELECT c.name AS class_name,
                       t.label || ' ' || COALESCE(y.label, '') AS term_label,
                       li.category AS part,
                       li.description AS item_name, li.amount, li.is_optional
                  FROM fee_line_items li
                  JOIN fee_templates ft ON ft.id = li.fee_template_id
                  LEFT JOIN class_groups c ON c.id = ft.class_group_id
                  LEFT JOIN terms t ON t.id = ft.term_id
                  LEFT JOIN academic_years y ON y.id = t.academic_year_id
                 WHERE COALESCE(ft.is_active,1) = 1 AND c.name IS NOT NULL AND t.label IS NOT NULL
                 ORDER BY c.level_order, t.term_number, li.item_number`)
        .map(r => ({ ...r, part: String(r.part || '').replace(/^Part\s+/i, '') }));

    case SHEETS.BALANCES:
      // ONLY the opening-balance line, never the bill's balance.
      //
      // They are not the same figure and confusing them compounds. A pupil with
      // an ordinary unpaid GHS 400 tuition bill has a balance of 400 and an
      // opening balance of nothing; exporting the balance and re-importing it
      // adds 400 of arrears on top of the 400 already billed, and the child owes
      // 800. Import the file a third time and it is 1200.
      //
      // What this sheet means is "what the pupil owed on the day the school
      // moved onto this system" — a position stated once, which is exactly the
      // line `applyOpeningBalance` writes and the only line it should read back.
      // Everything else on the bill is the system's own working.
      return q(`SELECT s.index_number,
                       TRIM(s.surname || ' ' || s.first_name) AS student_name,
                       t.label || ' ' || COALESCE(y.label, '') AS term_label,
                       li.amount AS amount_owing
                  FROM bill_line_items li
                  JOIN student_bills b ON b.id = li.student_bill_id
                  JOIN students s ON s.id = b.student_id
                  JOIN terms t ON t.id = b.term_id
                  LEFT JOIN academic_years y ON y.id = t.academic_year_id
                 WHERE li.description = ? AND li.amount > 0 AND s.index_number IS NOT NULL
                 ORDER BY s.surname, s.first_name`, [OPENING_BALANCE_LABEL]);

    default: return [];
  }
}

// ── The cover ──────────────────────────────────────────────────────────
// The first thing anybody opens, and the only page that explains the rest. It
// says what to do in the order it has to be done, because the sheets depend on
// each other and a school that fills in Students first will have to do it twice.
function buildCover(wb, schoolName, filled) {
  const ws = wb.addWorksheet(SHEETS.COVER, { properties: { tabColor: { argb: BRAND.gold } } });
  ws.getColumn(1).width = 4;
  ws.getColumn(2).width = 30;
  ws.getColumn(3).width = 78;

  ws.mergeCells(1, 1, 1, 3);
  const t = ws.getCell(1, 1);
  t.value = String(schoolName || 'NICKLAND EDUSOFT').toUpperCase();
  t.font = { bold: true, size: 18, color: { argb: BRAND.navy } };
  t.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 30;

  ws.mergeCells(2, 1, 2, 3);
  const s = ws.getCell(2, 1);
  s.value = filled
    ? 'Onboarding workbook — everything the system currently holds'
    : 'Onboarding workbook — fill this in to bring the school onto the system';
  s.font = { size: 11, italic: true, color: { argb: 'FF555555' } };
  s.alignment = { horizontal: 'center' };

  let r = 4;
  const say = (text, opts = {}) => {
    ws.mergeCells(r, opts.indent ? 2 : 1, r, 3);
    const c = ws.getCell(r, opts.indent ? 2 : 1);
    c.value = text;
    c.font = { size: opts.head ? 12 : 10, bold: !!opts.head,
               color: { argb: opts.head ? BRAND.navy : 'FF333333' } };
    c.alignment = { vertical: 'middle', wrapText: true };
    if (opts.head) { ws.getRow(r).height = 22; }
    r++;
  };

  say('How to use this workbook', { head: true });
  say('');
  say('1.  Work through the tabs in the order they appear. They depend on each other: a pupil cannot be put');
  say('     in a class that has not been listed yet, and a fee schedule cannot be attached to a term that does not exist.');
  say('2.  Columns with a gold heading and a * must be filled in. The rest can be left blank.');
  say('3.  The grey italic rows marked EXAMPLE show what each column expects. Type underneath them —');
  say('     you can delete them or leave them, the system ignores them either way.');
  say('4.  Where a column refers to something on another tab — a class, a term, a subject — spell it');
  say('     exactly as you spelt it there. The system will tell you which row is wrong if you do not.');
  say('5.  Save the file, then in Nickland Edusoft go to Settings → Onboarding and choose Preview.');
  say('     Nothing is written until you have seen what it would do and pressed Import.');
  say('');
  say('You can import the same file more than once', { head: true });
  say('');
  say('Importing again corrects what is already there rather than creating it twice. So the usual way to');
  say('work is: import, look at the result in the system, fix whatever is wrong in this file, import again.');
  say('');
  say('The one figure to be careful with is Opening Balances. That column is what a pupil OWED on the day');
  say('you moved onto the system — a position, not a payment. Importing twice does not double it.');
  say('');
  say('The tabs, in order', { head: true });
  say('');

  const hr = ws.getRow(r);
  ['', 'Tab', 'What goes on it'].forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, size: 10, color: { argb: BRAND.white } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.navy } };
  });
  r++;
  for (const name of SHEET_ORDER) {
    const def = IMPORT_SHEETS[name];
    const row = ws.getRow(r);
    row.getCell(2).value = name;
    row.getCell(2).font = { bold: true, size: 10 };
    row.getCell(3).value = def.help;
    row.getCell(3).alignment = { wrapText: true, vertical: 'middle' };
    row.getCell(3).font = { size: 9, color: { argb: 'FF555555' } };
    row.height = 26;
    r++;
  }
  return ws;
}

// ── Reference data ─────────────────────────────────────────────────────
// The lists the dropdowns are drawn from, written out so a school can see them
// even where the list was too long for Excel to attach to the cell.
function buildReference(wb, lists) {
  const ws = wb.addWorksheet(SHEETS.REFERENCE, { properties: { tabColor: { argb: BRAND.navy } } });
  addHead(ws, 'Reference', 'Reference data', 
    'The values the other tabs expect. Spell them exactly as they appear here.', 5);
  const cols = [
    { header: 'Classes', values: lists.classes, w: 24 },
    { header: 'Terms', values: lists.terms, w: 26 },
    { header: 'Academic Years', values: lists.years, w: 18 },
    { header: 'Subjects', values: lists.subjects, w: 26 },
    { header: 'Levels', values: lists.levels, w: 18 },
  ];
  const head = ws.getRow(S.HEADER_ROWS);
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, size: 9, color: { argb: BRAND.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.navy } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getColumn(i + 1).width = c.w;
    c.values.forEach((v, j) => {
      const cc = ws.getCell(S.HEADER_ROWS + 1 + j, i + 1);
      cc.value = v;
      cc.font = { size: 9 };
    });
  });
  ws.views = [{ state: 'frozen', ySplit: S.HEADER_ROWS }];
  return ws;
}

// ── The builder ────────────────────────────────────────────────────────
/**
 * Build the onboarding workbook.
 *
 *   filled: false  a blank template with worked examples (a new school)
 *   filled: true   the same workbook carrying what the system holds
 *
 * `db` may be null when building a blank template for a school that has no
 * database yet — which is the whole point of handing one out before onboarding.
 */
async function buildWorkbook(db, destPath, options = {}) {
  const filled = !!options.filled;
  const Excel = ExcelJS();
  const wb = new Excel.Workbook();
  wb.creator = 'Nickland Edusoft';
  wb.created = new Date();

  const schoolName = db ? getSetting(db, 'school_name', 'Nickland Edusoft') : 'Nickland Edusoft';

  // What the dropdowns offer. Drawn from the system where there is one, and
  // from the examples where there is not, so a blank template still guides.
  const pick = (rows, key) => rows.map(r => r[key]).filter(Boolean);
  const lists = {
    classes: db ? pick(liveRows(db, SHEETS.CLASSES), 'name') : [],
    subjects: db ? pick(liveRows(db, SHEETS.SUBJECTS), 'name') : [],
    years: db ? pick(liveRows(db, SHEETS.YEARS), 'label') : [],
    terms: db ? liveRows(db, SHEETS.TERMS).map(t => `${t.label} ${t.year_label}`) : [],
    levels: ['Creche', 'Nursery', 'Kindergarten', 'Primary', 'JHS'],
  };
  // A term is referred to by its bare name too, and the office will type that.
  if (db) lists.terms = [...new Set([...lists.terms, ...pick(liveRows(db, SHEETS.TERMS), 'label')])];

  buildCover(wb, schoolName, filled);

  const counts = {};
  for (const sheetName of SHEET_ORDER) {
    const def = IMPORT_SHEETS[sheetName];
    const ws = wb.addWorksheet(sheetName, {
      properties: { tabColor: { argb: BRAND.light } },
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    addHead(ws, schoolName, def.title, def.help, def.columns.length);
    styleHeaderRow(ws, def.columns);

    let r = S.HEADER_ROWS + 1;

    // The School Profile sheet is a fixed list of questions, so its rows are
    // written whether or not there is a school to read them from.
    const data = (filled && db) ? liveRows(db, sheetName)
               : (sheetName === SHEETS.PROFILE ? S.PROFILE_ROWS.map(x => ({ setting: x.setting, value: '' })) : []);

    for (const row of data) { writeRow(ws, r++, def.columns, row); }
    counts[sheetName] = data.length;

    // Examples go BELOW real data rather than instead of it, so a filled
    // workbook still shows the shape of a new row.
    if (sheetName !== SHEETS.PROFILE) {
      for (const ex of (EXAMPLES[sheetName] || [])) {
        const firstText = def.columns.find(c => !c.date && !c.money && !c.bool && !c.int && !c.num);
        const marked = { ...ex };
        if (firstText && !marked[firstText.key]) marked[firstText.key] = EXAMPLE_MARK;
        writeRow(ws, r, def.columns, marked, { example: true });
        // The mark has to be findable by the importer whatever the sheet's
        // shape, so it goes in a cell of its own beyond the last column.
        ws.getCell(r, def.columns.length + 2).value = EXAMPLE_MARK;
        ws.getCell(r, def.columns.length + 2).font = { size: 8, color: { argb: BRAND.example } };
        r++;
      }
    }

    // Room to type, and validation reaching well past the last written row.
    addValidation(ws, def.columns, lists, r + 400);
  }

  buildReference(wb, lists);

  await wb.xlsx.writeFile(destPath);
  return { ok: true, path: destPath, filled, sheets: SHEET_ORDER.length, counts };
}

module.exports = { buildWorkbook, liveRows, EXAMPLES, EXAMPLE_MARK, BRAND };
