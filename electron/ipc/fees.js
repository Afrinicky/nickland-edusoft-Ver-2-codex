// Fees IPC handlers — fee templates, bill generation, payments, arrears.
const { getNextReceiptNumber } = require('../utils/idgen');
const { postIncome } = require('./_ledger');
const { autoReceiptForPayment, autoDeliverReceipt } = require('./receipts_engine');
const billing = require('./_billing');

function registerFeesHandlers(ipcMain, db) {
  // ===== Templates =====
  ipcMain.handle('fees:list-templates', (_e, filters = {}) => {
    let sql = `
      SELECT ft.*, c.name AS class_name, t.label AS term_label,
             COALESCE(ft.bill_type, 'school_fees') AS bill_type,
             (SELECT COUNT(*) FROM fee_line_items li WHERE li.fee_template_id = ft.id) AS item_count,
             (SELECT COALESCE(SUM(amount), 0) FROM fee_line_items li WHERE li.fee_template_id = ft.id) AS total_amount
      FROM fee_templates ft
      LEFT JOIN class_groups c ON c.id = ft.class_group_id
      LEFT JOIN terms t ON t.id = ft.term_id
      WHERE 1=1
    `;
    const params = [];
    if (filters.billType) {
      sql += " AND COALESCE(ft.bill_type, 'school_fees') = ?";
      params.push(filters.billType);
    }
    if (filters.termId) { sql += ' AND (ft.term_id = ? OR ft.term_id IS NULL)'; params.push(filters.termId); }
    sql += ' ORDER BY ft.created_at DESC';
    return db.prepare(sql).all(...params);
  });

  ipcMain.handle('fees:get-template', (_e, id) => {
    const template = db.prepare(`
      SELECT ft.*, COALESCE(ft.bill_type, 'school_fees') AS bill_type,
             c.name AS class_name, t.label AS term_label
      FROM fee_templates ft
      LEFT JOIN class_groups c ON c.id = ft.class_group_id
      LEFT JOIN terms t ON t.id = ft.term_id
      WHERE ft.id = ?
    `).get(id);
    if (!template) return null;
    template.items = billing.templateItems(db, id);
    template.bill_count = db.prepare(
      'SELECT COUNT(*) AS n FROM student_bills WHERE template_id = ?'
    ).get(id).n;
    return template;
  });

  function saveTemplate(data) {
    if (!data || !data.name) return { ok: false, error: 'Template name is required.' };
    const billType = data.bill_type === billing.BILL_TYPES.SUPPLEMENTARY
      ? billing.BILL_TYPES.SUPPLEMENTARY
      : billing.BILL_TYPES.SCHOOL_FEES;

    // "There can't be two school fees in the same term." Rather than silently
    // creating a second school-fees template that shadows the first, hand the
    // clash back so the user can decide: replace it, or make this one a
    // supplementary bill. `confirmReplace` is the caller saying "replace it".
    if (billType === billing.BILL_TYPES.SCHOOL_FEES && !data.confirm_replace) {
      const clash = billing.findConflictingSchoolFeesTemplate(db, {
        id: data.id || null,
        classGroupId: data.class_group_id || null,
        termId: data.term_id || null,
      });
      if (clash) {
        return {
          ok: false,
          code: 'DUPLICATE_SCHOOL_FEES',
          error: `A school fees bill already exists for ${clash.term_label || 'this term'}` +
                 `${clash.class_name ? ` (${clash.class_name})` : ''}: "${clash.name}".`,
          existing: {
            id: clash.id, name: clash.name,
            class_name: clash.class_name, term_label: clash.term_label,
          },
        };
      }
    }

    const tx = db.transaction(() => {
      let templateId = data.id;
      if (templateId) {
        db.prepare(`
          UPDATE fee_templates
             SET name = ?, class_group_id = ?, term_id = ?, is_active = ?,
                 bill_type = ?, notes = ?
           WHERE id = ?
        `).run(data.name, data.class_group_id || null, data.term_id || null,
          data.is_active ?? 1, billType, data.notes || null, templateId);
        db.prepare('DELETE FROM fee_line_items WHERE fee_template_id = ?').run(templateId);
      } else {
        const result = db.prepare(`
          INSERT INTO fee_templates
            (name, class_group_id, term_id, is_active, bill_type, notes, copied_from_template_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(data.name, data.class_group_id || null, data.term_id || null,
          data.is_active ?? 1, billType, data.notes || null, data.copied_from_template_id || null);
        templateId = result.lastInsertRowid;
      }
      const ins = db.prepare(`
        INSERT INTO fee_line_items (fee_template_id, item_number, description, amount, is_optional, category)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      // Blank rows left behind by the editor are dropped rather than billed as
      // an unnamed GHS 0.00 line on every parent's bill.
      (data.items || [])
        .filter(it => it && String(it.description || '').trim())
        .forEach((item, i) => {
          ins.run(templateId, item.item_number || (i + 1), String(item.description).trim(),
            billing.round2(item.amount), item.is_optional ? 1 : 0, item.category || '');
        });

      // Replacing a term's school-fees template retires the old one instead of
      // leaving two active templates fighting over the same (class, term).
      if (billType === billing.BILL_TYPES.SCHOOL_FEES && data.confirm_replace && data.replaces_template_id) {
        db.prepare('UPDATE fee_templates SET is_active = 0 WHERE id = ? AND id != ?')
          .run(data.replaces_template_id, templateId);
      }
      return templateId;
    });
    const id = tx();
    return { ok: true, id };
  }

  ipcMain.handle('fees:save-template', (_e, data) => saveTemplate(data));

  ipcMain.handle('fees:delete-template', (_e, id) => {
    // student_bills.template_id references fee_templates, so deleting a
    // template that has already been billed either fails on the foreign key or
    // orphans the bills. Retire it instead — the bills keep their provenance.
    const used = db.prepare('SELECT COUNT(*) AS n FROM student_bills WHERE template_id = ?').get(id).n;
    if (used > 0) {
      db.prepare('UPDATE fee_templates SET is_active = 0 WHERE id = ?').run(id);
      return {
        ok: true, retired: true,
        message: `This template has already produced ${used} bill${used === 1 ? '' : 's'}, ` +
                 `so it was deactivated rather than deleted. Existing bills are unchanged.`,
      };
    }
    db.prepare('DELETE FROM fee_templates WHERE id = ?').run(id);
    return { ok: true, retired: false };
  });

  // Preset catalogue for the template editor — see _billing.js.
  ipcMain.handle('fees:template-presets', () => billing.FEE_ITEM_PRESETS);

  // ── Reuse last term's bill as this term's template ──────────────────
  // The single most-requested shortcut: schools bill nearly the same schedule
  // every term, so copying forward and editing two amounts beats retyping
  // fifteen line items per class.
  ipcMain.handle('fees:copyable-templates', (_e, { termId } = {}) => {
    return db.prepare(`
      SELECT ft.*, c.name AS class_name, t.label AS term_label, t.term_number,
             y.label AS year_label,
             COALESCE(ft.bill_type, 'school_fees') AS bill_type,
             (SELECT COUNT(*) FROM fee_line_items li WHERE li.fee_template_id = ft.id) AS item_count,
             (SELECT COALESCE(SUM(amount), 0) FROM fee_line_items li WHERE li.fee_template_id = ft.id) AS total_amount
      FROM fee_templates ft
      LEFT JOIN class_groups c ON c.id = ft.class_group_id
      LEFT JOIN terms t ON t.id = ft.term_id
      LEFT JOIN academic_years y ON y.id = t.academic_year_id
      WHERE (? IS NULL OR ft.term_id IS NULL OR ft.term_id != ?)
      ORDER BY ft.created_at DESC
      LIMIT 50
    `).all(termId || null, termId || null);
  });

  ipcMain.handle('fees:copy-template', (_e, { sourceId, name, termId, classGroupId, billType, adjustPercent } = {}) => {
    const source = db.prepare('SELECT * FROM fee_templates WHERE id = ?').get(sourceId);
    if (!source) return { ok: false, error: 'The template being copied no longer exists.' };
    const items = billing.templateItems(db, sourceId);
    if (items.length === 0) return { ok: false, error: 'That template has no line items to copy.' };

    // A flat percentage bump covers the usual "fees went up 15% this year"
    // without re-keying every amount. 0 / omitted copies the amounts as-is.
    const factor = 1 + ((Number(adjustPercent) || 0) / 100);
    return saveTemplate({
      name: name || `${source.name} (copy)`,
      class_group_id: classGroupId ?? source.class_group_id ?? null,
      term_id: termId ?? null,
      bill_type: billType || source.bill_type || billing.BILL_TYPES.SCHOOL_FEES,
      is_active: 1,
      copied_from_template_id: sourceId,
      items: items.map((it, i) => ({
        item_number: it.item_number || (i + 1),
        description: it.description,
        amount: billing.round2((it.amount || 0) * factor),
        is_optional: it.is_optional,
        category: it.category,
      })),
    });
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
    // Failures used to be swallowed entirely, so a school whose template did
    // not cover a class saw "Generated 0 bills" with no idea why. The reasons
    // are counted and returned.
    const problems = new Map();
    for (const s of students) {
      try { generateBillForStudent(db, s.id, scope.termId); count++; }
      catch (e) {
        const msg = String((e && e.message) || e);
        problems.set(msg, (problems.get(msg) || 0) + 1);
      }
    }
    return {
      ok: true,
      generated: count,
      skipped: students.length - count,
      problems: [...problems.entries()].map(([reason, count]) => ({ reason, count })),
    };
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
    // Voided bills are hidden from every default listing. A parent must never
    // be shown, or chased for, a bill the school has withdrawn — only the
    // Proprietor/Administrator review screen asks for them explicitly.
    if (filters.status === 'voided') sql += " AND COALESCE(b.status, 'active') = 'voided'";
    else if (filters.status !== 'all') sql += " AND COALESCE(b.status, 'active') = 'active'";
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

      // Auto-record into the finance ledger via the central posting helper.
      // This guarantees transaction_date + term_id are always set, so the
      // income can never fall out of the term-scoped finance reports.
      postIncome(db, {
        receipt_number: receiptNo,
        category: 'fees',
        amount: data.amount,
        description: `School fees payment — ${receiptNo}`,
        payment_method: data.payment_method || 'Cash',
        reference: data.reference || null,
        date: payDate,
        source: 'student_payment',
        student_id: data.student_id,
        term_id: data.term_id || null,
        linked_payment_id: result.lastInsertRowid,
        recorded_by: data.received_by || null,
        is_auto: 1,
      });

      return result.lastInsertRowid;
    });

    try {
      const paymentId = tx();
      // Auto-generate a durable receipt for every fee payment, and auto-deliver
      // it to the parent by SMS/email if that's enabled in Settings (best-effort).
      let receipt = null;
      try { receipt = autoReceiptForPayment(db, 'fees', paymentId); } catch (_) {}
      let delivery = null;
      try { delivery = autoDeliverReceipt(db, 'fees', paymentId); } catch (_) {}
      return { ok: true, id: paymentId, receipt_number: receiptNo, receipt_id: receipt?.id || null, delivered: delivery?.channels || [] };
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
    // Columns are total_billed / total_paid / generated_at — the previous query
    // selected total_amount / paid_amount / generated_date, none of which exist,
    // so the debtors report threw "no such column" every time it was opened.
    return db.prepare(`
      SELECT s.id, s.index_number, s.surname, s.first_name, s.other_names,
             c.name AS class_name,
             b.total_billed AS total_amount, b.total_paid AS paid_amount, b.balance,
             b.generated_at AS generated_date, s.father_contact, s.mother_contact, s.guardian_contact
      FROM student_bills b
      JOIN students s ON s.id = b.student_id
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      WHERE b.term_id = ? AND b.balance > 0 AND s.status = 'Active'
        AND COALESCE(b.status, 'active') = 'active'
      ORDER BY c.level_order, s.surname, s.first_name
    `).all(termId);
  });
}

function generateBillForStudent(db, studentId, termId) {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
  if (!student) throw new Error('Student not found');

  const term = db.prepare('SELECT * FROM terms WHERE id = ?').get(termId);
  if (!term) throw new Error('Term not found');

  // One resolution order, shared with the dashboard's projection so the two
  // can never disagree: class+term → class → term → global.
  const template = billing.resolveFeeTemplate(db, student.current_class_id, termId);
  if (!template) {
    throw new Error('No fee template applies to this student/term. Create one under Fees → Bills → Fee Templates.');
  }

  const items = billing.templateItems(db, template.id);

  // Calculate any unpaid arrears from previous terms (excluding the current
  // term being regenerated). Voided bills are excluded: a bill the school
  // withdrew must not come back as an arrear on the next term's bill.
  const prevArrears = db.prepare(`
    SELECT t.id AS term_id, t.label, b.balance
    FROM student_bills b JOIN terms t ON t.id = b.term_id
    WHERE b.student_id = ? AND b.balance > 0 AND b.term_id != ?
      AND COALESCE(b.status, 'active') = 'active'
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
    // Re-generating a bill must NEVER discard money already received.
    //
    // This used to DELETE the old bill and INSERT a fresh one with
    // total_paid = 0. Any payment row still referenced the old bill, so with
    // foreign keys enforced the delete failed outright ("FOREIGN KEY constraint
    // failed") and a school simply could not re-issue a bill for a pupil who
    // had paid anything; without enforcement it would have silently wiped the
    // payment off the bill and re-billed the parent for money they had already
    // handed over. The bill row is now updated in place and total_paid is
    // recomputed from the payments table, which is the source of truth.
    const existing = db.prepare(
      'SELECT * FROM student_bills WHERE student_id = ? AND term_id = ?'
    ).get(studentId, termId);

    // A bill the school deliberately withdrew is not silently resurrected by
    // the next "Generate ALL". It has to be restored on purpose.
    if (existing && (existing.status || 'active') === 'voided') {
      throw new Error('This bill was voided. Restore it from Bills → Voided before regenerating.');
    }

    // Supplementary charges already raised on this term's bill (excursion,
    // sports week…) are NOT template-derived, so regenerating the school-fees
    // portion must leave them alone. Rebuilding the whole item list from the
    // template used to erase them and hand the parent a smaller bill than the
    // one they were given.
    const keptExtras = existing
      ? db.prepare(`
          SELECT * FROM bill_line_items
          WHERE student_bill_id = ? AND charge_type = 'extra'
          ORDER BY item_number, id
        `).all(existing.id)
      : [];
    const extrasSubtotal = billing.round2(keptExtras.reduce((s, it) => s + (it.amount || 0), 0));

    const alreadyPaid = billing.round2(db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS t FROM payments
      WHERE student_id = ? AND term_id = ? AND COALESCE(is_reversed, 0) = 0
    `).get(studentId, termId).t || 0);

    // Compute totals BEFORE insert
    const feeSubtotal = billing.round2(items.reduce((s, it) => s + (it.amount || 0), 0));
    const arrearsSubtotal = billing.round2(prevArrears.reduce((s, a) => s + (a.balance || 0), 0));
    const chargeable = billing.round2(feeSubtotal + arrearsSubtotal + extrasSubtotal);

    // Compute discount amount applied to the fees side (NOT books)
    let discountAmount = 0;
    let discountReason = null;
    if (discount) {
      discountReason = discount.reason;
      if (discount.discount_type === 'percent') {
        discountAmount = billing.round2(chargeable * (discount.discount_value / 100));
      } else {
        discountAmount = Math.min(billing.round2(discount.discount_value), chargeable);
      }
    }

    const feesNet = Math.max(0, billing.round2(chargeable - discountAmount));
    const totalBilled = billing.round2(feesNet + booksArrearsForThisTerm);
    const balance = billing.round2(totalBilled - alreadyPaid);

    let billId;
    if (existing) {
      db.prepare(`
        UPDATE student_bills
           SET template_id = ?, total_billed = ?, total_paid = ?, balance = ?,
               arrears_from_prev = ?, books_arrears = ?, supplementary_total = ?,
               discount_amount = ?, discount_reason = ?
         WHERE id = ?
      `).run(
        template.id, totalBilled, alreadyPaid, balance,
        arrearsSubtotal, booksArrearsForThisTerm, extrasSubtotal,
        discountAmount, discountReason, existing.id
      );
      billId = existing.id;
      // Only the template-derived rows are rebuilt; supplementary rows survive.
      db.prepare(
        "DELETE FROM bill_line_items WHERE student_bill_id = ? AND charge_type != 'extra'"
      ).run(billId);
    } else {
      const result = db.prepare(`
        INSERT INTO student_bills
          (student_id, term_id, template_id, total_billed, total_paid, balance,
           arrears_from_prev, books_arrears, supplementary_total,
           discount_amount, discount_reason, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
      `).run(
        studentId, termId, template.id,
        totalBilled, alreadyPaid, balance,
        arrearsSubtotal, booksArrearsForThisTerm, extrasSubtotal,
        discountAmount, discountReason
      );
      billId = result.lastInsertRowid;
    }

    // Insert line items — fees first, then arrears, then the retained extras,
    // renumbered so the printed bill reads 1..n without gaps.
    const ins = db.prepare(`
      INSERT INTO bill_line_items
        (student_bill_id, item_number, description, amount, is_arrear, arrear_from_term_id,
         charge_type, source_template_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const renum = db.prepare('UPDATE bill_line_items SET item_number = ? WHERE id = ?');
    let itemNo = 1;
    for (const item of items) {
      ins.run(billId, itemNo++, item.description, billing.round2(item.amount), 0, null,
        billing.CHARGE_TYPES.FEES, template.id);
    }
    for (const a of prevArrears) {
      ins.run(billId, itemNo++, `Arrears from ${a.label}`, billing.round2(a.balance), 1, a.term_id,
        billing.CHARGE_TYPES.ARREAR, null);
    }
    for (const e of keptExtras) renum.run(itemNo++, e.id);

    return billId;
  });
  const id = tx();
  return { ok: true, id };
}

module.exports = registerFeesHandlers;
