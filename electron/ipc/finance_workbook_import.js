// Nickland Edusoft — Finance workbook: import.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Brings the offline workbook back into the system. Two rules govern everything
// here:
//
//   1. NEVER a second write path. Each row is handed to the SAME service the
//      app itself uses — fees:record-payment, canteen.recordCanteenPayment,
//      books:record-payment, transport.recordPayment, payroll:mark-paid,
//      postIncome/postExpense. So a payment imported from Excel updates the
//      pupil's bill, posts to the finance ledger under the right term, mints a
//      receipt and delivers it, exactly as if it had been typed into the app.
//      If it worked differently, the workbook would quietly become a way to put
//      money into the database that the rest of the system never sees.
//
//   2. NEVER post the same money twice. Every row carries a fingerprint of its
//      own contents (schema.entryKey). Before writing, the key is checked
//      against workbook_import_log, which has a UNIQUE constraint on it. Import
//      the same file five times and rows 2..5 are skipped.
//
// A preview (dryRun) runs the whole thing — parsing, validation, duplicate
// detection — and reports exactly what would happen, without writing anything.

const schema = require('./_workbook_schema');
const { SHEETS, ENTRY_SHEETS, STATUS } = schema;
const security = require('./_security');
const { postIncome, postExpense, nextCounter, resolveTermForDate } = require('./_ledger');

function ExcelJS() { return require('exceljs'); }

// ── Reading ────────────────────────────────────────────────────────────
// Pulls the candidate rows out of one entry sheet. Anything marked SYNCED, and
// anything with no data at all, is dropped here rather than downstream.
function readEntrySheet(ws, sheetName) {
  const def = ENTRY_SHEETS[sheetName];
  if (!def || !ws) return [];

  // Trust the header row rather than fixed positions: a user who inserts a
  // column, or an older workbook with a different order, still imports.
  const headerRow = ws.getRow(schema.HEADER_ROWS);
  const colFor = {};
  for (let c = 1; c <= Math.max(ws.columnCount, def.columns.length + 4); c++) {
    const label = schema.cellText(headerRow.getCell(c).value).trim().toLowerCase();
    if (!label) continue;
    const match = def.columns.find(col => col.header.toLowerCase() === label);
    if (match && colFor[match.key] === undefined) colFor[match.key] = c;
  }
  // A sheet whose headers do not match at all is not this sheet.
  if (colFor.status === undefined && colFor.amount === undefined && colFor.amount_paid === undefined) return [];

  const out = [];
  const last = ws.rowCount || 0;
  for (let r = schema.HEADER_ROWS + 1; r <= last; r++) {
    const row = ws.getRow(r);
    const raw = {};
    for (const col of def.columns) {
      const c = colFor[col.key];
      if (c === undefined) { raw[col.key] = null; continue; }
      const v = row.getCell(c).value;
      if (col.date) raw[col.key] = schema.toISODate(v && typeof v === 'object' && v.result !== undefined ? v.result : v);
      else if (col.money) raw[col.key] = schema.toMoney(v);
      else raw[col.key] = schema.cellText(v).trim();
    }

    const status = String(raw.status || '').trim().toUpperCase();
    if (status === STATUS.SYNCED) continue;

    // Blank template row — every field except the pre-filled Status is empty.
    const hasData = def.columns.some(col =>
      col.key !== 'status' && col.key !== 'entry_ref' &&
      raw[col.key] != null && raw[col.key] !== '');
    if (!hasData) continue;

    out.push({ __row: r, ...raw });
  }
  return out;
}

// ── Validation ─────────────────────────────────────────────────────────
function validateRow(db, sheetName, row, lookups) {
  const def = ENTRY_SHEETS[sheetName];
  const errors = [];

  for (const col of def.columns) {
    if (!col.required) continue;
    const v = row[col.key];
    if (v == null || v === '') errors.push(`${col.header} is required`);
  }

  const amountKey = def.target === 'payroll' ? 'amount_paid' : 'amount';
  const amount = row[amountKey];
  if (amount != null && amount !== '' && !(Number(amount) > 0)) {
    errors.push('Amount must be greater than zero');
  }

  const dateKey = def.columns.find(c => c.date) ? def.columns.find(c => c.date).key : null;
  if (dateKey && row[dateKey] && !/^\d{4}-\d{2}-\d{2}$/.test(row[dateKey])) {
    errors.push('Date is not a real date');
  }

  if (def.target === 'payroll') {
    const staff = lookups.staffByNumber.get(String(row.staff_number || '').trim().toUpperCase());
    if (!staff && row.staff_number) errors.push(`No staff member with Staff No "${row.staff_number}"`);
    row.__staff = staff || null;
  } else if (def.columns.some(c => c.key === 'index_number')) {
    const student = lookups.studentByIndex.get(String(row.index_number || '').trim().toUpperCase());
    if (!student && row.index_number) errors.push(`No pupil with Index No "${row.index_number}"`);
    row.__student = student || null;
  }

  return errors;
}

function buildLookups(db) {
  const studentByIndex = new Map();
  for (const s of db.prepare(`
    SELECT s.id, s.index_number, s.surname, s.first_name, c.name AS class_name
    FROM students s LEFT JOIN class_groups c ON c.id = s.current_class_id
  `).all()) {
    if (s.index_number) studentByIndex.set(String(s.index_number).trim().toUpperCase(), s);
  }
  const staffByNumber = new Map();
  try {
    for (const s of db.prepare('SELECT id, staff_number, surname, first_name FROM staff').all()) {
      if (s.staff_number) staffByNumber.set(String(s.staff_number).trim().toUpperCase(), s);
    }
  } catch (_) {}
  return { studentByIndex, staffByNumber };
}

// ── Writing ────────────────────────────────────────────────────────────
// Each target routes to the service the app itself uses. `handlers` is the set
// of captured ipcMain handlers (see captureHandlers) so nothing is reimplemented.
function applyRow(db, sheetName, row, ctx) {
  const def = ENTRY_SHEETS[sheetName];
  const userId = ctx.userId || null;
  const method = row.payment_method || 'Cash';

  switch (def.target) {
    case 'fees': {
      const res = ctx.handlers['fees:record-payment'](null, {
        student_id: row.__student.id,
        student_bill_id: currentBillId(db, row.__student.id, row.payment_date),
        term_id: termIdFor(db, row.payment_date),
        amount: row.amount,
        payment_date: row.payment_date,
        payment_method: method,
        reference: row.reference || '',
        received_by: userId,
        notes: joinNotes(row.notes, row.receipt_number),
      });
      if (!res || !res.ok) throw new Error(res && res.error ? res.error : 'Fee payment was rejected');
      return { table: 'payments', id: res.id, summary: `Fees ${money(row.amount)} — ${row.index_number}` };
    }

    case 'canteen': {
      const canteen = require('./canteen');
      // term_id is passed explicitly rather than left to the "current term"
      // fallback: money collected during a vacation would otherwise be
      // attributed to whichever term happens to be flagged current.
      const res = canteen.recordCanteenPayment(db, {
        student_id: row.__student.id,
        amount: row.amount,
        payment_date: row.payment_date,
        term_id: termIdFor(db, row.payment_date),
        payment_method: method,
        received_by: userId,
        notes: row.notes || null,
      });
      if (!res || !res.ok) throw new Error(res && res.error ? res.error : 'Canteen payment was rejected');
      return { table: 'canteen_payments', id: res.id || null, summary: `Canteen ${money(row.amount)} — ${row.index_number}` };
    }

    case 'books': {
      const bookId = db.prepare(`
        SELECT sb.id FROM student_books sb
        JOIN academic_years y ON y.id = sb.academic_year_id
        WHERE sb.student_id = ? ORDER BY y.is_current DESC, sb.id DESC LIMIT 1
      `).get(row.__student.id);
      const res = ctx.handlers['books:record-payment'](null, {
        student_id: row.__student.id,
        student_books_id: bookId ? bookId.id : null,
        amount: row.amount,
        payment_date: row.payment_date,
        payment_method: method,
        received_by: userId,
        notes: row.notes || null,
      });
      if (!res || !res.ok) throw new Error(res && res.error ? res.error : 'Books payment was rejected');
      return { table: 'books_payments', id: res.payment_id, summary: `Books ${money(row.amount)} — ${row.index_number}` };
    }

    case 'transport': {
      const transport = require('./transport');
      const res = transport.recordPayment(db, {
        student_id: row.__student.id,
        amount: row.amount,
        payment_date: row.payment_date,
        term_id: termIdFor(db, row.payment_date),
        payment_method: method,
        received_by: userId,
        notes: row.notes || null,
      });
      if (!res || !res.ok) throw new Error(res && res.error ? res.error : 'Transport payment was rejected');
      return { table: 'transport_payments', id: res.id, summary: `Transport ${money(row.amount)} — ${row.index_number}` };
    }

    case 'income': {
      const receipt = row.receipt_number || nextCounter(db, 'transaction_counter', 'INC');
      const id = postIncome(db, {
        receipt_number: receipt,
        category: normaliseCategory(row.category, 'other'),
        amount: row.amount,
        payer_name: row.payer_name || null,
        description: row.description || 'Imported from finance workbook',
        payment_method: method,
        reference: row.reference || null,
        date: row.transaction_date,
        source: 'workbook_import',
        recorded_by: userId,
      });
      return { table: 'income_records', id, summary: `Income ${money(row.amount)} — ${row.category}` };
    }

    case 'expense': {
      const txn = row.transaction_number || nextCounter(db, 'transaction_counter', 'EXP');
      const id = postExpense(db, {
        transaction_number: txn,
        category: normaliseCategory(row.category, 'other'),
        amount: row.amount,
        payee_name: row.payee_name || null,
        description: row.description || 'Imported from finance workbook',
        payment_method: method,
        reference: row.reference || null,
        date: row.transaction_date,
        recorded_by: userId,
      });
      return { table: 'expense_records', id, summary: `Expense ${money(row.amount)} — ${row.category}` };
    }

    case 'payroll': {
      const salary = db.prepare(
        'SELECT * FROM staff_salaries WHERE staff_id = ? AND month = ? AND year = ?'
      ).get(row.__staff.id, parseInt(row.month, 10), parseInt(row.year, 10));
      if (!salary) {
        throw new Error(`No salary run for ${row.staff_name || row.staff_number} in ${row.month}/${row.year}. Create the payroll run first, then import.`);
      }
      const res = ctx.handlers['payroll:mark-paid'](null, {
        id: salary.id,
        actualAmount: row.amount_paid,
        paymentMethod: row.payment_method || 'Bank',
        paymentReference: row.reference || null,
        paymentDate: row.payment_date,
        paidBy: userId,
      });
      if (!res || !res.ok) throw new Error(res && res.error ? res.error : 'Salary payment was rejected');
      return { table: 'staff_salaries', id: salary.id, summary: `Salary ${money(row.amount_paid)} — ${row.staff_name || row.staff_number}` };
    }

    default:
      throw new Error(`Unknown target "${def.target}"`);
  }
}

function money(n) { return `GHS ${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`; }

function joinNotes(...parts) {
  return parts.map(p => (p == null ? '' : String(p).trim())).filter(Boolean).join(' · ') || null;
}

function normaliseCategory(v, dflt) {
  const s = String(v || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return s || dflt;
}

function termIdFor(db, date) {
  const t = resolveTermForDate(db, date);
  return t ? t.id : null;
}

// The bill a fee payment should attach to: the pupil's active bill for the term
// the payment date falls in. Attaching to the wrong term's bill would leave the
// balance on screen disagreeing with the money received.
function currentBillId(db, studentId, date) {
  const termId = termIdFor(db, date);
  if (!termId) return null;
  const b = db.prepare(`
    SELECT id FROM student_bills
    WHERE student_id = ? AND term_id = ? AND COALESCE(status, 'active') = 'active'
  `).get(studentId, termId);
  return b ? b.id : null;
}

// Captures the real ipcMain handlers without an Electron runtime, so the
// importer drives the app's own services rather than duplicating them.
function captureHandlers(db) {
  const h = {};
  const reg = { handle: (name, fn) => { h[name] = fn; } };
  require('./fees')(reg, db);
  require('./books')(reg, db);
  require('./payroll')(reg, db);
  return h;
}

// ── Entry point ────────────────────────────────────────────────────────
async function importWorkbook(db, filePath, options = {}) {
  const dryRun = !!options.dryRun;
  const Excel = ExcelJS();
  const wb = new Excel.Workbook();
  try {
    await wb.xlsx.readFile(filePath);
  } catch (e) {
    return { ok: false, error: `That file could not be opened as an Excel workbook: ${e.message}` };
  }

  const lookups = buildLookups(db);
  const userId = options.userId != null ? options.userId : security.getCurrentUserId();
  const handlers = dryRun ? {} : captureHandlers(db);
  const ctx = { userId, handlers };
  const sourceFile = String(filePath).split(/[\\/]/).pop();

  const alreadyImported = (key) => {
    try {
      return !!db.prepare('SELECT id FROM workbook_import_log WHERE entry_key = ?').get(key);
    } catch (_) { return false; }
  };

  const report = { ok: true, dry_run: dryRun, file: sourceFile, sheets: [], totals: {
    imported: 0, duplicates: 0, failed: 0, amount: 0,
  } };

  // Two rows in one file can be genuinely identical (a school really can take
  // two GHS 50 payments from one pupil on one day). Counting occurrences keeps
  // them distinct while staying reproducible when the same file is re-imported.
  const occurrences = new Map();

  for (const sheetName of Object.keys(ENTRY_SHEETS)) {
    const ws = wb.getWorksheet(sheetName);
    const rows = readEntrySheet(ws, sheetName);
    const sheetReport = {
      sheet: sheetName, found: rows.length,
      imported: 0, duplicates: 0, failed: 0, amount: 0,
      entries: [], problems: [],
    };

    for (const row of rows) {
      const errors = validateRow(db, sheetName, row, lookups);

      const baseKey = schema.entryKey(sheetName, row, 1);
      const seen = (occurrences.get(baseKey) || 0) + 1;
      occurrences.set(baseKey, seen);
      // A user-supplied Entry Ref wins: it lets a school correct a mistyped row
      // and re-import it as a genuinely different entry.
      const key = row.entry_ref ? `REF-${String(row.entry_ref).trim().toUpperCase()}`
                                : schema.entryKey(sheetName, row, seen);

      if (errors.length) {
        sheetReport.failed++;
        sheetReport.problems.push({ row: row.__row, error: errors.join('; ') });
        continue;
      }
      if (alreadyImported(key)) {
        sheetReport.duplicates++;
        continue;
      }

      const amountKey = ENTRY_SHEETS[sheetName].target === 'payroll' ? 'amount_paid' : 'amount';
      const amount = Number(row[amountKey]) || 0;

      if (dryRun) {
        sheetReport.imported++;
        sheetReport.amount += amount;
        if (sheetReport.entries.length < 50) {
          sheetReport.entries.push({
            row: row.__row, amount,
            who: row.student_name || row.staff_name || row.payer_name || row.payee_name || row.index_number || '',
            what: row.description || row.category || '',
            date: row.payment_date || row.transaction_date || '',
          });
        }
        continue;
      }

      // Rows are written one at a time, NOT wrapped in an outer transaction.
      // Every service called below opens its own transaction, and nesting one
      // inside another is not portable — so the claim-then-write order does the
      // work a wrapper would:
      //
      //   1. Claim the key (UNIQUE insert). Two concurrent imports of the same
      //      row cannot both get past this.
      //   2. Run the service, which manages its own atomicity.
      //   3. Fill in what it produced; on failure, release the claim so the row
      //      can be retried on the next import.
      //
      // The failure direction matters: a crash between 1 and 3 leaves a claimed
      // key with no payment, which shows up as money missing and can be
      // re-entered. The opposite ordering would risk posting the same payment
      // twice, which is the one outcome a school cannot recover from.
      let claimed = false;
      try {
        db.prepare(`
          INSERT INTO workbook_import_log (entry_key, sheet, amount, source_file, imported_by)
          VALUES (?, ?, ?, ?, ?)
        `).run(key, sheetName, amount, sourceFile, userId);
        claimed = true;

        const out = applyRow(db, sheetName, row, ctx);
        db.prepare(
          'UPDATE workbook_import_log SET target_table = ?, target_id = ?, summary = ? WHERE entry_key = ?'
        ).run(out.table, out.id || null, out.summary, key);

        sheetReport.imported++;
        sheetReport.amount += amount;
        if (sheetReport.entries.length < 50) {
          sheetReport.entries.push({ row: row.__row, amount, who: out.summary, date: row.payment_date || row.transaction_date || '' });
        }
      } catch (e) {
        if (claimed) {
          try { db.prepare('DELETE FROM workbook_import_log WHERE entry_key = ?').run(key); } catch (_) {}
        }
        sheetReport.failed++;
        sheetReport.problems.push({ row: row.__row, error: String((e && e.message) || e) });
      }
    }

    sheetReport.amount = Math.round(sheetReport.amount * 100) / 100;
    report.sheets.push(sheetReport);
    report.totals.imported += sheetReport.imported;
    report.totals.duplicates += sheetReport.duplicates;
    report.totals.failed += sheetReport.failed;
    report.totals.amount += sheetReport.amount;
  }

  report.totals.amount = Math.round(report.totals.amount * 100) / 100;

  if (!dryRun && report.totals.imported > 0) {
    try {
      db.prepare(`
        INSERT INTO audit_log (entity_type, entity_id, action, user_id, justification, severity)
        VALUES ('finance_workbook', NULL, 'workbook_imported', ?, ?, 'high')
      `).run(userId, `Imported ${sourceFile}: ${report.totals.imported} entr(ies), ` +
        `GHS ${report.totals.amount.toFixed(2)}, ${report.totals.duplicates} already present, ${report.totals.failed} failed.`);
    } catch (_) {}
  }

  return report;
}

module.exports = { importWorkbook, readEntrySheet, validateRow, buildLookups, captureHandlers };
