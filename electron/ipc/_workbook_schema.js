// Nickland Edusoft — Finance workbook contract.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The workbook exists for one reason: continuity. When the computer is down,
// the school keeps collecting money in this single Excel file, and when the
// system comes back the file is imported and everything carries on. That makes
// the workbook a WRITE-BACK medium, not a report — so the column layout is a
// contract, defined once here and used by both the exporter and the importer.
// If they ever disagreed, money would land in the wrong column.
//
// Two kinds of sheet:
//   • LEDGER sheets are read-only pictures of the current state (fee schedule,
//     student ledger, arrears, summaries). They exist so the person working
//     offline can see who owes what.
//   • ENTRY sheets are the ones that come back in. Every row already in the
//     system is exported with Status = SYNCED and is skipped on import;
//     anything the school types below it is picked up.
//
// Idempotency is the whole game. Each imported row gets a stable `entry_key`
// derived from its content (see entryKey below), recorded in
// workbook_import_log with a UNIQUE constraint. Importing the same file twice —
// or two files that overlap — can never post the same payment twice.

const crypto = require('crypto');

const STATUS = {
  SYNCED: 'SYNCED',   // already in the system; the importer ignores it
  NEW: 'NEW',         // typed offline; the importer will bring it in
};

// Column definitions. `key` is the internal field, `header` is what the user
// sees, `w` the column width. `money` / `date` drive number formats.
const SHEETS = {
  COVER:            'Start Here',
  FEE_SCHEDULE:     'Fee Schedule',
  STUDENT_LEDGER:   'Student Ledger',
  FEE_PAYMENTS:     'Fee Payments',
  CANTEEN:          'Canteen Ledger',
  CANTEEN_PAYMENTS: 'Canteen Payments',
  BOOKS_PAYMENTS:   'Books Payments',
  TRANSPORT:        'Transport Payments',
  OTHER_INCOME:     'Other Income',
  EXPENSES:         'Expenses',
  PAYROLL:          'Payroll',
  ARREARS:          'Arrears Register',
  SUMMARY:          'Finance Summary',
  REFERENCE:        'Reference Data',
};

// Every entry sheet starts with these two columns, in this order.
const ENTRY_PREFIX = [
  { key: 'status',    header: 'Status',    w: 10 },
  { key: 'entry_ref', header: 'Entry Ref', w: 16 },
];

const ENTRY_SHEETS = {
  [SHEETS.FEE_PAYMENTS]: {
    target: 'fees',
    title: 'School fee payments',
    help: 'Record every fee payment taken while the system was down. Index No must match the pupil exactly.',
    columns: [
      ...ENTRY_PREFIX,
      { key: 'receipt_number', header: 'Receipt No',   w: 16 },
      { key: 'payment_date',   header: 'Date',         w: 12, date: true, required: true },
      { key: 'index_number',   header: 'Index No',     w: 16, required: true },
      { key: 'student_name',   header: 'Student Name', w: 26 },
      { key: 'class_name',     header: 'Class',        w: 14 },
      { key: 'amount',         header: 'Amount (GHS)', w: 14, money: true, required: true },
      { key: 'payment_method', header: 'Method',       w: 13 },
      { key: 'reference',      header: 'Reference',    w: 16 },
      { key: 'notes',          header: 'Notes',        w: 26 },
    ],
    // Fields that make two rows genuinely different money movements.
    identity: ['payment_date', 'index_number', 'amount', 'reference'],
  },

  [SHEETS.CANTEEN_PAYMENTS]: {
    target: 'canteen',
    title: 'Canteen collection',
    help: 'Daily canteen money. Leave Days Covered blank to let the system work it out from the daily rate.',
    columns: [
      ...ENTRY_PREFIX,
      { key: 'payment_date',   header: 'Date',         w: 12, date: true, required: true },
      { key: 'index_number',   header: 'Index No',     w: 16, required: true },
      { key: 'student_name',   header: 'Student Name', w: 26 },
      { key: 'class_name',     header: 'Class',        w: 14 },
      { key: 'amount',         header: 'Amount (GHS)', w: 14, money: true, required: true },
      { key: 'days_covered',   header: 'Days Covered', w: 13 },
      { key: 'payment_method', header: 'Method',       w: 13 },
      { key: 'notes',          header: 'Notes',        w: 26 },
    ],
    identity: ['payment_date', 'index_number', 'amount'],
  },

  [SHEETS.BOOKS_PAYMENTS]: {
    target: 'books',
    title: 'Books payments',
    help: 'Money received against the books bill for the academic year.',
    columns: [
      ...ENTRY_PREFIX,
      { key: 'receipt_number', header: 'Receipt No',   w: 16 },
      { key: 'payment_date',   header: 'Date',         w: 12, date: true, required: true },
      { key: 'index_number',   header: 'Index No',     w: 16, required: true },
      { key: 'student_name',   header: 'Student Name', w: 26 },
      { key: 'class_name',     header: 'Class',        w: 14 },
      { key: 'amount',         header: 'Amount (GHS)', w: 14, money: true, required: true },
      { key: 'payment_method', header: 'Method',       w: 13 },
      { key: 'notes',          header: 'Notes',        w: 26 },
    ],
    identity: ['payment_date', 'index_number', 'amount'],
  },

  [SHEETS.TRANSPORT]: {
    target: 'transport',
    title: 'Transport fees',
    help: 'Bus/transport fee collection for the term.',
    columns: [
      ...ENTRY_PREFIX,
      { key: 'receipt_number', header: 'Receipt No',   w: 16 },
      { key: 'payment_date',   header: 'Date',         w: 12, date: true, required: true },
      { key: 'index_number',   header: 'Index No',     w: 16, required: true },
      { key: 'student_name',   header: 'Student Name', w: 26 },
      { key: 'route_name',     header: 'Route',        w: 20 },
      { key: 'amount',         header: 'Amount (GHS)', w: 14, money: true, required: true },
      { key: 'payment_method', header: 'Method',       w: 13 },
      { key: 'notes',          header: 'Notes',        w: 26 },
    ],
    identity: ['payment_date', 'index_number', 'amount'],
  },

  [SHEETS.OTHER_INCOME]: {
    target: 'income',
    title: 'Other income',
    help: 'Any money in that is not fees, canteen, books or transport — donations, hall hire, PTA levies, sales.',
    columns: [
      ...ENTRY_PREFIX,
      { key: 'receipt_number', header: 'Receipt No',   w: 16 },
      { key: 'transaction_date', header: 'Date',       w: 12, date: true, required: true },
      { key: 'category',       header: 'Category',     w: 16, required: true },
      { key: 'payer_name',     header: 'From (Payer)', w: 24 },
      { key: 'description',    header: 'Description',  w: 32 },
      { key: 'amount',         header: 'Amount (GHS)', w: 14, money: true, required: true },
      { key: 'payment_method', header: 'Method',       w: 13 },
      { key: 'reference',      header: 'Reference',    w: 16 },
    ],
    identity: ['transaction_date', 'category', 'payer_name', 'amount', 'description'],
  },

  [SHEETS.EXPENSES]: {
    target: 'expense',
    title: 'Expenses',
    help: 'Every payment out — supplies, utilities, repairs, transport running costs. Salaries belong on the Payroll sheet.',
    columns: [
      ...ENTRY_PREFIX,
      { key: 'transaction_number', header: 'Txn No',   w: 16 },
      { key: 'transaction_date', header: 'Date',       w: 12, date: true, required: true },
      { key: 'category',       header: 'Category',     w: 18, required: true },
      { key: 'payee_name',     header: 'Paid To',      w: 24 },
      { key: 'description',    header: 'Description',  w: 32, required: true },
      { key: 'amount',         header: 'Amount (GHS)', w: 14, money: true, required: true },
      { key: 'payment_method', header: 'Method',       w: 13 },
      { key: 'reference',      header: 'Reference',    w: 16 },
    ],
    identity: ['transaction_date', 'category', 'payee_name', 'amount', 'description'],
  },

  [SHEETS.PAYROLL]: {
    target: 'payroll',
    title: 'Payroll',
    help: 'Salaries actually paid. The system already knows what each person is owed — fill in Amount Paid and Pay Date.',
    columns: [
      ...ENTRY_PREFIX,
      { key: 'staff_number', header: 'Staff No',        w: 14, required: true },
      { key: 'staff_name',   header: 'Staff Name',      w: 26 },
      { key: 'month',        header: 'Month',           w: 9,  required: true },
      { key: 'year',         header: 'Year',            w: 9,  required: true },
      { key: 'gross_salary', header: 'Gross (GHS)',     w: 14, money: true },
      { key: 'ssnit',        header: 'SSNIT (GHS)',     w: 13, money: true },
      { key: 'paye',         header: 'PAYE (GHS)',      w: 13, money: true },
      { key: 'net_salary',   header: 'Net Due (GHS)',   w: 14, money: true },
      { key: 'amount_paid',  header: 'Amount Paid (GHS)', w: 17, money: true, required: true },
      { key: 'payment_date', header: 'Pay Date',        w: 12, date: true, required: true },
      { key: 'payment_method', header: 'Method',        w: 13 },
      { key: 'reference',    header: 'Reference',       w: 16 },
    ],
    identity: ['staff_number', 'month', 'year', 'amount_paid'],
  },
};

// Read-only ledger sheets — layout is defined by the exporter, but the header
// row count is shared so the importer can skip them safely.
const HEADER_ROWS = 6;   // title, school, blank, sheet title, help, column headers

// ── Idempotency key ────────────────────────────────────────────────────
// Derived from the row's own content, so the SAME row in the SAME file always
// produces the SAME key no matter how many times it is imported. `occurrence`
// distinguishes two genuinely identical rows within one file (a school really
// can take two GHS 50 payments from one pupil on one day) while keeping the
// pair reproducible across re-imports of that file.
function entryKey(sheetName, row, occurrence = 1) {
  const def = ENTRY_SHEETS[sheetName];
  const fields = def ? def.identity : Object.keys(row).sort();
  const basis = [sheetName, ...fields.map(f => normaliseForKey(row[f]))].join('|');
  const hash = crypto.createHash('sha1').update(basis).digest('hex').slice(0, 12).toUpperCase();
  return `XL-${hash}${occurrence > 1 ? `-${occurrence}` : ''}`;
}

// Whitespace, case and number formatting must not change the key, or a row the
// user merely re-typed would import twice.
function normaliseForKey(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return String(Math.round(v * 100) / 100);
  return String(v).trim().toLowerCase().replace(/\s+/g, ' ');
}

// Excel hands dates back as Date objects, strings, or serial numbers depending
// on how the cell was typed. All three have to land on the same ISO day.
function toISODate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    // Excel dates come through as UTC midnight; reading UTC parts avoids the
    // off-by-one-day that local-time getters cause west of Greenwich.
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())}`;
  }
  if (typeof v === 'number') {
    // Excel serial: days since 1899-12-30.
    const ms = Math.round((v - 25569) * 86400 * 1000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  // dd/mm/yyyy — the format the school's own workbook used.
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// "GHS 1,250.50" / "1250.5" / 1250.5 → 1250.5
function toMoney(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  if (typeof v === 'object' && v.result != null) return toMoney(v.result);
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? null : Math.round(n * 100) / 100;
}

// Cell values arrive as plain values, formula objects, rich text or hyperlinks.
function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.result !== undefined) return cellText(v.result);
    if (v.richText) return v.richText.map(t => t.text).join('');
    if (v.text !== undefined) return String(v.text);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return '';
  }
  return String(v);
}

module.exports = {
  SHEETS, ENTRY_SHEETS, ENTRY_PREFIX, STATUS, HEADER_ROWS,
  entryKey, normaliseForKey, toISODate, toMoney, cellText,
};
