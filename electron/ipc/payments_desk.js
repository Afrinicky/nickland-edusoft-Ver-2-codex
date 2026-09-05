// Nickland Edusoft — The payment desk.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// A school does not have a fees counter, a books counter, a canteen counter
// and a bus counter. It has ONE counter, and a parent at it says "I've come to
// pay" — school fees, textbooks, the canteen for the month, the bus, the
// excursion. Until now each of those was a different screen in a different
// module with a different receipt, and the person at the counter had to know
// which one before they could take the money.
//
// This is the one desk. It knows what a pupil owes across everything the
// school charges for, takes a payment against one of them, and hands back the
// receipt to put on the screen and on the roll.
//
// ── What it is not ──────────────────────────────────────────────────────────
//
// It is not a second implementation of any of them. School fees still post
// through fees.js, books through books.js, the canteen through canteen.js and
// the bus through transport.js — each with its own ledger posting, its own
// receipt numbering and, in the canteen's case, its own day-marking. A canteen
// payment taken here marks the days on the canteen calendar exactly as one
// taken in the canteen module does, because it IS the canteen module's own
// code doing it. What this adds is a single way in.

const { getSetting } = require('../utils/idgen');
const billing = require('./_billing');
const security = require('./_security');

// ── What a school can be paid for ───────────────────────────────────────────
//
// "Payment purpose" is the formal name — it is what appears on the receipt and
// in the ledger. "Type of payment" reads like the METHOD (cash, momo), which
// is a different question the same form also asks.
const PURPOSES = [
  {
    key: 'school_fees', label: 'School Fees', receipt_prefix: 'FE',
    note: 'Tuition and the term’s standing levies',
    always: true,
  },
  {
    key: 'books', label: 'Books', receipt_prefix: 'BK',
    note: 'Textbooks charged for the academic year',
    always: true,
  },
  {
    key: 'canteen', label: 'Canteen', receipt_prefix: 'CT',
    note: 'Feeding, by the day, off the term’s calendar',
    feature: 'feature_canteen_enabled',
  },
  {
    key: 'transport', label: 'Transport', receipt_prefix: 'TR',
    note: 'The termly fare for the pupil’s route',
    feature: 'feature_transport_enabled',
  },
  {
    key: 'extra_charges', label: 'Extra Charges', receipt_prefix: 'FE',
    note: 'Excursion, sports week and anything else raised mid-term',
    // Extras sit on the term bill, so paying one is a school-fees payment
    // against that bill. Keeping it as its own purpose is for the RECEIPT: a
    // parent paying for an excursion wants the word "excursion" on the paper.
    posts_as: 'school_fees',
    always: true,
  },
];

const METHODS = ['Cash', 'Mobile Money', 'Bank Transfer', 'Cheque', 'Bank Deposit'];

// Mobile money and bank transfers are only traceable if the transaction
// reference is captured, so the desk insists on one for those methods and does
// not for cash, where there is nothing to reference.
const REFERENCE_REQUIRED = new Set(['Mobile Money', 'Bank Transfer', 'Cheque', 'Bank Deposit']);

module.exports = function registerPaymentDeskHandlers(ipcMain, db, deps) {
  const { fees, books, canteen, transport } = deps;

  // ── What this school can take money for ───────────────────────────────
  ipcMain.handle('payments:purposes', () => ({
    ok: true,
    purposes: enabledPurposes(db),
    methods: METHODS,
    reference_required: [...REFERENCE_REQUIRED],
    // The receipt's paper size, so the desk can say what it will print on
    // before it prints it.
    paper_size: getSetting(db, 'receipt_paper_size', 'roll80'),
  }));

  // ── Finding the pupil ─────────────────────────────────────────────────
  //
  // A search box alone is not enough at a counter. The person paying is often
  // "the Basic 5 parents, the ones still owing", and typing forty surnames to
  // find them is why a queue forms.
  ipcMain.handle('payments:find-students', (_e, filters = {}) => findStudents(db, filters));

  // ── What one pupil owes, across everything ────────────────────────────
  ipcMain.handle('payments:student-account', (_e, { studentId, termId } = {}) =>
    studentAccount(db, studentId, termId));

  // ── Taking the money ──────────────────────────────────────────────────
  ipcMain.handle('payments:take', (_e, data = {}) =>
    takePayment(db, { fees, books, canteen, transport }, data));

  // ── The receipt, for the screen and for the printer ───────────────────
  ipcMain.handle('payments:receipt', (_e, { source, paymentId } = {}) =>
    receiptModel(db, source, paymentId));

  // ── The day's takings, filtered ───────────────────────────────────────
  ipcMain.handle('payments:register', (_e, filters = {}) => paymentRegister(db, filters));
};

// ══ Implementation ══════════════════════════════════════════════════════════

function enabledPurposes(db) {
  return PURPOSES.filter(p => p.always || getSetting(db, p.feature, '') === 'true')
    .map(p => ({ key: p.key, label: p.label, note: p.note, receipt_prefix: p.receipt_prefix }));
}

function currentTermId(db) {
  const row = db.prepare('SELECT id FROM terms WHERE is_current = 1').get();
  return row ? row.id : null;
}

/** The counter's list: who to take money from, narrowed the way a queue is. */
function findStudents(db, filters = {}) {
  const termId = filters.termId || currentTermId(db);
  const params = [termId];
  let sql = `
    SELECT s.id, s.index_number, s.surname, s.first_name, s.other_names, s.status,
           s.father_contact, s.mother_contact, s.guardian_contact,
           c.name AS class_name, c.short_code AS class_code, c.level_order,
           COALESCE(b.balance, 0) AS fees_balance,
           COALESCE(b.total_billed, 0) AS fees_billed,
           COALESCE(b.total_paid, 0) AS fees_paid,
           b.id AS bill_id
    FROM students s
    LEFT JOIN class_groups c ON c.id = s.current_class_id
    LEFT JOIN student_bills b ON b.student_id = s.id AND b.term_id = ?
                             AND COALESCE(b.status, 'active') = 'active'
    WHERE 1=1
  `;

  // Active by default: a counter is not taking money from pupils who left,
  // and having them in the list is how a payment lands on the wrong record.
  const status = filters.status || 'Active';
  if (status !== 'all') { sql += ' AND s.status = ?'; params.push(status); }
  if (filters.classId) { sql += ' AND s.current_class_id = ?'; params.push(filters.classId); }

  const q = String(filters.q || '').trim();
  if (q) {
    sql += ` AND (s.surname LIKE ? OR s.first_name LIKE ? OR s.other_names LIKE ?
                  OR s.index_number LIKE ?
                  OR (COALESCE(s.surname,'') || ' ' || COALESCE(s.first_name,'')) LIKE ?)`;
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }

  if (filters.owing === true || filters.owing === 'owing') sql += ' AND COALESCE(b.balance, 0) > 0';
  else if (filters.owing === 'settled') sql += ' AND COALESCE(b.balance, 0) <= 0 AND b.id IS NOT NULL';
  else if (filters.owing === 'unbilled') sql += ' AND b.id IS NULL';

  sql += ' ORDER BY c.level_order, s.surname, s.first_name LIMIT ?';
  params.push(Math.min(Number(filters.limit) || 200, 500));

  const rows = db.prepare(sql).all(...params);
  return { ok: true, students: rows, term_id: termId };
}

/** Everything one pupil owes, purpose by purpose. */
function studentAccount(db, studentId, termId) {
  if (!studentId) return { ok: false, error: 'No pupil chosen.' };
  const term = billing.termWithYear(db, termId || currentTermId(db));
  const student = db.prepare(`
    SELECT s.*, c.name AS class_name, c.short_code AS class_code
    FROM students s LEFT JOIN class_groups c ON c.id = s.current_class_id
    WHERE s.id = ?`).get(studentId);
  if (!student) return { ok: false, error: 'That pupil is not on the roll.' };

  const accounts = [];

  // ── School fees, and the extras carried on the same bill ──────────────
  const bill = term ? db.prepare(`
    SELECT * FROM student_bills
    WHERE student_id = ? AND term_id = ? AND COALESCE(status, 'active') = 'active'`)
    .get(studentId, term.id) : null;
  accounts.push({
    purpose: 'school_fees', label: 'School Fees',
    reference_id: bill ? bill.id : null,
    billed: billing.round2(bill ? bill.total_billed : 0),
    paid: billing.round2(bill ? bill.total_paid : 0),
    balance: billing.round2(bill ? bill.balance : 0),
    note: bill ? `${billing.termLabel(term)}` : 'No bill raised for this term yet',
    payable: !!bill,
  });

  const extras = bill ? billing.round2(bill.supplementary_total || 0) : 0;
  if (extras > 0) {
    accounts.push({
      purpose: 'extra_charges', label: 'Extra Charges',
      reference_id: bill.id,
      billed: extras, paid: null,
      balance: null,
      note: 'Carried on the term bill — paying one settles part of it',
      payable: true,
    });
  }

  // ── Books, charged for the academic year ──────────────────────────────
  const yearId = term ? term.academic_year_id : null;
  const booksRow = yearId ? db.prepare(
    'SELECT * FROM student_books WHERE student_id = ? AND academic_year_id = ?')
    .get(studentId, yearId) : null;
  accounts.push({
    purpose: 'books', label: 'Books',
    reference_id: booksRow ? booksRow.id : null,
    billed: billing.round2(booksRow ? booksRow.total_amount : 0),
    paid: billing.round2(booksRow ? booksRow.total_paid : 0),
    balance: billing.round2(booksRow ? booksRow.balance : 0),
    note: booksRow ? `${term?.year_label || 'this academic year'}` : 'No books charged this year',
    payable: !!booksRow,
  });

  // ── Canteen, by the day ───────────────────────────────────────────────
  if (getSetting(db, 'feature_canteen_enabled', '') === 'true') {
    const rate = parseFloat(getSetting(db, 'canteen_daily_rate', '0')) || 0;
    const totals = safeRow(db, `
      SELECT
        (SELECT COUNT(*) FROM school_calendar WHERE term_id = ? AND day_type = 'school_day') AS days,
        (SELECT COUNT(*) FROM canteen_day_status cds
          JOIN school_calendar sc ON sc.date = cds.date
         WHERE cds.student_id = ? AND cds.status = 'paid' AND sc.term_id = ?) AS days_paid
    `, [term ? term.id : null, studentId, term ? term.id : null]);
    const days = totals.days || 0;
    const daysPaid = totals.days_paid || 0;
    accounts.push({
      purpose: 'canteen', label: 'Canteen',
      reference_id: null,
      billed: billing.round2(days * rate),
      paid: billing.round2(daysPaid * rate),
      balance: billing.round2(Math.max(0, (days - daysPaid) * rate)),
      note: days > 0
        ? `${daysPaid} of ${days} day(s) settled at ${money(rate)} a day`
        : 'The term’s canteen calendar has not been laid out',
      payable: days > 0 && rate > 0,
      daily_rate: rate,
    });
  }

  // ── Transport, a termly fare ──────────────────────────────────────────
  if (getSetting(db, 'feature_transport_enabled', '') === 'true') {
    const ride = safeRow(db, `
      SELECT st.*, r.name AS route_name, COALESCE(st.fee_override, r.fee_per_term) AS fare
      FROM student_transport st JOIN transport_routes r ON r.id = st.route_id
      WHERE st.student_id = ? AND COALESCE(st.is_active, 1) = 1`, [studentId]);
    const fare = billing.round2(ride.fare || 0);
    const paid = billing.round2(safeValue(db, `
      SELECT COALESCE(SUM(amount), 0) AS t FROM transport_payments
      WHERE student_id = ? AND term_id = ?`, [studentId, term ? term.id : null]));
    accounts.push({
      purpose: 'transport', label: 'Transport',
      reference_id: ride.route_id || null,
      billed: fare, paid,
      balance: billing.round2(Math.max(0, fare - paid)),
      note: ride.route_name ? `${ride.route_name}` : 'Not assigned to a route',
      payable: !!ride.route_id,
    });
  }

  // ── What has already been received, from every purpose ────────────────
  const history = paymentHistory(db, studentId);

  return {
    ok: true,
    student: {
      id: student.id, index_number: student.index_number,
      surname: student.surname, first_name: student.first_name,
      other_names: student.other_names, class_name: student.class_name,
      class_code: student.class_code,
      contact: student.father_contact || student.mother_contact || student.guardian_contact || '',
    },
    term: term ? { id: term.id, label: term.label, year_label: term.year_label, full_label: billing.termLabel(term) } : null,
    accounts,
    total_balance: billing.round2(accounts.reduce((n, a) => n + (a.balance || 0), 0)),
    history,
  };
}

/** Every receipt written for a pupil, whatever it was for, newest first. */
function paymentHistory(db, studentId) {
  const rows = [];
  const push = (source, list) => { for (const r of list) rows.push({ ...r, source }); };

  push('fees', db.prepare(`
    SELECT id, receipt_number, amount, payment_date, payment_method, reference, notes
    FROM payments WHERE student_id = ? AND COALESCE(is_reversed, 0) = 0
    ORDER BY payment_date DESC, id DESC LIMIT 40`).all(studentId));
  push('books', db.prepare(`
    SELECT id, receipt_number, amount, payment_date, payment_method, reference, notes
    FROM books_payments WHERE student_id = ?
    ORDER BY payment_date DESC, id DESC LIMIT 40`).all(studentId));
  try {
    push('canteen', db.prepare(`
      SELECT id, receipt_number, amount, payment_date, notes,
             'Cash' AS payment_method, NULL AS reference
      FROM canteen_payments WHERE student_id = ?
      ORDER BY payment_date DESC, id DESC LIMIT 40`).all(studentId));
  } catch (_) { /* the school may not run a canteen */ }
  try {
    push('transport', db.prepare(`
      SELECT id, receipt_number, amount, payment_date, payment_method, notes,
             NULL AS reference
      FROM transport_payments WHERE student_id = ?
      ORDER BY payment_date DESC, id DESC LIMIT 40`).all(studentId));
  } catch (_) { /* nor a bus */ }

  return rows
    .sort((a, b) => String(b.payment_date).localeCompare(String(a.payment_date)) || b.id - a.id)
    .slice(0, 40);
}

/** Take a payment for any purpose, through that purpose's own module. */
function takePayment(db, mods, data) {
  const purpose = PURPOSES.find(p => p.key === data.purpose);
  if (!purpose) return { ok: false, error: 'Say what the payment is for.' };

  const amount = Math.round((Number(data.amount) || 0) * 100) / 100;
  if (!(amount > 0)) return { ok: false, error: 'Enter the amount handed over.' };
  if (!data.studentId) return { ok: false, error: 'Choose the pupil.' };

  const method = METHODS.includes(data.method) ? data.method : 'Cash';
  const reference = String(data.reference || '').trim();
  // A mobile-money payment with no transaction id cannot be traced when the
  // parent says they paid and the school cannot find it. That argument is the
  // reason the field exists, so it is enforced rather than suggested.
  if (REFERENCE_REQUIRED.has(method) && !reference) {
    return {
      ok: false, code: 'REFERENCE_REQUIRED',
      error: `A ${method.toLowerCase()} payment needs its transaction reference — `
           + 'without one there is nothing to check against when it is queried.',
    };
  }

  // Who took the money is not typed in. It is whoever is signed in, which is
  // the only version of it anybody can rely on afterwards.
  const receivedBy = security.getCurrentUserId() || data.receivedBy || null;
  const termId = data.termId || currentTermId(db);
  const paymentDate = data.paymentDate || new Date().toISOString().slice(0, 10);
  const notes = String(data.notes || '').trim() || null;

  const posts = purpose.posts_as || purpose.key;
  let result;
  try {
    if (posts === 'school_fees') {
      const bill = db.prepare(`
        SELECT id FROM student_bills WHERE student_id = ? AND term_id = ?
          AND COALESCE(status, 'active') = 'active'`).get(data.studentId, termId);
      result = mods.fees.recordPayment(db, {
        student_id: data.studentId,
        student_bill_id: data.referenceId || (bill ? bill.id : null),
        term_id: termId,
        amount, payment_date: paymentDate,
        payment_method: method, reference: reference || null,
        received_by: receivedBy,
        // The purpose is written into the note so the ledger and the receipt
        // both say "Excursion" rather than "School fees" for money a parent
        // handed over for an excursion.
        notes: notes || (purpose.key === 'extra_charges' ? 'Extra charges' : null),
        purpose: purpose.key,
      });
      if (result.ok) result.source = 'fees';
    } else if (posts === 'books') {
      let booksId = data.referenceId;
      if (!booksId) {
        const term = billing.termWithYear(db, termId);
        const row = term ? db.prepare(
          'SELECT id FROM student_books WHERE student_id = ? AND academic_year_id = ?')
          .get(data.studentId, term.academic_year_id) : null;
        booksId = row ? row.id : null;
      }
      result = mods.books.recordPayment(db, {
        student_id: data.studentId, student_books_id: booksId,
        amount, payment_date: paymentDate, payment_method: method,
        reference: reference || null, received_by: receivedBy, notes,
      });
      if (result.ok) { result.source = 'books'; result.id = result.payment_id; }
    } else if (posts === 'canteen') {
      result = mods.canteen.recordPayment(db, {
        student_id: data.studentId, term_id: termId, amount,
        payment_date: paymentDate, payment_method: method,
        received_by: receivedBy, notes,
      });
      if (result.ok) result.source = 'canteen';
    } else if (posts === 'transport') {
      result = mods.transport.recordPayment(db, {
        student_id: data.studentId, term_id: termId, amount,
        payment_date: paymentDate, payment_method: method,
        received_by: receivedBy, notes,
      });
      if (result.ok) result.source = 'transport';
    } else {
      return { ok: false, error: 'That is not something the school takes money for.' };
    }
  } catch (e) {
    return { ok: false, error: `The payment could not be recorded: ${String((e && e.message) || e)}` };
  }

  if (!result || !result.ok) return result || { ok: false, error: 'The payment could not be recorded.' };

  const paymentId = result.id || result.payment_id;
  const receipt = receiptModel(db, result.source, paymentId, { purpose: purpose.key });
  return {
    ok: true,
    source: result.source,
    payment_id: paymentId,
    receipt_number: result.receipt_number,
    delivered: result.delivered || [],
    receipt: receipt.ok ? receipt.receipt : null,
  };
}

/** Everything a receipt prints, gathered once so screen and paper agree. */
function receiptModel(db, source, paymentId, extra = {}) {
  const engine = require('./receipts_engine');
  const model = engine.buildReceiptModel(db, source, paymentId);
  if (!model) return { ok: false, error: 'That receipt no longer exists.' };

  const school = engine.schoolInfo(db);
  const purpose = PURPOSES.find(p => p.key === (extra.purpose || sourceToPurpose(source)));

  return {
    ok: true,
    receipt: {
      ...model,
      source,
      payment_id: paymentId,
      purpose: purpose ? purpose.key : source,
      purpose_label: purpose ? purpose.label : source,
      amount_in_words: engine.amountInWords(model.amount),
      paper_size: getSetting(db, 'receipt_paper_size', 'roll80'),
      school: {
        name: school.name, motto: school.motto, address: school.address,
        phone: school.phone, email: school.email,
        primary: school.primary, accent: school.accent,
        logo: school.logoData, footer: school.footer,
      },
    },
  };
}

function sourceToPurpose(source) {
  return { fees: 'school_fees', books: 'books', canteen: 'canteen', transport: 'transport' }[source] || source;
}

/** The day's takings, across every purpose, filtered the way a bursar asks. */
function paymentRegister(db, filters = {}) {
  const from = filters.from || null;
  const to = filters.to || null;
  const purposes = Array.isArray(filters.purposes) && filters.purposes.length
    ? filters.purposes : null;
  const rows = [];

  const between = (col) => `(? IS NULL OR ${col} >= ?) AND (? IS NULL OR ${col} <= ?)`;
  const dateParams = [from, from, to, to];

  const want = (key) => !purposes || purposes.includes(key);

  if (want('school_fees') || want('extra_charges')) {
    rows.push(...db.prepare(`
      SELECT p.id, p.receipt_number, p.amount, p.payment_date, p.payment_method, p.reference,
             p.notes, 'fees' AS source,
             s.index_number, s.surname, s.first_name, c.name AS class_name,
             u.full_name AS received_by_name
      FROM payments p
      JOIN students s ON s.id = p.student_id
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      LEFT JOIN users u ON u.id = p.received_by
      WHERE COALESCE(p.is_reversed, 0) = 0 AND ${between('p.payment_date')}
      ORDER BY p.payment_date DESC, p.id DESC LIMIT 500`).all(...dateParams));
  }
  if (want('books')) {
    rows.push(...db.prepare(`
      SELECT bp.id, bp.receipt_number, bp.amount, bp.payment_date, bp.payment_method, bp.reference,
             bp.notes, 'books' AS source,
             s.index_number, s.surname, s.first_name, c.name AS class_name,
             u.full_name AS received_by_name
      FROM books_payments bp
      JOIN students s ON s.id = bp.student_id
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      LEFT JOIN users u ON u.id = bp.received_by
      WHERE ${between('bp.payment_date')}
      ORDER BY bp.payment_date DESC, bp.id DESC LIMIT 500`).all(...dateParams));
  }
  if (want('canteen')) {
    try {
      rows.push(...db.prepare(`
        SELECT cp.id, cp.receipt_number, cp.amount, cp.payment_date,
               'Cash' AS payment_method, NULL AS reference, cp.notes, 'canteen' AS source,
               s.index_number, s.surname, s.first_name, c.name AS class_name,
               u.full_name AS received_by_name
        FROM canteen_payments cp
        JOIN students s ON s.id = cp.student_id
        LEFT JOIN class_groups c ON c.id = s.current_class_id
        LEFT JOIN users u ON u.id = cp.received_by
        WHERE ${between('cp.payment_date')}
        ORDER BY cp.payment_date DESC, cp.id DESC LIMIT 500`).all(...dateParams));
    } catch (_) { /* no canteen */ }
  }
  if (want('transport')) {
    try {
      rows.push(...db.prepare(`
        SELECT tp.id, tp.receipt_number, tp.amount, tp.payment_date, tp.payment_method,
               NULL AS reference, tp.notes, 'transport' AS source,
               s.index_number, s.surname, s.first_name, c.name AS class_name,
               u.full_name AS received_by_name
        FROM transport_payments tp
        JOIN students s ON s.id = tp.student_id
        LEFT JOIN class_groups c ON c.id = s.current_class_id
        LEFT JOIN users u ON u.id = tp.received_by
        WHERE ${between('tp.payment_date')}
        ORDER BY tp.payment_date DESC, tp.id DESC LIMIT 500`).all(...dateParams));
    } catch (_) { /* no bus */ }
  }

  let list = rows.sort((a, b) =>
    String(b.payment_date).localeCompare(String(a.payment_date)) || b.id - a.id);

  if (filters.classId) {
    const klass = db.prepare('SELECT name FROM class_groups WHERE id = ?').get(filters.classId);
    if (klass) list = list.filter(r => r.class_name === klass.name);
  }
  if (filters.method) list = list.filter(r => r.payment_method === filters.method);
  const q = String(filters.q || '').trim().toLowerCase();
  if (q) {
    list = list.filter(r => `${r.surname} ${r.first_name} ${r.index_number} ${r.receipt_number}`
      .toLowerCase().includes(q));
  }

  return {
    ok: true,
    payments: list.slice(0, 400),
    total: Math.round(list.reduce((n, r) => n + (Number(r.amount) || 0), 0) * 100) / 100,
    count: list.length,
  };
}

function money(n) {
  return 'GHS ' + (Number(n) || 0).toFixed(2);
}

// A module the school has not switched on has no tables. Asking it a question
// is legitimate; the answer is "nothing", not a crash that takes the desk down.
function safeRow(db, sql, params) {
  try { return db.prepare(sql).get(...params) || {}; } catch (_) { return {}; }
}
function safeValue(db, sql, params) {
  try { const r = db.prepare(sql).get(...params); return r ? r.t : 0; } catch (_) { return 0; }
}

module.exports.PURPOSES = PURPOSES;
module.exports.METHODS = METHODS;
module.exports.REFERENCE_REQUIRED = REFERENCE_REQUIRED;
module.exports.enabledPurposes = enabledPurposes;
module.exports.findStudents = findStudents;
module.exports.studentAccount = studentAccount;
module.exports.takePayment = takePayment;
module.exports.receiptModel = receiptModel;
module.exports.paymentRegister = paymentRegister;
