// Nickland Edusoft — Books IPC
// Books are bought at start of academic year; bills appear in Term 1 by default.
// If unpaid, the outstanding balance carries forward to Term 2/Term 3 bills
// as "Books Arrears", visually separated from school fees.
// Copyright © 2026 Nickland Sales. All rights reserved.
const { postIncome } = require('./_ledger');
const { autoReceiptForPayment, autoDeliverReceipt } = require('./receipts_engine');

const { getNextReceiptNumber } = require('../utils/idgen');

// Shared upsert-backed counter — a bare UPDATE silently no-ops when the counter
// row is missing, producing duplicate receipt numbers.
function nextBooksReceipt(db) {
  const n = getNextReceiptNumber(db);
  const year = new Date().getFullYear().toString().slice(-2);
  return `BK/${year}/${String(n).padStart(5, '0')}`;
}

module.exports = function registerBooksHandlers(ipcMain, db) {

  // List all student book records (with student details + payment status)
  ipcMain.handle('books:list', (_e, filters = {}) => {
    let sql = `
      SELECT sb.*,
             s.surname, s.first_name, s.other_names, s.index_number,
             c.name AS class_name, c.short_code,
             y.label AS year_label,
             CASE
               WHEN sb.total_paid >= sb.total_amount THEN 'paid_full'
               WHEN sb.total_paid > 0 THEN 'paid_partial'
               ELSE 'unpaid'
             END AS payment_status
      FROM student_books sb
      JOIN students s ON s.id = sb.student_id
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      LEFT JOIN academic_years y ON y.id = sb.academic_year_id
      WHERE 1=1
    `;
    const params = [];
    if (filters.academicYearId) { sql += ' AND sb.academic_year_id = ?'; params.push(filters.academicYearId); }
    if (filters.classId)        { sql += ' AND s.current_class_id = ?'; params.push(filters.classId); }
    if (filters.status === 'paid_full')    sql += ' AND sb.total_paid >= sb.total_amount AND sb.total_amount > 0';
    if (filters.status === 'paid_partial') sql += ' AND sb.total_paid > 0 AND sb.total_paid < sb.total_amount';
    if (filters.status === 'unpaid')       sql += ' AND (sb.total_paid = 0 OR sb.total_paid IS NULL)';
    sql += ' ORDER BY s.surname, s.first_name';
    return db.prepare(sql).all(...params);
  });

  // Get full books record for a student in a given year (with items + payments)
  ipcMain.handle('books:get', (_e, { studentId, academicYearId }) => {
    const year = academicYearId || db.prepare("SELECT id FROM academic_years WHERE is_current = 1").get()?.id;
    if (!year) return null;

    const book = db.prepare(`
      SELECT sb.*, y.label AS year_label
      FROM student_books sb
      LEFT JOIN academic_years y ON y.id = sb.academic_year_id
      WHERE sb.student_id = ? AND sb.academic_year_id = ?
    `).get(studentId, year);
    if (!book) return null;

    book.items = db.prepare(
      'SELECT * FROM student_books_items WHERE student_books_id = ? ORDER BY display_order, id'
    ).all(book.id);

    book.payments = db.prepare(
      `SELECT bp.*, u.full_name AS received_by_name
       FROM books_payments bp
       LEFT JOIN users u ON u.id = bp.received_by
       WHERE bp.student_id = ? AND bp.student_books_id = ? AND bp.is_reversed = 0
       ORDER BY bp.payment_date DESC, bp.id DESC`
    ).all(studentId, book.id);

    return book;
  });

  // Create or update books record for a student
  ipcMain.handle('books:save', (_e, data) => {
    if (!data.student_id || !data.academic_year_id) {
      return { ok: false, error: 'student_id and academic_year_id required' };
    }
    const existing = db.prepare(
      'SELECT id FROM student_books WHERE student_id = ? AND academic_year_id = ?'
    ).get(data.student_id, data.academic_year_id);

    const totalAmount = (data.items || []).reduce((s, it) => s + (parseFloat(it.amount) || 0), 0);

    let bookId;
    const tx = db.transaction(() => {
      if (existing) {
        db.prepare(`
          UPDATE student_books SET
            class_group_id = ?, total_amount = ?, balance = ? - total_paid,
            notes = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          data.class_group_id || null, totalAmount, totalAmount,
          data.notes || null, existing.id
        );
        bookId = existing.id;
        db.prepare('DELETE FROM student_books_items WHERE student_books_id = ?').run(bookId);
      } else {
        const r = db.prepare(`
          INSERT INTO student_books
            (student_id, academic_year_id, class_group_id, total_amount, total_paid, balance, notes)
          VALUES (?, ?, ?, ?, 0, ?, ?)
        `).run(
          data.student_id, data.academic_year_id,
          data.class_group_id || null, totalAmount, totalAmount, data.notes || null
        );
        bookId = r.lastInsertRowid;
      }
      const insItem = db.prepare(`
        INSERT INTO student_books_items (student_books_id, title, amount, display_order)
        VALUES (?, ?, ?, ?)
      `);
      (data.items || []).forEach((it, i) => {
        insItem.run(bookId, it.title, parseFloat(it.amount) || 0, it.display_order || i);
      });

      // Recompute balance after items reset
      db.prepare(`
        UPDATE student_books SET balance = total_amount - total_paid WHERE id = ?
      `).run(bookId);
    });
    tx();

    return { ok: true, id: bookId };
  });

  // Charge books to a class, several classes, or the whole school.
  //
  // Was class-only and skipped anybody who already had a record, which meant
  // a school that got a title or a price wrong had no way to correct it: the
  // second attempt silently did nothing and the wrong figures stayed on every
  // pupil's account. `replace` rebuilds the charge instead — and, exactly as
  // with the school fees bill, money already received is kept and the balance
  // recomputed, so a parent who has paid is not billed for it again.
  ipcMain.handle('books:generate-for-class', (_e, args = {}) => generateBooks(db, args));

  // Record a books payment
  ipcMain.handle('books:record-payment', (_e, data) => recordBooksPayment(db, data));

  // Get all students in a class with books status for the bulk-pay sheet
  ipcMain.handle('books:class-payment-sheet', (_e, { classId, academicYearId }) => {
    const year = academicYearId || db.prepare("SELECT id FROM academic_years WHERE is_current = 1").get()?.id;
    return db.prepare(`
      SELECT
        s.id AS student_id, s.index_number, s.surname, s.first_name, s.other_names,
        c.name AS class_name, c.short_code,
        sb.id AS student_books_id,
        sb.total_amount AS books_total,
        sb.total_paid AS books_paid,
        sb.balance AS books_balance,
        CASE
          WHEN sb.id IS NULL THEN 'not_billed'
          WHEN sb.total_paid >= sb.total_amount AND sb.total_amount > 0 THEN 'paid_full'
          WHEN sb.total_paid > 0 THEN 'paid_partial'
          ELSE 'unpaid'
        END AS status
      FROM students s
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      LEFT JOIN student_books sb ON sb.student_id = s.id AND sb.academic_year_id = ?
      WHERE s.current_class_id = ? AND s.status = 'Active'
      ORDER BY s.surname, s.first_name
    `).all(year, classId);
  });
};

// ── Recording a books payment ───────────────────────────────────────────────
//
// Lifted out of the IPC handler so the payment desk — which takes money for
// every purpose from one screen — posts books through THIS code rather than a
// second copy. A second copy is how a payment reaches the books balance and
// not the ledger, or the other way round.
function recordBooksPayment(db, data) {
  if (!data.student_id || !data.amount || data.amount <= 0) {
    return { ok: false, error: 'student_id and positive amount required' };
  }
  const receipt = data.receipt_number || nextBooksReceipt(db);
  const today = data.payment_date || new Date().toISOString().slice(0, 10);

  const tx = db.transaction(() => {
    const r = db.prepare(`
      INSERT INTO books_payments
        (student_id, student_books_id, amount, payment_date, payment_method,
         reference, receipt_number, received_by, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.student_id, data.student_books_id || null,
      data.amount, today,
      data.payment_method || 'Cash',
      data.reference || null, receipt,
      data.received_by || null, data.notes || null
    );

    if (data.student_books_id) {
      db.prepare(`
        UPDATE student_books SET
          total_paid = total_paid + ?,
          balance = total_amount - (total_paid + ?),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(data.amount, data.amount, data.student_books_id);
    }

    // Auto-record income via central ledger helper.
    postIncome(db, {
      receipt_number: receipt,
      category: 'books',
      amount: data.amount,
      description: `Books payment — ${data.notes || receipt}`,
      payment_method: data.payment_method || 'Cash',
      reference: data.reference || null,
      date: today,
      source: 'books_payment',
      student_id: data.student_id,
      recorded_by: data.received_by || null,
      is_auto: 1,
    });

    return r.lastInsertRowid;
  });

  const paymentId = tx();
  // A books receipt is a receipt. It was the only payment in the system that
  // produced no durable record and never reached a parent — so a family who
  // paid for textbooks had nothing to show for it but a line in a sheet.
  let receiptRow = null;
  try { receiptRow = autoReceiptForPayment(db, 'books', paymentId); } catch (_) {}
  let delivery = null;
  try { delivery = autoDeliverReceipt(db, 'books', paymentId); } catch (_) {}
  return {
    ok: true, payment_id: paymentId, id: paymentId, receipt_number: receipt,
    receipt_id: receiptRow?.id || null, delivered: delivery?.channels || [],
  };
}

module.exports.recordPayment = recordBooksPayment;

// ── Charging the year's books ───────────────────────────────────────────────
function generateBooks(db, { classId, classIds, scope, academicYearId, items, replace } = {}) {
  const lines = (items || [])
    .filter(i => String(i.title || '').trim())
    .map((i, n) => ({
      title: String(i.title).trim(),
      amount: Math.round((parseFloat(i.amount) || 0) * 100) / 100,
      display_order: i.display_order != null ? i.display_order : n,
    }));
  if (lines.length === 0) return { ok: false, error: 'Add at least one book with a title.' };

  const yearId = academicYearId
    || (db.prepare('SELECT id FROM academic_years WHERE is_current = 1').get() || {}).id;
  if (!yearId) return { ok: false, error: 'No academic year is set.' };

  const allClasses = db.prepare(
    'SELECT id FROM class_groups WHERE is_active = 1 ORDER BY level_order').all().map(c => c.id);
  let targets;
  if (scope === 'school') targets = allClasses;
  else if (Array.isArray(classIds) && classIds.length) targets = classIds.map(Number).filter(Boolean);
  else if (classId) targets = [Number(classId)];
  else targets = allClasses;

  const marks = targets.map(() => '?').join(',');
  const students = targets.length
    ? db.prepare(`SELECT id, current_class_id FROM students
                  WHERE status = 'Active' AND current_class_id IN (${marks})
                  ORDER BY surname, first_name`).all(...targets)
    : [];
  if (!students.length) return { ok: false, error: 'There is nobody active in that scope.' };

  const total = Math.round(lines.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  let created = 0;
  let updated = 0;
  let skipped = 0;

  const tx = db.transaction(() => {
    const insItem = db.prepare(
      'INSERT INTO student_books_items (student_books_id, title, amount, display_order) VALUES (?, ?, ?, ?)');

    for (const st of students) {
      const existing = db.prepare(
        'SELECT * FROM student_books WHERE student_id = ? AND academic_year_id = ?'
      ).get(st.id, yearId);

      if (existing && !replace) { skipped += 1; continue; }

      if (existing) {
        // Rebuild the charge in place. The row is UPDATEd rather than deleted
        // so every books payment that points at it stays pointing at it, and
        // what has been received is re-derived from the payments table rather
        // than reset — a parent who paid GHS 200 of 440 owes 100 after the
        // charge is corrected to 300, not 300 again.
        db.prepare('DELETE FROM student_books_items WHERE student_books_id = ?').run(existing.id);
        lines.forEach(l => insItem.run(existing.id, l.title, l.amount, l.display_order));
        const paid = db.prepare(
          'SELECT COALESCE(SUM(amount), 0) AS t FROM books_payments WHERE student_books_id = ?'
        ).get(existing.id).t || 0;
        db.prepare(`
          UPDATE student_books
             SET class_group_id = ?, total_amount = ?, total_paid = ?, balance = ?,
                 updated_at = CURRENT_TIMESTAMP
           WHERE id = ?
        `).run(st.current_class_id, total, Math.round(paid * 100) / 100,
          Math.round((total - paid) * 100) / 100, existing.id);
        updated += 1;
        continue;
      }

      const r = db.prepare(`
        INSERT INTO student_books
          (student_id, academic_year_id, class_group_id, total_amount, total_paid, balance)
        VALUES (?, ?, ?, ?, 0, ?)
      `).run(st.id, yearId, st.current_class_id, total, total);
      lines.forEach(l => insItem.run(r.lastInsertRowid, l.title, l.amount, l.display_order));
      created += 1;
    }
  });
  tx();

  return { ok: true, created, updated, skipped, per_pupil: total, students: students.length };
}

module.exports.generateBooks = generateBooks;
