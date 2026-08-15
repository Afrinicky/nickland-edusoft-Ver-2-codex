// Nickland Edusoft — Finance workbook: export.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Builds the one workbook that holds everything to do with money — fees,
// canteen, books, transport, other income, expenses and payroll — so a school
// whose computer has died can keep trading in Excel and import the result back.
//
// The layout deliberately follows the ledger the school already used (fee
// schedule matrix, student ledger, arrears register, enrolment summary), so it
// is familiar, and fills in what that workbook could not do: the canteen sheet
// that was always empty, payroll, expenses, and every other income stream.

const schema = require('./_workbook_schema');
const { SHEETS, ENTRY_SHEETS, STATUS } = schema;

// exceljs is lazily required so this module loads in the plain-Node test
// harness, which has no node_modules.
function ExcelJS() { return require('exceljs'); }

const BRAND = {
  navy: 'FF1B3A6B',
  gold: 'FFC9961A',
  light: 'FFEEF3FA',
  grey: 'FFF5F5F5',
  green: 'FFE8F5E9',
  amber: 'FFFFF8E1',
  white: 'FFFFFFFF',
  border: 'FFD9D9D9',
};

function getSetting(db, key, dflt = '') {
  try {
    const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return r && r.value != null ? r.value : dflt;
  } catch (_) { return dflt; }
}

function schoolInfo(db) {
  return {
    name: getSetting(db, 'school_name', 'School'),
    motto: getSetting(db, 'school_motto', ''),
    address: getSetting(db, 'school_address', ''),
    phone: getSetting(db, 'school_phone_1', ''),
    email: getSetting(db, 'school_email', ''),
  };
}

function currentTerm(db, termId) {
  const t = termId
    ? db.prepare('SELECT * FROM terms WHERE id = ?').get(termId)
    : db.prepare('SELECT * FROM terms WHERE is_current = 1').get();
  if (!t) return null;
  const y = t.academic_year_id
    ? db.prepare('SELECT label FROM academic_years WHERE id = ?').get(t.academic_year_id)
    : null;
  return { ...t, year_label: y ? y.label : '' };
}

// ── Sheet furniture ────────────────────────────────────────────────────
// Every sheet gets the same head: school name, term, sheet title, one line of
// plain-language help, then the column headers. The row count is fixed
// (schema.HEADER_ROWS) so the importer knows where data starts.
function addHead(ws, school, term, title, help, width) {
  const span = Math.max(width, 4);
  const merge = (r) => ws.mergeCells(r, 1, r, span);

  ws.getRow(1).height = 22;
  merge(1);
  const c1 = ws.getCell(1, 1);
  c1.value = school.name.toUpperCase();
  c1.font = { bold: true, size: 14, color: { argb: BRAND.navy } };
  c1.alignment = { horizontal: 'center', vertical: 'middle' };

  merge(2);
  const c2 = ws.getCell(2, 1);
  c2.value = [school.address, term ? `${term.label} — ${term.year_label}` : '']
    .filter(Boolean).join('   ·   ');
  c2.font = { size: 9, color: { argb: 'FF666666' } };
  c2.alignment = { horizontal: 'center' };

  merge(4);
  const c4 = ws.getCell(4, 1);
  c4.value = title.toUpperCase();
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

function styleHeaderRow(ws, rowNo, count) {
  const row = ws.getRow(rowNo);
  row.height = 20;
  for (let c = 1; c <= count; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, size: 9, color: { argb: BRAND.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.navy } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: BRAND.navy } } };
  }
}

function applyFormats(ws, columns, fromRow, toRow) {
  columns.forEach((col, i) => {
    const c = i + 1;
    ws.getColumn(c).width = col.w || 14;
    if (col.money) ws.getColumn(c).numFmt = '#,##0.00';
    if (col.date) ws.getColumn(c).numFmt = 'dd/mm/yyyy';
  });
  for (let r = fromRow; r <= toRow; r++) {
    for (let c = 1; c <= columns.length; c++) {
      ws.getCell(r, c).border = {
        top: { style: 'hair', color: { argb: BRAND.border } },
        bottom: { style: 'hair', color: { argb: BRAND.border } },
      };
    }
  }
}

// ── Entry sheets ───────────────────────────────────────────────────────
// Existing rows are written as SYNCED (grey, ignored on import). Below them sit
// blank rows shaded green — the only place the school types. Getting that
// distinction visually obvious is what stops somebody editing a synced row and
// expecting it to change the system.
function buildEntrySheet(wb, db, school, term, sheetName, existingRows, opts) {
  const def = ENTRY_SHEETS[sheetName];
  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: schema.HEADER_ROWS }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  addHead(ws, school, term, def.title, def.help, def.columns.length);

  const headerRow = ws.getRow(schema.HEADER_ROWS);
  def.columns.forEach((col, i) => { headerRow.getCell(i + 1).value = col.header; });
  styleHeaderRow(ws, schema.HEADER_ROWS, def.columns.length);

  let r = schema.HEADER_ROWS + 1;
  for (const row of existingRows) {
    def.columns.forEach((col, i) => {
      const cell = ws.getCell(r, i + 1);
      if (col.key === 'status') cell.value = STATUS.SYNCED;
      else if (col.key === 'entry_ref') cell.value = row.entry_ref || '';
      else if (col.date) cell.value = row[col.key] ? new Date(row[col.key] + 'T00:00:00Z') : null;
      else cell.value = row[col.key] != null ? row[col.key] : '';
      cell.font = { size: 9, color: { argb: 'FF777777' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.grey } };
    });
    r++;
  }

  const firstBlank = r;
  const blanks = opts.blankRows || 200;
  for (let i = 0; i < blanks; i++) {
    def.columns.forEach((col, ci) => {
      const cell = ws.getCell(r, ci + 1);
      if (col.key === 'status') cell.value = STATUS.NEW;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.green } };
      cell.font = { size: 10 };
      if (col.date) cell.numFmt = 'dd/mm/yyyy';
      if (col.money) cell.numFmt = '#,##0.00';
    });
    r++;
  }

  applyFormats(ws, def.columns, schema.HEADER_ROWS + 1, r - 1);

  // Dropdowns keep the free-text columns to values the importer understands.
  const colIndex = (key) => def.columns.findIndex(c => c.key === key) + 1;
  const addList = (key, list) => {
    const ci = colIndex(key);
    if (ci <= 0) return;
    const letter = ws.getColumn(ci).letter;
    for (let rr = firstBlank; rr < r; rr++) {
      ws.getCell(`${letter}${rr}`).dataValidation = {
        type: 'list', allowBlank: true, formulae: [`"${list.join(',')}"`],
      };
    }
  };
  addList('payment_method', ['Cash', 'Mobile Money', 'Bank', 'Cheque']);
  if (def.target === 'income') addList('category', opts.incomeCategories || []);
  if (def.target === 'expense') addList('category', opts.expenseCategories || []);

  ws.autoFilter = {
    from: { row: schema.HEADER_ROWS, column: 1 },
    to: { row: schema.HEADER_ROWS, column: def.columns.length },
  };
  return ws;
}

// ── Read-only ledger sheets ────────────────────────────────────────────
function buildTableSheet(wb, school, term, name, title, help, columns, rows, opts = {}) {
  const ws = wb.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: schema.HEADER_ROWS }],
    pageSetup: { paperSize: 9, orientation: opts.orientation || 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  addHead(ws, school, term, title, help, columns.length);
  const headerRow = ws.getRow(schema.HEADER_ROWS);
  columns.forEach((col, i) => { headerRow.getCell(i + 1).value = col.header; });
  styleHeaderRow(ws, schema.HEADER_ROWS, columns.length);

  let r = schema.HEADER_ROWS + 1;
  for (const row of rows) {
    columns.forEach((col, i) => {
      const cell = ws.getCell(r, i + 1);
      const v = row[col.key];
      cell.value = col.date && v ? new Date(String(v).slice(0, 10) + 'T00:00:00Z') : (v != null ? v : '');
      cell.font = { size: 9.5 };
      if (row.__emphasis) {
        cell.font = { size: 9.5, bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.light } };
      }
    });
    r++;
  }
  applyFormats(ws, columns, schema.HEADER_ROWS + 1, Math.max(r - 1, schema.HEADER_ROWS + 1));
  if (rows.length) {
    ws.autoFilter = {
      from: { row: schema.HEADER_ROWS, column: 1 },
      to: { row: schema.HEADER_ROWS, column: columns.length },
    };
  }
  return ws;
}

// ── Data gathering ─────────────────────────────────────────────────────
function activeStudents(db) {
  return db.prepare(`
    SELECT s.id, s.index_number, s.surname, s.first_name, s.other_names, s.gender,
           c.name AS class_name, c.level_order
    FROM students s LEFT JOIN class_groups c ON c.id = s.current_class_id
    WHERE s.status = 'Active'
    ORDER BY c.level_order, s.surname, s.first_name
  `).all();
}

function fullName(s) {
  return [s.surname, s.first_name, s.other_names].filter(Boolean).join(' ');
}

// ── The workbook ───────────────────────────────────────────────────────
async function buildWorkbook(db, outPath, options = {}) {
  const Excel = ExcelJS();
  const wb = new Excel.Workbook();
  const school = schoolInfo(db);
  const term = currentTerm(db, options.termId);
  wb.creator = 'Nickland Edusoft';
  wb.created = new Date();

  const termId = term ? term.id : null;
  const students = activeStudents(db);
  const byIndex = new Map(students.map(s => [s.index_number, s]));

  const opts = {
    blankRows: options.blankRows || 200,
    incomeCategories: ['fees', 'canteen', 'books', 'transport', 'donation', 'pta', 'hall_hire', 'sales', 'other'],
    expenseCategories: ['supplies', 'utilities', 'maintenance', 'construction', 'transport',
                        'canteen_supplies', 'salary', 'rent', 'stationery', 'medical', 'other'],
  };

  // ── 1. Start Here ────────────────────────────────────────────────────
  buildCover(wb, school, term, opts);

  // ── 2. Fee Schedule (line items × classes, as the school's own ledger) ─
  buildFeeSchedule(wb, db, school, term, termId);

  // ── 3. Student Ledger ────────────────────────────────────────────────
  const ledgerRows = students.map(s => {
    const bill = termId ? db.prepare(`
      SELECT total_billed, total_paid, balance, arrears_from_prev, discount_amount
      FROM student_bills WHERE student_id = ? AND term_id = ?
        AND COALESCE(status, 'active') = 'active'
    `).get(s.id, termId) : null;
    const billed = bill ? bill.total_billed : 0;
    const paid = bill ? bill.total_paid : 0;
    return {
      index_number: s.index_number,
      surname: s.surname, first_name: s.first_name, other_names: s.other_names || '',
      class_name: s.class_name || '', gender: s.gender || '',
      term_label: term ? term.label : '',
      fees_due: round2(billed - (bill ? bill.arrears_from_prev || 0 : 0)),
      discount: bill ? round2(bill.discount_amount) : 0,
      arrears: bill ? round2(bill.arrears_from_prev) : 0,
      net_due: round2(billed),
      total_paid: round2(paid),
      balance: round2(bill ? bill.balance : 0),
      status: !bill ? 'NOT BILLED' : (bill.balance <= 0 ? 'FULLY PAID' : (paid > 0 ? 'PART PAID' : 'UNPAID')),
    };
  });
  buildTableSheet(wb, school, term, SHEETS.STUDENT_LEDGER,
    'Student ledger', 'What each pupil owes this term. Read-only — record new payments on the Fee Payments sheet.',
    [
      { key: 'index_number', header: 'Index No', w: 16 },
      { key: 'surname', header: 'Surname', w: 18 },
      { key: 'first_name', header: 'First Name', w: 16 },
      { key: 'other_names', header: 'Other Names', w: 16 },
      { key: 'class_name', header: 'Class', w: 14 },
      { key: 'gender', header: 'Gender', w: 8 },
      { key: 'term_label', header: 'Term', w: 12 },
      { key: 'fees_due', header: 'Fees Due (GHS)', w: 14, money: true },
      { key: 'discount', header: 'Discount (GHS)', w: 14, money: true },
      { key: 'arrears', header: 'Arrears (GHS)', w: 13, money: true },
      { key: 'net_due', header: 'Net Due (GHS)', w: 14, money: true },
      { key: 'total_paid', header: 'Total Paid (GHS)', w: 15, money: true },
      { key: 'balance', header: 'Balance (GHS)', w: 14, money: true },
      { key: 'status', header: 'Status', w: 14 },
    ], ledgerRows);

  // ── 4-9. Entry sheets ────────────────────────────────────────────────
  buildEntrySheet(wb, db, school, term, SHEETS.FEE_PAYMENTS, existingFeePayments(db, termId), opts);
  buildCanteenLedger(wb, db, school, term, termId, students);
  buildEntrySheet(wb, db, school, term, SHEETS.CANTEEN_PAYMENTS, existingCanteenPayments(db, termId), opts);
  buildEntrySheet(wb, db, school, term, SHEETS.BOOKS_PAYMENTS, existingBooksPayments(db), opts);
  buildEntrySheet(wb, db, school, term, SHEETS.TRANSPORT, existingTransportPayments(db, termId), opts);
  buildEntrySheet(wb, db, school, term, SHEETS.OTHER_INCOME, existingOtherIncome(db, termId), opts);
  buildEntrySheet(wb, db, school, term, SHEETS.EXPENSES, existingExpenses(db, termId), opts);
  buildEntrySheet(wb, db, school, term, SHEETS.PAYROLL, existingPayroll(db), opts);

  // ── 10. Arrears register ─────────────────────────────────────────────
  buildTableSheet(wb, school, term, SHEETS.ARREARS,
    'Arrears register', 'Pupils still owing this term, largest balance first. Chase list for the finance office.',
    [
      { key: 'index_number', header: 'Index No', w: 16 },
      { key: 'name', header: 'Student', w: 28 },
      { key: 'class_name', header: 'Class', w: 14 },
      { key: 'net_due', header: 'Net Due (GHS)', w: 14, money: true },
      { key: 'total_paid', header: 'Paid (GHS)', w: 14, money: true },
      { key: 'balance', header: 'Balance (GHS)', w: 14, money: true },
      { key: 'contact', header: 'Parent Contact', w: 18 },
      { key: 'remarks', header: 'Follow-up / Remarks', w: 30 },
    ], arrearsRows(db, termId));

  // ── 11. Finance summary ──────────────────────────────────────────────
  buildSummary(wb, db, school, term, termId, ledgerRows);

  // ── 12. Reference data ───────────────────────────────────────────────
  buildReference(wb, db, school, term, students, opts);

  await wb.xlsx.writeFile(outPath);
  return {
    ok: true,
    path: outPath,
    term: term ? { id: term.id, label: term.label } : null,
    students: students.length,
    sheets: wb.worksheets.map(w => w.name),
  };
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function buildCover(wb, school, term, opts) {
  const ws = wb.addWorksheet(SHEETS.COVER, { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 4;
  ws.getColumn(2).width = 104;

  const line = (r, text, style = {}) => {
    const c = ws.getCell(r, 2);
    c.value = text;
    c.font = { size: 10, ...style };
    c.alignment = { vertical: 'middle', wrapText: true };
    return c;
  };

  ws.mergeCells(2, 2, 2, 2);
  line(2, school.name.toUpperCase(), { bold: true, size: 16, color: { argb: BRAND.navy } });
  line(3, [school.address, school.phone, school.email].filter(Boolean).join('  ·  '),
    { size: 9, color: { argb: 'FF666666' } });

  const banner = ws.getCell(5, 2);
  banner.value = 'FINANCE WORKBOOK — OFFLINE CONTINUITY';
  banner.font = { bold: true, size: 12, color: { argb: BRAND.white } };
  banner.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.navy } };
  banner.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(5).height = 24;

  line(7, term ? `${term.label} — ${term.year_label}` : 'No current term set', { bold: true, size: 11 });
  line(8, `Generated ${new Date().toLocaleString()}`, { size: 9, color: { argb: 'FF666666' } });

  line(10, 'WHAT THIS IS', { bold: true, size: 11, color: { argb: BRAND.navy } });
  line(11, 'One workbook holding everything to do with money: fees, canteen, books, transport, ' +
           'other income, expenses and payroll. If the computer running Nickland Edusoft is down, ' +
           'keep working in this file. When the system is back, import it and nothing is lost.');

  line(13, 'HOW TO USE IT', { bold: true, size: 11, color: { argb: BRAND.navy } });
  const steps = [
    '1.  Grey rows marked SYNCED are already in the system. Do not edit them — changes there are ignored.',
    '2.  Type new entries on the GREEN rows of the sheets named "… Payments", "Other Income", "Expenses" and "Payroll".',
    '3.  Index No must match the pupil exactly. Copy it from the Student Ledger or Reference Data sheet.',
    '4.  Leave Entry Ref blank. The system fills it in and uses it to make sure nothing is imported twice.',
    '5.  Save the file. In Nickland Edusoft go to Finance → Workbook → Import, and choose it.',
    '6.  Preview first: the import shows exactly what it will add before anything is written.',
  ];
  steps.forEach((s, i) => line(15 + i, s));

  line(23, 'SAFE TO IMPORT TWICE', { bold: true, size: 11, color: { argb: BRAND.navy } });
  line(24, 'Every row carries a fingerprint of its own contents. Importing the same workbook again — ' +
           'or a second copy that overlaps the first — skips anything already brought in. ' +
           'It is never possible to record the same payment twice by importing.');

  line(26, 'READ-ONLY SHEETS', { bold: true, size: 11, color: { argb: BRAND.navy } });
  line(27, `${SHEETS.FEE_SCHEDULE}, ${SHEETS.STUDENT_LEDGER}, ${SHEETS.CANTEEN}, ${SHEETS.ARREARS}, ` +
           `${SHEETS.SUMMARY} and ${SHEETS.REFERENCE} are pictures of the system as at the moment this ` +
           `file was made. They are there so you can see who owes what while offline.`);

  for (let r = 1; r <= 28; r++) ws.getRow(r).height = ws.getRow(r).height || 15;
  ws.getRow(11).height = 30;
  ws.getRow(24).height = 30;
  ws.getRow(27).height = 30;
}

function buildFeeSchedule(wb, db, school, term, termId) {
  const classes = db.prepare('SELECT id, name FROM class_groups WHERE is_active = 1 ORDER BY level_order').all();
  const billing = require('./_billing');

  // The fee schedule is the matrix the school is used to: one row per line item,
  // one column per class, resolved through the same template rules bill
  // generation uses so the printed schedule matches what pupils are billed.
  const perClass = classes.map(c => {
    const tpl = termId ? billing.resolveFeeTemplate(db, c.id, termId) : null;
    return { c, items: tpl ? billing.templateItems(db, tpl.id) : [], tplName: tpl ? tpl.name : null };
  });
  const descriptions = [];
  for (const pc of perClass) {
    for (const it of pc.items) {
      const d = String(it.description || '').trim();
      if (d && !descriptions.includes(d)) descriptions.push(d);
    }
  }

  const columns = [
    { key: 'description', header: 'Fee Description', w: 32 },
    ...classes.map(c => ({ key: 'c' + c.id, header: c.name, w: 12, money: true })),
  ];
  const rows = descriptions.map(d => {
    const row = { description: d };
    perClass.forEach(pc => {
      const hit = pc.items.find(i => String(i.description || '').trim() === d);
      row['c' + pc.c.id] = hit ? round2(hit.amount) : 0;
    });
    return row;
  });
  const total = { description: 'COMPULSORY TOTAL', __emphasis: true };
  perClass.forEach(pc => {
    total['c' + pc.c.id] = round2(pc.items.reduce((s, i) => s + (i.amount || 0), 0));
  });
  rows.push(total);

  buildTableSheet(wb, school, term, SHEETS.FEE_SCHEDULE,
    'Fee schedule', 'What each class is billed this term, per line item. Set in Nickland Edusoft under Fees → Bills → Fee Templates.',
    columns, rows);
}

function buildCanteenLedger(wb, db, school, term, termId, students) {
  // The sheet that was empty in the school's own workbook. Per-pupil canteen
  // position for the term: school days, days paid, days owing, money in.
  const rate = parseFloat(getSetting(db, 'canteen_daily_rate', '5')) || 0;
  const schoolDays = termId ? (db.prepare(
    "SELECT COUNT(*) n FROM school_calendar WHERE term_id = ? AND day_type = 'school_day'"
  ).get(termId).n || 0) : 0;

  const rows = students.map(s => {
    const paidDays = termId ? (db.prepare(`
      SELECT COUNT(*) n FROM canteen_day_status cds
      JOIN school_calendar sc ON sc.date = cds.date
      WHERE cds.student_id = ? AND sc.term_id = ? AND cds.status = 'paid'
    `).get(s.id, termId).n || 0) : 0;
    const exemptDays = termId ? (db.prepare(`
      SELECT COUNT(*) n FROM canteen_day_status cds
      JOIN school_calendar sc ON sc.date = cds.date
      WHERE cds.student_id = ? AND sc.term_id = ? AND cds.status = 'exempt'
    `).get(s.id, termId).n || 0) : 0;
    const collected = termId ? (db.prepare(
      'SELECT COALESCE(SUM(amount),0) t FROM canteen_payments WHERE student_id = ? AND term_id = ?'
    ).get(s.id, termId).t || 0) : 0;
    const owingDays = Math.max(0, schoolDays - paidDays - exemptDays);
    return {
      index_number: s.index_number,
      name: fullName(s),
      class_name: s.class_name || '',
      school_days: schoolDays,
      days_paid: paidDays,
      days_exempt: exemptDays,
      days_owing: owingDays,
      collected: round2(collected),
      owing: round2(owingDays * rate),
    };
  });

  buildTableSheet(wb, school, term, SHEETS.CANTEEN,
    'Canteen ledger',
    `Canteen position per pupil for the term at GHS ${rate.toFixed(2)} per day. Read-only — record collection on the Canteen Payments sheet.`,
    [
      { key: 'index_number', header: 'Index No', w: 16 },
      { key: 'name', header: 'Student', w: 28 },
      { key: 'class_name', header: 'Class', w: 14 },
      { key: 'school_days', header: 'School Days', w: 12 },
      { key: 'days_paid', header: 'Days Paid', w: 11 },
      { key: 'days_exempt', header: 'Days Exempt', w: 12 },
      { key: 'days_owing', header: 'Days Owing', w: 12 },
      { key: 'collected', header: 'Collected (GHS)', w: 15, money: true },
      { key: 'owing', header: 'Owing (GHS)', w: 14, money: true },
    ], rows);
}

// ── Existing-row loaders (exported as SYNCED) ──────────────────────────
function existingFeePayments(db, termId) {
  return db.prepare(`
    SELECT p.receipt_number, p.payment_date, p.amount, p.payment_method, p.reference, p.notes,
           s.index_number, s.surname, s.first_name, s.other_names, c.name AS class_name
    FROM payments p
    JOIN students s ON s.id = p.student_id
    LEFT JOIN class_groups c ON c.id = s.current_class_id
    WHERE COALESCE(p.is_reversed, 0) = 0 AND (? IS NULL OR p.term_id = ?)
    ORDER BY p.payment_date, p.id
  `).all(termId, termId).map(r => ({
    entry_ref: r.receipt_number,
    receipt_number: r.receipt_number,
    payment_date: r.payment_date,
    index_number: r.index_number,
    student_name: [r.surname, r.first_name, r.other_names].filter(Boolean).join(' '),
    class_name: r.class_name || '',
    amount: round2(r.amount),
    payment_method: r.payment_method || 'Cash',
    reference: r.reference || '',
    notes: r.notes || '',
  }));
}

function existingCanteenPayments(db, termId) {
  return db.prepare(`
    SELECT cp.payment_date, cp.amount, cp.days_covered, cp.notes,
           s.index_number, s.surname, s.first_name, c.name AS class_name
    FROM canteen_payments cp
    JOIN students s ON s.id = cp.student_id
    LEFT JOIN class_groups c ON c.id = s.current_class_id
    WHERE (? IS NULL OR cp.term_id = ?)
    ORDER BY cp.payment_date, cp.id
  `).all(termId, termId).map(r => ({
    entry_ref: '',
    payment_date: r.payment_date,
    index_number: r.index_number,
    student_name: `${r.surname} ${r.first_name}`.trim(),
    class_name: r.class_name || '',
    amount: round2(r.amount),
    days_covered: r.days_covered || '',
    payment_method: 'Cash',
    notes: r.notes || '',
  }));
}

function existingBooksPayments(db) {
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT bp.receipt_number, bp.payment_date, bp.amount, bp.payment_method, bp.notes,
             s.index_number, s.surname, s.first_name, c.name AS class_name
      FROM books_payments bp
      JOIN students s ON s.id = bp.student_id
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      WHERE COALESCE(bp.is_reversed, 0) = 0
      ORDER BY bp.payment_date, bp.id
    `).all();
  } catch (_) { /* table absent on an old database */ }
  return rows.map(r => ({
    entry_ref: r.receipt_number,
    receipt_number: r.receipt_number,
    payment_date: r.payment_date,
    index_number: r.index_number,
    student_name: `${r.surname} ${r.first_name}`.trim(),
    class_name: r.class_name || '',
    amount: round2(r.amount),
    payment_method: r.payment_method || 'Cash',
    notes: r.notes || '',
  }));
}

function existingTransportPayments(db, termId) {
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT tp.receipt_number, tp.payment_date, tp.amount, tp.payment_method, tp.notes,
             s.index_number, s.surname, s.first_name, tr.name AS route_name
      FROM transport_payments tp
      JOIN students s ON s.id = tp.student_id
      LEFT JOIN transport_routes tr ON tr.id = tp.route_id
      WHERE (? IS NULL OR tp.term_id = ?)
      ORDER BY tp.payment_date, tp.id
    `).all(termId, termId);
  } catch (_) { /* transport tables absent */ }
  return rows.map(r => ({
    entry_ref: r.receipt_number,
    receipt_number: r.receipt_number,
    payment_date: r.payment_date,
    index_number: r.index_number,
    student_name: `${r.surname} ${r.first_name}`.trim(),
    route_name: r.route_name || '',
    amount: round2(r.amount),
    payment_method: r.payment_method || 'Cash',
    notes: r.notes || '',
  }));
}

// Money that came in through fees/canteen/books/transport already appears on its
// own sheet, so listing it here too would read as double the income.
function existingOtherIncome(db, termId) {
  return db.prepare(`
    SELECT receipt_number, COALESCE(transaction_date, date) AS transaction_date, category,
           payer_name, description, amount, payment_method, reference
    FROM income_records
    WHERE (? IS NULL OR term_id = ?)
      AND category NOT IN ('fees', 'canteen', 'books', 'transport')
    ORDER BY COALESCE(transaction_date, date), id
  `).all(termId, termId).map(r => ({
    entry_ref: r.receipt_number,
    receipt_number: r.receipt_number || '',
    transaction_date: r.transaction_date,
    category: r.category,
    payer_name: r.payer_name || '',
    description: r.description || '',
    amount: round2(r.amount),
    payment_method: r.payment_method || 'Cash',
    reference: r.reference || '',
  }));
}

// Salary expenses live on the Payroll sheet; repeating them here would let
// somebody edit one in the wrong place.
function existingExpenses(db, termId) {
  return db.prepare(`
    SELECT transaction_number, COALESCE(transaction_date, date) AS transaction_date, category,
           payee_name, description, amount, payment_method, reference
    FROM expense_records
    WHERE (? IS NULL OR term_id = ?) AND category != 'salary'
    ORDER BY COALESCE(transaction_date, date), id
  `).all(termId, termId).map(r => ({
    entry_ref: r.transaction_number,
    transaction_number: r.transaction_number || '',
    transaction_date: r.transaction_date,
    category: r.category,
    payee_name: r.payee_name || '',
    description: r.description || '',
    amount: round2(r.amount),
    payment_method: r.payment_method || 'Cash',
    reference: r.reference || '',
  }));
}

// Both settled and outstanding salaries are exported: the outstanding ones are
// exactly the rows somebody offline needs to fill in an Amount Paid against.
function existingPayroll(db) {
  return db.prepare(`
    SELECT ss.*, s.staff_number, s.surname, s.first_name
    FROM staff_salaries ss JOIN staff s ON s.id = ss.staff_id
    ORDER BY ss.year DESC, ss.month DESC, s.surname
    LIMIT 400
  `).all().map(r => ({
    entry_ref: r.is_paid ? `SAL-${r.id}` : '',
    staff_number: r.staff_number || '',
    staff_name: `${r.surname} ${r.first_name}`.trim(),
    month: r.month, year: r.year,
    gross_salary: round2(r.gross_salary),
    ssnit: round2(r.ssnit_worker || 0),
    paye: round2(r.paye_tax || 0),
    net_salary: round2((r.net_salary || 0) + (r.arrear_brought_forward || 0)),
    amount_paid: r.is_paid ? round2(r.actual_amount_paid) : '',
    payment_date: r.is_paid ? r.payment_date : '',
    payment_method: r.payment_method || '',
    reference: r.payment_reference || '',
  }));
}

function arrearsRows(db, termId) {
  if (!termId) return [];
  return db.prepare(`
    SELECT s.index_number, s.surname, s.first_name, s.other_names,
           c.name AS class_name, b.total_billed, b.total_paid, b.balance,
           COALESCE(s.father_contact, s.mother_contact, s.guardian_contact) AS contact
    FROM student_bills b
    JOIN students s ON s.id = b.student_id
    LEFT JOIN class_groups c ON c.id = s.current_class_id
    WHERE b.term_id = ? AND b.balance > 0 AND s.status = 'Active'
      AND COALESCE(b.status, 'active') = 'active'
    ORDER BY b.balance DESC
  `).all(termId).map(r => ({
    index_number: r.index_number,
    name: [r.surname, r.first_name, r.other_names].filter(Boolean).join(' '),
    class_name: r.class_name || '',
    net_due: round2(r.total_billed),
    total_paid: round2(r.total_paid),
    balance: round2(r.balance),
    contact: r.contact || '',
    remarks: '',
  }));
}

function buildSummary(wb, db, school, term, termId, ledgerRows) {
  const ws = wb.addWorksheet(SHEETS.SUMMARY, {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1 },
  });
  addHead(ws, school, term, 'Finance summary',
    'Where the money stands as at the moment this workbook was made.', 6);

  const money = (n) => round2(n);
  const q = (sql, ...p) => { try { return db.prepare(sql).get(...p); } catch (_) { return null; } };

  const income = q(`SELECT category, COALESCE(SUM(amount),0) t FROM income_records
                    WHERE (? IS NULL OR term_id = ?) GROUP BY category`, termId, termId);
  const incomeRows = (() => {
    try {
      return db.prepare(`SELECT category, COALESCE(SUM(amount),0) t, COUNT(*) n FROM income_records
                         WHERE (? IS NULL OR term_id = ?) GROUP BY category ORDER BY t DESC`).all(termId, termId);
    } catch (_) { return []; }
  })();
  const expenseRows = (() => {
    try {
      return db.prepare(`SELECT category, COALESCE(SUM(amount),0) t, COUNT(*) n FROM expense_records
                         WHERE (? IS NULL OR term_id = ?) GROUP BY category ORDER BY t DESC`).all(termId, termId);
    } catch (_) { return []; }
  })();

  let r = schema.HEADER_ROWS;
  const sectionTitle = (text) => {
    ws.mergeCells(r, 1, r, 4);
    const c = ws.getCell(r, 1);
    c.value = text;
    c.font = { bold: true, size: 10, color: { argb: BRAND.navy } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.light } };
    c.alignment = { vertical: 'middle' };
    ws.getRow(r).height = 18;
    r += 1;
  };
  const kv = (label, value, opts = {}) => {
    ws.getCell(r, 1).value = label;
    ws.getCell(r, 1).font = { size: 10, bold: !!opts.bold };
    const vc = ws.getCell(r, 3);
    vc.value = typeof value === 'number' ? money(value) : value;
    vc.numFmt = typeof value === 'number' ? '#,##0.00' : undefined;
    vc.font = { size: 10, bold: !!opts.bold, color: opts.color ? { argb: opts.color } : undefined };
    vc.alignment = { horizontal: 'right' };
    r += 1;
  };

  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 4;
  ws.getColumn(3).width = 18;
  ws.getColumn(4).width = 12;

  const totalIncome = incomeRows.reduce((s, x) => s + x.t, 0);
  const totalExpense = expenseRows.reduce((s, x) => s + x.t, 0);

  sectionTitle('MONEY IN');
  for (const row of incomeRows) kv(labelCategory(row.category) + `  (${row.n})`, row.t);
  kv('TOTAL INCOME', totalIncome, { bold: true });
  r += 1;

  sectionTitle('MONEY OUT');
  for (const row of expenseRows) kv(labelCategory(row.category) + `  (${row.n})`, row.t);
  kv('TOTAL EXPENSE', totalExpense, { bold: true });
  r += 1;

  sectionTitle('POSITION');
  kv('Net (income − expense)', totalIncome - totalExpense, {
    bold: true, color: totalIncome - totalExpense >= 0 ? 'FF15803D' : 'FFB91C1C',
  });
  r += 1;

  sectionTitle('FEES THIS TERM');
  const billed = ledgerRows.reduce((s, x) => s + (x.net_due || 0), 0);
  const collected = ledgerRows.reduce((s, x) => s + (x.total_paid || 0), 0);
  kv('Pupils on roll', ledgerRows.length);
  kv('Total billed', billed);
  kv('Total collected', collected);
  kv('Outstanding', billed - collected, { bold: true, color: 'FFB91C1C' });
  kv('Collection rate', billed > 0 ? `${Math.round((collected / billed) * 100)}%` : '—');
  r += 1;

  sectionTitle('PER CLASS');
  const byClass = {};
  for (const row of ledgerRows) {
    const k = row.class_name || '—';
    byClass[k] = byClass[k] || { n: 0, billed: 0, paid: 0 };
    byClass[k].n += 1;
    byClass[k].billed += row.net_due || 0;
    byClass[k].paid += row.total_paid || 0;
  }
  ws.getCell(r, 1).value = 'Class';
  ws.getCell(r, 3).value = 'Billed';
  ws.getCell(r, 4).value = 'Collected';
  for (const c of [1, 3, 4]) ws.getCell(r, c).font = { bold: true, size: 9 };
  r += 1;
  for (const [name, agg] of Object.entries(byClass)) {
    ws.getCell(r, 1).value = `${name}  (${agg.n})`;
    ws.getCell(r, 3).value = money(agg.billed);
    ws.getCell(r, 3).numFmt = '#,##0.00';
    ws.getCell(r, 4).value = money(agg.paid);
    ws.getCell(r, 4).numFmt = '#,##0.00';
    r += 1;
  }
}

function labelCategory(c) {
  return String(c || 'other').replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
}

function buildReference(wb, db, school, term, students, opts) {
  const ws = wb.addWorksheet(SHEETS.REFERENCE, {
    views: [{ state: 'frozen', ySplit: schema.HEADER_ROWS }],
  });
  addHead(ws, school, term, 'Reference data',
    'Copy Index No / Staff No from here when filling in the entry sheets. Categories are the values the system accepts.', 9);

  const cols = [
    { key: 'index_number', header: 'Index No', w: 16 },
    { key: 'name', header: 'Student', w: 30 },
    { key: 'class_name', header: 'Class', w: 16 },
    { key: 'blank1', header: '', w: 3 },
    { key: 'staff_number', header: 'Staff No', w: 14 },
    { key: 'staff_name', header: 'Staff', w: 26 },
    { key: 'blank2', header: '', w: 3 },
    { key: 'income_category', header: 'Income Categories', w: 20 },
    { key: 'expense_category', header: 'Expense Categories', w: 20 },
  ];
  const hr = ws.getRow(schema.HEADER_ROWS);
  cols.forEach((c, i) => { hr.getCell(i + 1).value = c.header; });
  styleHeaderRow(ws, schema.HEADER_ROWS, cols.length);

  let staff = [];
  try {
    staff = db.prepare("SELECT staff_number, surname, first_name FROM staff WHERE status = 'Active' ORDER BY surname").all();
  } catch (_) {}

  const n = Math.max(students.length, staff.length, opts.incomeCategories.length, opts.expenseCategories.length);
  for (let i = 0; i < n; i++) {
    const r = schema.HEADER_ROWS + 1 + i;
    const s = students[i];
    if (s) {
      ws.getCell(r, 1).value = s.index_number;
      ws.getCell(r, 2).value = fullName(s);
      ws.getCell(r, 3).value = s.class_name || '';
    }
    const st = staff[i];
    if (st) {
      ws.getCell(r, 5).value = st.staff_number || '';
      ws.getCell(r, 6).value = `${st.surname} ${st.first_name}`.trim();
    }
    if (opts.incomeCategories[i]) ws.getCell(r, 8).value = opts.incomeCategories[i];
    if (opts.expenseCategories[i]) ws.getCell(r, 9).value = opts.expenseCategories[i];
    for (let c = 1; c <= cols.length; c++) ws.getCell(r, c).font = { size: 9.5 };
  }
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w; });
}

module.exports = { buildWorkbook, schoolInfo, currentTerm };
