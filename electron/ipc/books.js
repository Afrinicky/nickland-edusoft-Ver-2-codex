// Nickland Edusoft — Books IPC
// Books are bought at start of academic year; bills appear in Term 1 by default.
// If unpaid, the outstanding balance carries forward to Term 2/Term 3 bills
// as "Books Arrears", visually separated from school fees.
// Copyright © 2026 Nickland Sales. All rights reserved.

function nextBooksReceipt(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'receipt_counter'").get();
  const n = parseInt(row?.value || '1', 10);
  db.prepare("UPDATE settings SET value = ? WHERE key = 'receipt_counter'").run(String(n + 1));
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

  // Generate books records for all students in a class (bulk template)
  ipcMain.handle('books:generate-for-class', (_e, { classId, academicYearId, items }) => {
    if (!items || items.length === 0) return { ok: false, error: 'no items provided' };
    const students = db.prepare(`
      SELECT id FROM students WHERE current_class_id = ? AND status = 'Active'
    `).all(classId);
    let created = 0;
    const tx = db.transaction(() => {
      for (const st of students) {
        const totalAmount = items.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0);
        const existing = db.prepare(
          'SELECT id FROM student_books WHERE student_id = ? AND academic_year_id = ?'
        ).get(st.id, academicYearId);
        if (existing) continue;
        const r = db.prepare(`
          INSERT INTO student_books
            (student_id, academic_year_id, class_group_id, total_amount, total_paid, balance)
          VALUES (?, ?, ?, ?, 0, ?)
        `).run(st.id, academicYearId, classId, totalAmount, totalAmount);
        const insItem = db.prepare(
          'INSERT INTO student_books_items (student_books_id, title, amount, display_order) VALUES (?, ?, ?, ?)'
        );
        items.forEach((it, i) => {
          insItem.run(r.lastInsertRowid, it.title, parseFloat(it.amount) || 0, it.display_order || i);
        });
        created++;
      }
    });
    tx();
    return { ok: true, created };
  });

  // Record a books payment
  ipcMain.handle('books:record-payment', (_e, data) => {
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

      // Auto-record income
      try {
        const incRow = db.prepare("SELECT value FROM settings WHERE key = 'receipt_counter'").get();
        db.prepare(`
          INSERT INTO income_records
            (receipt_number, category, amount, description,
             payment_method, transaction_date, date, student_id,
             recorded_by, is_auto)
          VALUES (?, 'books', ?, ?, ?, ?, ?, ?, ?, 1)
        `).run(
          receipt, data.amount,
          `Books payment — ${data.notes || receipt}`,
          data.payment_method || 'Cash', today, today,
          data.student_id, data.received_by || null
        );
      } catch (e) {
        try {
          db.prepare(`
            INSERT INTO audit_log (entity_type, entity_id, action, justification, severity)
            VALUES ('books_payment', ?, 'auto_record_failed', ?, 'high')
          `).run(data.student_id || null, `Books income auto-record failed: ${e.message}`);
        } catch (_) {}
      }

      return r.lastInsertRowid;
    });

    const paymentId = tx();
    return { ok: true, payment_id: paymentId, receipt_number: receipt };
  });

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
