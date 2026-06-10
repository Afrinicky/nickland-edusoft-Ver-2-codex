// Fees IPC handlers — fee templates, bill generation, payments, arrears.
const { getNextReceiptNumber } = require('../utils/idgen');

function registerFeesHandlers(ipcMain, db) {
  // ===== Templates =====
  ipcMain.handle('fees:list-templates', () => {
    return db.prepare(`
      SELECT ft.*, c.name AS class_name, t.label AS term_label
      FROM fee_templates ft
      LEFT JOIN class_groups c ON c.id = ft.class_group_id
      LEFT JOIN terms t ON t.id = ft.term_id
      ORDER BY ft.created_at DESC
    `).all();
  });

  ipcMain.handle('fees:get-template', (_e, id) => {
    const template = db.prepare('SELECT * FROM fee_templates WHERE id = ?').get(id);
    if (!template) return null;
    template.items = db.prepare(`
      SELECT * FROM fee_line_items WHERE fee_template_id = ? ORDER BY item_number
    `).all(id);
    return template;
  });

  ipcMain.handle('fees:save-template', (_e, data) => {
    const tx = db.transaction(() => {
      let templateId = data.id;
      if (templateId) {
        db.prepare(`
          UPDATE fee_templates SET name = ?, class_group_id = ?, term_id = ?, is_active = ?
          WHERE id = ?
        `).run(data.name, data.class_group_id || null, data.term_id || null,
          data.is_active ?? 1, templateId);
        db.prepare('DELETE FROM fee_line_items WHERE fee_template_id = ?').run(templateId);
      } else {
        const result = db.prepare(`
          INSERT INTO fee_templates (name, class_group_id, term_id, is_active)
          VALUES (?, ?, ?, ?)
        `).run(data.name, data.class_group_id || null, data.term_id || null, data.is_active ?? 1);
        templateId = result.lastInsertRowid;
      }
      const ins = db.prepare(`
        INSERT INTO fee_line_items (fee_template_id, item_number, description, amount, is_optional, category)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      (data.items || []).forEach((item, i) => {
        ins.run(templateId, item.item_number || (i + 1), item.description,
          item.amount || 0, item.is_optional ? 1 : 0, item.category || '');
      });
      return templateId;
    });
    const id = tx();
    return { ok: true, id };
  });

  ipcMain.handle('fees:delete-template', (_e, id) => {
    db.prepare('DELETE FROM fee_templates WHERE id = ?').run(id);
    return { ok: true };
  });

  // ===== Bill generation =====
  ipcMain.handle('fees:generate-bill', (_e, { studentId, termId }) => {
    return generateBillForStudent(db, studentId, termId);
  });

  ipcMain.handle('fees:generate-bulk', (_e, scope) => {
    // scope: { termId, scope: 'all' | 'class' | 'owing' | 'selected', classId?, studentIds? }
    let students = [];
    if (scope.scope === 'all') {
      students = db.prepare("SELECT id FROM students WHERE status = 'Active'").all();
    } else if (scope.scope === 'class' && scope.classId) {
      students = db.prepare(
        "SELECT id FROM students WHERE status = 'Active' AND current_class_id = ?"
      ).all(scope.classId);
    } else if (scope.scope === 'owing') {
      students = db.prepare(`
        SELECT DISTINCT s.id FROM students s
        JOIN student_bills b ON b.student_id = s.id
        WHERE s.status = 'Active' AND b.balance > 0
      `).all();
    } else if (scope.scope === 'selected' && scope.studentIds) {
      students = scope.studentIds.map(id => ({ id }));
    }
    let count = 0;
    for (const s of students) {
      try { generateBillForStudent(db, s.id, scope.termId); count++; }
      catch (e) { /* skip on error */ }
    }
    return { ok: true, generated: count };
  });

  ipcMain.handle('fees:list-bills', (_e, filters = {}) => {
    let sql = `
      SELECT b.*, s.index_number, s.surname, s.first_name, s.other_names,
             c.name AS class_name, t.label AS term_label
      FROM student_bills b
      JOIN students s ON s.id = b.student_id
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      JOIN terms t ON t.id = b.term_id
      WHERE 1=1
    `;
    const params = [];
    if (filters.termId) { sql += ' AND b.term_id = ?'; params.push(filters.termId); }
    if (filters.classId) { sql += ' AND s.current_class_id = ?'; params.push(filters.classId); }
    if (filters.studentId) { sql += ' AND b.student_id = ?'; params.push(filters.studentId); }
    if (filters.owing) { sql += ' AND b.balance > 0'; }
    sql += ' ORDER BY s.surname, s.first_name';
    return db.prepare(sql).all(...params);
  });

  ipcMain.handle('fees:get-bill', (_e, id) => {
    const bill = db.prepare(`
      SELECT b.*, s.index_number, s.surname, s.first_name, s.other_names,
             c.name AS class_name, t.label AS term_label, t.start_date AS term_start, t.end_date AS term_end,
             t.term_number, t.academic_year_id, y.label AS year_label
      FROM student_bills b
      JOIN students s ON s.id = b.student_id
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      JOIN terms t ON t.id = b.term_id
      LEFT JOIN academic_years y ON y.id = t.academic_year_id
      WHERE b.id = ?
    `).get(id);
    if (!bill) return null;
    bill.items = db.prepare(
      'SELECT * FROM bill_line_items WHERE student_bill_id = ? ORDER BY item_number'
    ).all(id);
    bill.payments = db.prepare(
      'SELECT * FROM payments WHERE student_bill_id = ? ORDER BY payment_date DESC'
    ).all(id);

    // Look up books bill for the same academic year (for separate display)
    if (bill.academic_year_id) {
      const booksBill = db.prepare(`
        SELECT * FROM student_books WHERE student_id = ? AND academic_year_id = ?
      `).get(bill.student_id, bill.academic_year_id);
      if (booksBill) {
        booksBill.items = db.prepare(
          'SELECT * FROM student_books_items WHERE student_books_id = ? ORDER BY display_order'
        ).all(booksBill.id);
        bill.books_bill = booksBill;
        // Books arrears = unpaid books balance shown on terms 2 and 3
        if ((bill.term_number || 1) > 1) {
          bill.books_arrears_amount = booksBill.balance;
        }
      }
    }

    // Compute applicable discount
    const disc = db.prepare(`
      SELECT * FROM student_discounts
      WHERE student_id = ? AND is_active = 1
        AND (applies_to = 'fees' OR applies_to = 'both')
      LIMIT 1
    `).get(bill.student_id);
    if (disc) {
      const baseAmt = bill.total_billed || bill.total_amount || 0;
      const discAmt = disc.discount_type === 'percent'
        ? Math.round(baseAmt * (disc.discount_value / 100) * 100) / 100
        : Math.min(disc.discount_value, baseAmt);
      bill.discount_amount = discAmt;
      bill.discount_reason = disc.reason;
      bill.discount_label = disc.discount_type === 'percent'
        ? `${disc.discount_value}%`
        : `GHS ${disc.discount_value}`;
    }

    return bill;
  });

  // ===== Payments =====
  ipcMain.handle('fees:record-payment', (_e, data) => {
    const receiptCounter = getNextReceiptNumber(db);
    const year = new Date().getFullYear().toString().slice(-2);
    const receiptNo = `FE/${year}/${String(receiptCounter).padStart(5, '0')}`;
    const payDate = data.payment_date || new Date().toISOString().slice(0, 10);

    const tx = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO payments (student_id, student_bill_id, term_id, amount, payment_date,
          payment_method, reference, received_by, notes, receipt_number)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.student_id, data.student_bill_id || null, data.term_id,
        data.amount, payDate, data.payment_method || 'Cash',
        data.reference || '', data.received_by || null, data.notes || '', receiptNo
      );

      // Update bill balance — using the CORRECT schema columns
      if (data.student_bill_id) {
        db.prepare(`
          UPDATE student_bills SET
            total_paid = total_paid + ?,
            balance = total_billed - (total_paid + ?)
          WHERE id = ?
        `).run(data.amount, data.amount, data.student_bill_id);
      }

      // Auto-record into income ledger — category 'fees' (matches finance summary + audit),
      // with transaction_date set (NOT NULL + queried by audit)
      db.prepare(`
        INSERT INTO income_records
          (receipt_number, category, amount, description, payment_method,
           transaction_date, date, source, student_id, term_id,
           linked_payment_id, recorded_by, is_auto)
        VALUES (?, 'fees', ?, ?, ?, ?, ?, 'student_payment', ?, ?, ?, ?, 1)
      `).run(
        receiptNo, data.amount,
        `School fees payment — ${receiptNo}`,
        data.payment_method || 'Cash', payDate, payDate,
        data.student_id, data.term_id || null,
        result.lastInsertRowid, data.received_by || null
      );

      return result.lastInsertRowid;
    });

    try {
      const paymentId = tx();
      return { ok: true, id: paymentId, receipt_number: receiptNo };
    } catch (e) {
      // Log the failure to the audit trail instead of swallowing it
      try {
        db.prepare(`
          INSERT INTO audit_log (entity_type, entity_id, action, justification, severity)
          VALUES ('payment', ?, 'auto_record_failed', ?, 'high')
        `).run(data.student_id || null, `Fees payment auto-record failed: ${e.message}`);
      } catch (_) {}
      return { ok: false, error: `Payment could not be recorded: ${e.message}` };
    }
  });

  ipcMain.handle('fees:list-payments', (_e, { studentId, termId }) => {
    let sql = `
      SELECT p.*, s.index_number, s.surname, s.first_name
      FROM payments p
      JOIN students s ON s.id = p.student_id
      WHERE 1=1
    `;
    const params = [];
    if (studentId) { sql += ' AND p.student_id = ?'; params.push(studentId); }
    if (termId) { sql += ' AND p.term_id = ?'; params.push(termId); }
    sql += ' ORDER BY p.payment_date DESC, p.id DESC';
    return db.prepare(sql).all(...params);
  });

  ipcMain.handle('fees:debtors-report', (_e, termId) => {
    return db.prepare(`
      SELECT s.id, s.index_number, s.surname, s.first_name, s.other_names,
             c.name AS class_name, b.total_amount, b.paid_amount, b.balance,
             b.generated_date, s.father_contact, s.mother_contact, s.guardian_contact
      FROM student_bills b
      JOIN students s ON s.id = b.student_id
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      WHERE b.term_id = ? AND b.balance > 0 AND s.status = 'Active'
      ORDER BY c.level_order, s.surname, s.first_name
    `).all(termId);
  });
}

function generateBillForStudent(db, studentId, termId) {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
  if (!student) throw new Error('Student not found');

  const term = db.prepare('SELECT * FROM terms WHERE id = ?').get(termId);
  if (!term) throw new Error('Term not found');

  // Find applicable fee template (by class + term, fallback to class only, then term only, then any active)
  let template = db.prepare(`
    SELECT * FROM fee_templates
    WHERE is_active = 1 AND class_group_id = ? AND term_id = ?
    ORDER BY id DESC LIMIT 1
  `).get(student.current_class_id, termId);

  if (!template) {
    template = db.prepare(`
      SELECT * FROM fee_templates
      WHERE is_active = 1 AND class_group_id = ? AND term_id IS NULL
      ORDER BY id DESC LIMIT 1
    `).get(student.current_class_id);
  }
  if (!template) {
    template = db.prepare(`
      SELECT * FROM fee_templates
      WHERE is_active = 1 AND class_group_id IS NULL AND term_id = ?
      ORDER BY id DESC LIMIT 1
    `).get(termId);
  }
  if (!template) {
    throw new Error('No fee template applies to this student/term. Create one in Settings → Fees.');
  }

  const items = db.prepare(`
    SELECT * FROM fee_line_items WHERE fee_template_id = ? ORDER BY item_number
  `).all(template.id);

  // Calculate any unpaid arrears from previous terms (excluding the current term being regenerated)
  const prevArrears = db.prepare(`
    SELECT t.id AS term_id, t.label, b.balance
    FROM student_bills b JOIN terms t ON t.id = b.term_id
    WHERE b.student_id = ? AND b.balance > 0 AND b.term_id != ?
    ORDER BY t.start_date
  `).all(studentId, termId);

  // Apply student discount (fees side) — read the active discount
  const discount = db.prepare(`
    SELECT * FROM student_discounts
    WHERE student_id = ? AND is_active = 1
      AND (applies_to = 'fees' OR applies_to = 'both')
    LIMIT 1
  `).get(studentId);

  // Look up books bill for this academic year — for term 2/3, the books balance becomes "Books Arrears"
  let booksArrearsForThisTerm = 0;
  if (term.academic_year_id && (term.term_number || 1) > 1) {
    const booksRow = db.prepare(`
      SELECT balance FROM student_books
      WHERE student_id = ? AND academic_year_id = ?
    `).get(studentId, term.academic_year_id);
    booksArrearsForThisTerm = booksRow?.balance || 0;
  }

  const tx = db.transaction(() => {
    // Remove any prior bill for this student+term
    const existing = db.prepare(
      'SELECT id FROM student_bills WHERE student_id = ? AND term_id = ?'
    ).get(studentId, termId);
    if (existing) db.prepare('DELETE FROM student_bills WHERE id = ?').run(existing.id);

    // Compute totals BEFORE insert
    let feeSubtotal = items.reduce((s, it) => s + (it.amount || 0), 0);
    let arrearsSubtotal = prevArrears.reduce((s, a) => s + (a.balance || 0), 0);
    const feeSubtotalWithArrears = feeSubtotal + arrearsSubtotal;

    // Compute discount amount applied to fees subtotal (NOT books)
    let discountAmount = 0;
    let discountReason = null;
    if (discount) {
      discountReason = discount.reason;
      if (discount.discount_type === 'percent') {
        discountAmount = Math.round(feeSubtotalWithArrears * (discount.discount_value / 100) * 100) / 100;
      } else {
        discountAmount = Math.min(discount.discount_value, feeSubtotalWithArrears);
      }
    }

    const feesNet = Math.max(0, feeSubtotalWithArrears - discountAmount);
    const totalBilled = feesNet + booksArrearsForThisTerm;

    const result = db.prepare(`
      INSERT INTO student_bills
        (student_id, term_id, template_id, total_billed, total_paid, balance,
         arrears_from_prev, books_arrears, discount_amount, discount_reason)
      VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
    `).run(
      studentId, termId, template.id,
      totalBilled, totalBilled,
      arrearsSubtotal, booksArrearsForThisTerm,
      discountAmount, discountReason
    );
    const billId = result.lastInsertRowid;

    // Insert line items
    const ins = db.prepare(`
      INSERT INTO bill_line_items (student_bill_id, item_number, description, amount, is_arrear, arrear_from_term_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    let itemNo = 1;
    for (const item of items) {
      ins.run(billId, itemNo++, item.description, item.amount, 0, null);
    }
    for (const a of prevArrears) {
      ins.run(billId, itemNo++, `Arrears from ${a.label}`, a.balance, 1, a.term_id);
    }

    return billId;
  });
  const id = tx();
  return { ok: true, id };
}

module.exports = registerFeesHandlers;
