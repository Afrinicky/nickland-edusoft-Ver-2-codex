// Nickland Edusoft — Central Finance Ledger
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Single source of truth for posting money movements into the finance
// ledger (income_records / expense_records). EVERY module that collects
// or pays out money — fees, bulk-pay, canteen, books, payroll, salary —
// posts through the helpers here instead of hand-writing INSERTs.
//
// Why this exists: previously each module wrote its own INSERT with a
// different column set. Several forgot `transaction_date` (a NOT NULL
// column → the whole payment transaction rolled back) or `term_id`
// (→ the income never showed up in the Finance tab, which filters by
// term). Centralising the posting logic makes finance accurate and
// robust: transaction_date is always set, and term_id / academic_year_id
// are always resolved from the transaction date so a payment can never
// "fall through the cracks" of a term-scoped report.

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Resolve the term (and its academic year) that a given date belongs to.
// Priority: (1) the term whose [start_date, end_date] contains the date,
// (2) the current term, (3) the most recent term. This means a payment
// taken on a day that isn't inside any term window (e.g. during vacation)
// is still attributed to the nearest sensible term rather than vanishing.
function resolveTermForDate(db, date) {
  const d = date || todayISO();
  let term = db.prepare(`
    SELECT * FROM terms
    WHERE start_date IS NOT NULL AND end_date IS NOT NULL
      AND date(start_date) <= date(?) AND date(end_date) >= date(?)
    ORDER BY date(start_date) DESC LIMIT 1
  `).get(d, d);
  if (!term) term = db.prepare('SELECT * FROM terms WHERE is_current = 1').get();
  if (!term) {
    // Nearest term by start date to the payment date
    term = db.prepare(`
      SELECT *, ABS(julianday(COALESCE(start_date, ?)) - julianday(?)) AS gap
      FROM terms ORDER BY gap ASC LIMIT 1
    `).get(d, d);
  }
  return term || null;
}

// Post an income record. Returns the income_records id (existing or new).
// Idempotent: if a record for the same linked payment already exists, the
// existing id is returned instead of creating a duplicate.
function postIncome(db, rec) {
  const date = rec.date || rec.transaction_date || todayISO();

  // De-duplicate against an already-posted income for the same source row.
  if (rec.linked_payment_id) {
    const ex = db.prepare('SELECT id FROM income_records WHERE linked_payment_id = ?').get(rec.linked_payment_id);
    if (ex) return ex.id;
  }
  if (rec.linked_canteen_payment_id) {
    const ex = db.prepare('SELECT id FROM income_records WHERE linked_canteen_payment_id = ?').get(rec.linked_canteen_payment_id);
    if (ex) return ex.id;
  }
  if (rec.receipt_number) {
    const ex = db.prepare('SELECT id FROM income_records WHERE receipt_number = ?').get(rec.receipt_number);
    if (ex) return ex.id;
  }

  let termId = rec.term_id;
  let yearId = rec.academic_year_id;
  if (termId == null || yearId == null) {
    const term = resolveTermForDate(db, date);
    if (termId == null) termId = term ? term.id : null;
    if (yearId == null) yearId = term ? term.academic_year_id : null;
  }

  const r = db.prepare(`
    INSERT INTO income_records
      (receipt_number, category, subcategory, amount, payer_name, description,
       payment_method, reference, transaction_date, date, source,
       linked_payment_id, linked_canteen_payment_id, academic_year_id, term_id,
       recorded_by, student_id, staff_id, is_auto)
    VALUES
      (@receipt_number, @category, @subcategory, @amount, @payer_name, @description,
       @payment_method, @reference, @transaction_date, @date, @source,
       @linked_payment_id, @linked_canteen_payment_id, @academic_year_id, @term_id,
       @recorded_by, @student_id, @staff_id, @is_auto)
  `).run({
    receipt_number: rec.receipt_number || null,
    category: rec.category || 'other',
    subcategory: rec.subcategory || null,
    amount: rec.amount,
    payer_name: rec.payer_name || null,
    description: rec.description || null,
    payment_method: rec.payment_method || 'Cash',
    reference: rec.reference || null,
    transaction_date: date,
    date,
    source: rec.source || null,
    linked_payment_id: rec.linked_payment_id || null,
    linked_canteen_payment_id: rec.linked_canteen_payment_id || null,
    academic_year_id: yearId || null,
    term_id: termId || null,
    recorded_by: rec.recorded_by || null,
    student_id: rec.student_id || null,
    staff_id: rec.staff_id || null,
    is_auto: rec.is_auto ? 1 : 0,
  });
  return r.lastInsertRowid;
}

// Post an expense record. Idempotent on linked_salary_id / transaction_number.
function postExpense(db, rec) {
  const date = rec.date || rec.transaction_date || todayISO();

  if (rec.linked_salary_id) {
    const ex = db.prepare('SELECT id FROM expense_records WHERE linked_salary_id = ?').get(rec.linked_salary_id);
    if (ex) return ex.id;
  }
  if (rec.transaction_number) {
    const ex = db.prepare('SELECT id FROM expense_records WHERE transaction_number = ?').get(rec.transaction_number);
    if (ex) return ex.id;
  }

  let termId = rec.term_id;
  let yearId = rec.academic_year_id;
  if (termId == null || yearId == null) {
    const term = resolveTermForDate(db, date);
    if (termId == null) termId = term ? term.id : null;
    if (yearId == null) yearId = term ? term.academic_year_id : null;
  }

  const r = db.prepare(`
    INSERT INTO expense_records
      (transaction_number, category, subcategory, amount, payee_name, paid_to,
       description, payment_method, reference, transaction_date, date,
       linked_salary_id, academic_year_id, term_id, approved_by, recorded_by, is_auto)
    VALUES
      (@transaction_number, @category, @subcategory, @amount, @payee_name, @paid_to,
       @description, @payment_method, @reference, @transaction_date, @date,
       @linked_salary_id, @academic_year_id, @term_id, @approved_by, @recorded_by, @is_auto)
  `).run({
    transaction_number: rec.transaction_number || null,
    category: rec.category || 'other',
    subcategory: rec.subcategory || null,
    amount: rec.amount,
    payee_name: rec.payee_name || rec.paid_to || null,
    paid_to: rec.paid_to || rec.payee_name || null,
    description: rec.description || '',
    payment_method: rec.payment_method || 'Cash',
    reference: rec.reference || null,
    transaction_date: date,
    date,
    linked_salary_id: rec.linked_salary_id || null,
    academic_year_id: yearId || null,
    term_id: termId || null,
    approved_by: rec.approved_by || null,
    recorded_by: rec.recorded_by || null,
    is_auto: rec.is_auto ? 1 : 0,
  });
  return r.lastInsertRowid;
}

// Next sequential number for a receipt/transaction using a settings counter.
function nextCounter(db, key, prefix) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  const n = parseInt(row ? row.value : '1', 10);
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(String(n + 1), key);
  const yy = new Date().getFullYear().toString().slice(-2);
  return `${prefix}/${yy}/${String(n).padStart(5, '0')}`;
}

// ── Reconciliation ────────────────────────────────────────
// Repairs historical data so the finance ledger matches the source-of-truth
// payment tables. Run at startup (idempotent). This is what fixes money that
// was collected before the posting bugs were resolved: every fee / canteen /
// books payment and every paid salary is guaranteed a matching ledger row,
// and existing ledger rows get their term_id / academic_year_id backfilled.
function reconcileLedger(db) {
  const stats = { income_created: 0, expense_created: 0, income_tagged: 0, expense_tagged: 0 };
  const run = db.transaction(() => {
    // 1a. Backfill transaction_date where an old INSERT left it as the `date`.
    db.prepare("UPDATE income_records SET transaction_date = date WHERE (transaction_date IS NULL OR transaction_date = '') AND date IS NOT NULL").run();
    db.prepare("UPDATE expense_records SET transaction_date = date WHERE (transaction_date IS NULL OR transaction_date = '') AND date IS NOT NULL").run();
    db.prepare("UPDATE expense_records SET date = transaction_date WHERE (date IS NULL OR date = '') AND transaction_date IS NOT NULL").run();

    // 1b. Backfill term_id / academic_year_id on ledger rows that are missing them.
    const untaggedInc = db.prepare("SELECT id, COALESCE(transaction_date, date) AS d FROM income_records WHERE term_id IS NULL").all();
    for (const row of untaggedInc) {
      const term = resolveTermForDate(db, row.d);
      if (term) {
        db.prepare('UPDATE income_records SET term_id = ?, academic_year_id = COALESCE(academic_year_id, ?) WHERE id = ?')
          .run(term.id, term.academic_year_id, row.id);
        stats.income_tagged++;
      }
    }
    const untaggedExp = db.prepare("SELECT id, COALESCE(transaction_date, date) AS d FROM expense_records WHERE term_id IS NULL").all();
    for (const row of untaggedExp) {
      const term = resolveTermForDate(db, row.d);
      if (term) {
        db.prepare('UPDATE expense_records SET term_id = ?, academic_year_id = COALESCE(academic_year_id, ?) WHERE id = ?')
          .run(term.id, term.academic_year_id, row.id);
        stats.expense_tagged++;
      }
    }

    // 2. Fee payments without a matching income row.
    const feePayments = db.prepare(`
      SELECT p.* FROM payments p
      WHERE COALESCE(p.is_reversed, 0) = 0
        AND NOT EXISTS (
          SELECT 1 FROM income_records ir
          WHERE ir.linked_payment_id = p.id
             OR (ir.receipt_number IS NOT NULL AND ir.receipt_number = p.receipt_number)
        )
    `).all();
    for (const p of feePayments) {
      postIncome(db, {
        receipt_number: p.receipt_number,
        category: 'fees',
        amount: p.amount,
        description: `School fees payment — ${p.receipt_number || ''}`.trim(),
        payment_method: p.payment_method || 'Cash',
        reference: p.reference || null,
        date: p.payment_date,
        source: 'student_payment',
        student_id: p.student_id,
        term_id: p.term_id || null,
        linked_payment_id: p.id,
        recorded_by: p.received_by || null,
        is_auto: 1,
      });
      stats.income_created++;
    }

    // 3. Canteen payments without a matching income row.
    const canteenPayments = db.prepare(`
      SELECT cp.* FROM canteen_payments cp
      WHERE NOT EXISTS (
        SELECT 1 FROM income_records ir WHERE ir.linked_canteen_payment_id = cp.id
      )
    `).all();
    for (const cp of canteenPayments) {
      postIncome(db, {
        category: 'canteen',
        amount: cp.amount,
        description: `Canteen payment — ${cp.days_covered || 0} day(s)`,
        payment_method: 'Cash',
        date: cp.payment_date,
        source: 'canteen_payment',
        student_id: cp.student_id,
        term_id: cp.term_id || null,
        linked_canteen_payment_id: cp.id,
        recorded_by: cp.received_by || null,
        is_auto: 1,
      });
      stats.income_created++;
    }

    // 4. Books payments without a matching income row (matched by receipt).
    const booksPayments = db.prepare(`
      SELECT bp.* FROM books_payments bp
      WHERE COALESCE(bp.is_reversed, 0) = 0
        AND NOT EXISTS (
          SELECT 1 FROM income_records ir
          WHERE ir.receipt_number IS NOT NULL AND ir.receipt_number = bp.receipt_number
        )
    `).all();
    for (const bp of booksPayments) {
      postIncome(db, {
        receipt_number: bp.receipt_number,
        category: 'books',
        amount: bp.amount,
        description: `Books payment — ${bp.receipt_number || ''}`.trim(),
        payment_method: bp.payment_method || 'Cash',
        reference: bp.reference || null,
        date: bp.payment_date,
        source: 'books_payment',
        student_id: bp.student_id,
        linked_payment_id: null,
        recorded_by: bp.received_by || null,
        is_auto: 1,
      });
      stats.income_created++;
    }

    // 5. Paid salaries without a matching expense row.
    const paidSalaries = db.prepare(`
      SELECT ss.*, s.surname, s.first_name FROM staff_salaries ss
      JOIN staff s ON s.id = ss.staff_id
      WHERE ss.is_paid = 1 AND COALESCE(ss.actual_amount_paid, 0) > 0
        AND NOT EXISTS (
          SELECT 1 FROM expense_records er WHERE er.linked_salary_id = ss.id
        )
    `).all();
    for (const ss of paidSalaries) {
      postExpense(db, {
        category: 'salary',
        amount: ss.actual_amount_paid,
        description: `Salary ${ss.month}/${ss.year}`,
        payee_name: `${ss.surname} ${ss.first_name}`.trim(),
        payment_method: ss.payment_method || 'Bank',
        reference: ss.payment_reference || null,
        date: ss.payment_date || todayISO(),
        linked_salary_id: ss.id,
        is_auto: 1,
      });
      stats.expense_created++;
    }
  });
  try { run(); } catch (e) { /* never block startup on reconcile */ }
  return stats;
}

module.exports = { postIncome, postExpense, resolveTermForDate, reconcileLedger, nextCounter, todayISO };
