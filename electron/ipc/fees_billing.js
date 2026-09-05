// Nickland Edusoft — Billing administration IPC.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The controversial half of billing: raising in-term supplementary charges,
// and withdrawing a bill that should never have gone out. Both change what a
// parent is told they owe, so both are restricted to the Proprietor and the
// Super Admin, and both leave an audit trail with a stated reason.

const security = require('./_security');
const billing = require('./_billing');

// Voiding/deleting a bill rewrites what a parent was told they owe, so it sits
// above the ordinary fees permission: an Accountant with fees.delete still
// cannot do it.
function requireElevated(db, action) {
  const userId = security.getCurrentUserId();
  if (!security.isElevated(db, userId)) {
    try {
      db.prepare(`
        INSERT INTO audit_log (entity_type, entity_id, action, user_id, justification, severity)
        VALUES ('student_bill', NULL, 'permission_denied', ?, ?, 'high')
      `).run(userId, `Denied ${action}: only the Proprietor or the Super Admin may do this.`);
    } catch (_) { /* auditing must not block the denial */ }
    return {
      ok: false,
      code: 'NOT_ELEVATED',
      error: 'Only the Proprietor or the Super Admin can change or withdraw a bill that has already been issued.',
    };
  }
  return null;
}

function audit(db, billId, action, justification, severity = 'high') {
  try {
    db.prepare(`
      INSERT INTO audit_log (entity_type, entity_id, action, user_id, justification, severity)
      VALUES ('student_bill', ?, ?, ?, ?, ?)
    `).run(billId, action, security.getCurrentUserId(), justification, severity);
  } catch (_) { /* best effort */ }
}

module.exports = function registerFeesBillingHandlers(ipcMain, db) {

  // ── Who is allowed to touch issued bills ─────────────────────────────
  // The renderer asks so it can hide the controls entirely rather than show
  // buttons that will only ever return "access denied". This is a UI hint;
  // every mutating handler below re-checks on the Node side.
  ipcMain.handle('fees:billing-permissions', () => {
    const userId = security.getCurrentUserId();
    return {
      user_id: userId || null,
      designation: security.getCurrentDesignation() || null,
      can_manage_issued_bills: security.isElevated(db, userId),
    };
  });

  // ── Bills hub overview ───────────────────────────────────────────────
  // One call for the Bills tab header: what has been billed this term, how
  // the school-fees schedule is set up, and anything that needs attention.
  ipcMain.handle('fees:billing-overview', (_e, termId) => {
    const term = termId
      ? billing.termWithYear(db, termId)
      : billing.termWithYear(db,
          (db.prepare('SELECT id FROM terms WHERE is_current = 1').get() || {}).id);
    if (!term) return { ok: false, error: 'No current term is set.' };

    const projected = billing.projectedIncomeForTerm(db, term.id);

    const counts = db.prepare(`
      SELECT
        COUNT(*) FILTER (WHERE COALESCE(status, 'active') = 'active') AS active_bills,
        COUNT(*) FILTER (WHERE COALESCE(status, 'active') = 'voided') AS voided_bills,
        COALESCE(SUM(CASE WHEN COALESCE(status, 'active') = 'active' THEN total_paid ELSE 0 END), 0) AS collected,
        COALESCE(SUM(CASE WHEN COALESCE(status, 'active') = 'active' THEN balance   ELSE 0 END), 0) AS outstanding,
        COALESCE(SUM(CASE WHEN COALESCE(status, 'active') = 'active' THEN supplementary_total ELSE 0 END), 0) AS supplementary
      FROM student_bills WHERE term_id = ?
    `).get(term.id);

    // Which school-fees template each class would actually bill from. A class
    // showing "none" is a class whose parents will never receive a bill.
    const classes = db.prepare(
      'SELECT id, name, short_code FROM class_groups WHERE is_active = 1 ORDER BY level_order'
    ).all();
    const coverage = classes.map(c => {
      const tpl = billing.resolveFeeTemplate(db, c.id, term.id);
      const students = db.prepare(
        "SELECT COUNT(*) AS n FROM students WHERE status = 'Active' AND current_class_id = ?"
      ).get(c.id).n;
      const billed = db.prepare(`
        SELECT COUNT(*) AS n FROM student_bills b
        JOIN students s ON s.id = b.student_id
        WHERE b.term_id = ? AND s.current_class_id = ? AND COALESCE(b.status, 'active') = 'active'
      `).get(term.id, c.id).n;
      return {
        class_id: c.id, class_name: c.name, short_code: c.short_code,
        active_students: students,
        billed_students: billed,
        template_id: tpl ? tpl.id : null,
        template_name: tpl ? tpl.name : null,
        // "General" = a catch-all template, not one written for this class/term
        template_scope: tpl ? (tpl.class_group_id ? (tpl.term_id ? 'exact' : 'class') : (tpl.term_id ? 'term' : 'general')) : 'none',
        per_student_amount: tpl ? billing.templateTotal(db, tpl.id) : 0,
      };
    });

    const schoolFeesTemplate = db.prepare(`
      SELECT ft.*, c.name AS class_name, t.label AS term_label, y.label AS year_label,
             (SELECT COALESCE(SUM(amount), 0) FROM fee_line_items li WHERE li.fee_template_id = ft.id) AS total_amount,
             (SELECT COUNT(*) FROM fee_line_items li WHERE li.fee_template_id = ft.id) AS item_count
      FROM fee_templates ft
      LEFT JOIN class_groups c ON c.id = ft.class_group_id
      LEFT JOIN terms t ON t.id = ft.term_id
      LEFT JOIN academic_years y ON y.id = t.academic_year_id
      WHERE ft.is_active = 1 AND COALESCE(ft.bill_type, 'school_fees') = 'school_fees'
        AND (ft.term_id = ? OR ft.term_id IS NULL)
      ORDER BY (ft.term_id IS NULL), ft.id DESC
    `).all(term.id);

    const supplementary = db.prepare(`
      SELECT ft.*, c.name AS class_name, t.label AS term_label, y.label AS year_label,
             (SELECT COALESCE(SUM(amount), 0) FROM fee_line_items li WHERE li.fee_template_id = ft.id) AS total_amount,
             (SELECT COUNT(*) FROM fee_line_items li WHERE li.fee_template_id = ft.id) AS item_count,
             (SELECT COUNT(DISTINCT bli.student_bill_id) FROM bill_line_items bli
               WHERE bli.source_template_id = ft.id AND bli.charge_type = 'extra') AS applied_to
      FROM fee_templates ft
      LEFT JOIN class_groups c ON c.id = ft.class_group_id
      LEFT JOIN terms t ON t.id = ft.term_id
      LEFT JOIN academic_years y ON y.id = t.academic_year_id
      WHERE ft.is_active = 1 AND COALESCE(ft.bill_type, 'school_fees') = 'supplementary'
        AND (ft.term_id = ? OR ft.term_id IS NULL)
      ORDER BY ft.created_at DESC
    `).all(term.id);

    return {
      ok: true,
      term: {
        id: term.id, label: term.label, term_number: term.term_number,
        year_label: term.year_label || null,
        // The name to print in a heading: "Third Term · 2025/2026". A bare
        // "Third Term" is what let a schedule be written against the wrong year.
        full_label: billing.termLabel(term),
      },
      projected,
      counts,
      coverage,
      school_fees_templates: schoolFeesTemplate,
      supplementary_templates: supplementary,
      // The three things that stop a school getting paid, surfaced instead of
      // being left for someone to notice.
      warnings: [
        ...(coverage.filter(c => c.template_scope === 'none' && c.active_students > 0)
          .map(c => ({ level: 'error', message: `${c.class_name}: no school fees schedule covers it for ${billing.termLabel(term)}, so its ${c.active_students} pupil(s) cannot be billed.` }))),
        ...(coverage.filter(c => c.template_scope !== 'none' && c.billed_students < c.active_students)
          .map(c => ({ level: 'warn', message: `${c.class_name}: ${c.active_students - c.billed_students} of ${c.active_students} pupil(s) have no bill for this term yet.` }))),
        ...(schoolFeesTemplate.filter(t => t.term_id === null).length > 1
          ? [{ level: 'warn', message: 'More than one "all terms" school-fees template is active. The most recent one wins — retire the others to avoid confusion.' }]
          : []),
      ],
    };
  });

  // ── Supplementary charges ────────────────────────────────────────────
  // Adds a supplementary template's items onto pupils' existing term bills.
  // Idempotent per (bill, template): applying twice does not charge twice.
  ipcMain.handle('fees:apply-supplementary', (_e, { templateId, termId, scope, classId, studentIds } = {}) => {
    const denied = requireElevated(db, 'apply a supplementary charge');
    if (denied) return denied;

    const tpl = db.prepare('SELECT * FROM fee_templates WHERE id = ?').get(templateId);
    if (!tpl) return { ok: false, error: 'That supplementary bill no longer exists.' };
    if ((tpl.bill_type || 'school_fees') !== billing.BILL_TYPES.SUPPLEMENTARY) {
      return {
        ok: false,
        error: 'Only a supplementary bill can be added on top of a term bill. ' +
               'School fees are billed once per term through Generate Bills.',
      };
    }
    const items = billing.templateItems(db, templateId).filter(i => (i.amount || 0) !== 0 || i.description);
    if (items.length === 0) return { ok: false, error: 'That supplementary bill has no line items.' };

    const term = db.prepare('SELECT * FROM terms WHERE id = ?').get(termId);
    if (!term) return { ok: false, error: 'Term not found.' };

    let bills;
    if (scope === 'class' && classId) {
      bills = db.prepare(`
        SELECT b.id, b.student_id FROM student_bills b
        JOIN students s ON s.id = b.student_id
        WHERE b.term_id = ? AND s.current_class_id = ? AND COALESCE(b.status, 'active') = 'active'
      `).all(termId, classId);
    } else if (scope === 'selected' && Array.isArray(studentIds) && studentIds.length) {
      const marks = studentIds.map(() => '?').join(',');
      bills = db.prepare(`
        SELECT id, student_id FROM student_bills
        WHERE term_id = ? AND COALESCE(status, 'active') = 'active' AND student_id IN (${marks})
      `).all(termId, ...studentIds);
    } else {
      bills = db.prepare(`
        SELECT b.id, b.student_id FROM student_bills b
        JOIN students s ON s.id = b.student_id
        WHERE b.term_id = ? AND s.status = 'Active' AND COALESCE(b.status, 'active') = 'active'
      `).all(termId);
    }
    if (bills.length === 0) {
      return { ok: false, error: 'No term bills matched. Generate the term bills first, then add the extra charge.' };
    }

    const now = new Date().toISOString();
    const userId = security.getCurrentUserId();
    const alreadyOn = db.prepare(`
      SELECT COUNT(*) AS n FROM bill_line_items
      WHERE student_bill_id = ? AND source_template_id = ? AND charge_type = 'extra'
    `);
    const nextNo = db.prepare(
      'SELECT COALESCE(MAX(item_number), 0) AS n FROM bill_line_items WHERE student_bill_id = ?'
    );
    const ins = db.prepare(`
      INSERT INTO bill_line_items
        (student_bill_id, item_number, description, amount, is_arrear, arrear_from_term_id,
         charge_type, source_template_id, added_at, added_by)
      VALUES (?, ?, ?, ?, 0, NULL, 'extra', ?, ?, ?)
    `);

    let applied = 0, skipped = 0, amount = 0;
    const tx = db.transaction(() => {
      for (const b of bills) {
        if (alreadyOn.get(b.id, templateId).n > 0) { skipped++; continue; }
        let no = nextNo.get(b.id).n;
        for (const it of items) {
          ins.run(b.id, ++no, it.description, billing.round2(it.amount), templateId, now, userId);
          amount += billing.round2(it.amount);
        }
        billing.recomputeBillTotals(db, b.id);
        applied++;
      }
    });
    tx();

    audit(db, null, 'supplementary_applied',
      `Applied "${tpl.name}" (GHS ${billing.round2(amount)}) to ${applied} bill(s) for ${term.label}.`, 'medium');

    return { ok: true, applied, skipped, total_amount: billing.round2(amount), template_name: tpl.name };
  });

  ipcMain.handle('fees:remove-supplementary', (_e, { templateId, termId, billId } = {}) => {
    const denied = requireElevated(db, 'remove a supplementary charge');
    if (denied) return denied;

    const targets = billId
      ? db.prepare('SELECT id FROM student_bills WHERE id = ?').all(billId)
      : db.prepare(`
          SELECT DISTINCT b.id FROM student_bills b
          JOIN bill_line_items li ON li.student_bill_id = b.id
          WHERE b.term_id = ? AND li.source_template_id = ? AND li.charge_type = 'extra'
        `).all(termId, templateId);

    const del = db.prepare(
      "DELETE FROM bill_line_items WHERE student_bill_id = ? AND source_template_id = ? AND charge_type = 'extra'"
    );
    let removed = 0;
    const tx = db.transaction(() => {
      for (const t of targets) {
        const r = del.run(t.id, templateId);
        if (r.changes > 0) { billing.recomputeBillTotals(db, t.id); removed++; }
      }
    });
    tx();

    audit(db, billId || null, 'supplementary_removed',
      `Removed supplementary charge (template ${templateId}) from ${removed} bill(s).`, 'medium');
    return { ok: true, removed };
  });

  // ── Withdrawing a bill ───────────────────────────────────────────────
  // Voiding is the normal path and is always reversible. Money already
  // received is untouched — reverse the payments first if that is the intent.
  ipcMain.handle('fees:void-bill', (_e, { billId, reason } = {}) => {
    const denied = requireElevated(db, 'void a bill');
    if (denied) return denied;
    if (!reason || String(reason).trim().length < 5) {
      return { ok: false, error: 'A reason is required, and it has to say something — this is written to the audit trail.' };
    }
    const bill = db.prepare(`
      SELECT b.*, s.surname, s.first_name, s.index_number
      FROM student_bills b JOIN students s ON s.id = b.student_id
      WHERE b.id = ?
    `).get(billId);
    if (!bill) return { ok: false, error: 'Bill not found.' };
    if ((bill.status || 'active') === 'voided') return { ok: false, error: 'That bill is already voided.' };

    db.prepare(`
      UPDATE student_bills
         SET status = 'voided', voided_at = ?, voided_by = ?, void_reason = ?
       WHERE id = ?
    `).run(new Date().toISOString(), security.getCurrentUserId(), String(reason).trim(), billId);

    audit(db, billId, 'bill_voided',
      `Voided bill #${billId} for ${bill.index_number} (${bill.surname} ${bill.first_name}), ` +
      `GHS ${billing.round2(bill.total_billed)} billed / GHS ${billing.round2(bill.total_paid)} paid. Reason: ${String(reason).trim()}`);

    return {
      ok: true,
      // Voiding does not un-receive money. Saying so plainly beats a silent
      // discrepancy between the bill list and the finance ledger.
      retained_payments: billing.round2(bill.total_paid),
      warning: (bill.total_paid || 0) > 0
        ? `GHS ${billing.round2(bill.total_paid)} already received against this bill stays recorded in Finance. ` +
          `Reverse those payments separately if the money is being refunded.`
        : null,
    };
  });

  ipcMain.handle('fees:restore-bill', (_e, { billId } = {}) => {
    const denied = requireElevated(db, 'restore a voided bill');
    if (denied) return denied;
    const bill = db.prepare('SELECT * FROM student_bills WHERE id = ?').get(billId);
    if (!bill) return { ok: false, error: 'Bill not found.' };
    db.prepare(`
      UPDATE student_bills SET status = 'active', voided_at = NULL, voided_by = NULL, void_reason = NULL
       WHERE id = ?
    `).run(billId);
    billing.recomputeBillTotals(db, billId);
    audit(db, billId, 'bill_restored', `Restored voided bill #${billId}.`, 'medium');
    return { ok: true };
  });

  // Hard delete — only ever allowed for a bill nobody has paid against, so
  // there is no receipt or ledger entry left pointing at a row that is gone.
  ipcMain.handle('fees:delete-bill', (_e, { billId, reason } = {}) => {
    const denied = requireElevated(db, 'delete a bill');
    if (denied) return denied;
    if (!reason || String(reason).trim().length < 5) {
      return { ok: false, error: 'A reason is required, and it has to say something — this is written to the audit trail.' };
    }
    const bill = db.prepare(`
      SELECT b.*, s.surname, s.first_name, s.index_number
      FROM student_bills b JOIN students s ON s.id = b.student_id
      WHERE b.id = ?
    `).get(billId);
    if (!bill) return { ok: false, error: 'Bill not found.' };

    const paid = db.prepare(`
      SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM payments
      WHERE student_bill_id = ? AND COALESCE(is_reversed, 0) = 0
    `).get(billId);
    if (paid.n > 0 || (bill.total_paid || 0) > 0) {
      return {
        ok: false,
        code: 'HAS_PAYMENTS',
        error: `This bill has GHS ${billing.round2(paid.total || bill.total_paid)} received against it, ` +
               `so deleting it would orphan the receipts. Void it instead — the record stays, the charge does not.`,
      };
    }

    const tx = db.transaction(() => {
      db.prepare('DELETE FROM bill_line_items WHERE student_bill_id = ?').run(billId);
      db.prepare('UPDATE payments SET student_bill_id = NULL WHERE student_bill_id = ?').run(billId);
      db.prepare('DELETE FROM student_bills WHERE id = ?').run(billId);
    });
    tx();

    audit(db, billId, 'bill_deleted',
      `Deleted unpaid bill #${billId} for ${bill.index_number} (${bill.surname} ${bill.first_name}), ` +
      `GHS ${billing.round2(bill.total_billed)}. Reason: ${String(reason).trim()}`);
    return { ok: true };
  });

  // Editing an issued bill: adjust a single line, or add a one-off charge to
  // one pupil, without going through a template. Same restriction, same trail.
  ipcMain.handle('fees:adjust-bill-item', (_e, { billId, itemId, description, amount, reason, remove } = {}) => {
    const denied = requireElevated(db, 'edit an issued bill');
    if (denied) return denied;
    if (!reason || String(reason).trim().length < 5) {
      return { ok: false, error: 'A reason is required, and it has to say something — this is written to the audit trail.' };
    }
    const bill = db.prepare('SELECT * FROM student_bills WHERE id = ?').get(billId);
    if (!bill) return { ok: false, error: 'Bill not found.' };
    if ((bill.status || 'active') === 'voided') return { ok: false, error: 'That bill is voided. Restore it before editing.' };

    const tx = db.transaction(() => {
      if (remove && itemId) {
        const row = db.prepare('SELECT * FROM bill_line_items WHERE id = ? AND student_bill_id = ?').get(itemId, billId);
        if (!row) throw new Error('That line is not on this bill.');
        db.prepare('DELETE FROM bill_line_items WHERE id = ?').run(itemId);
        audit(db, billId, 'bill_item_removed',
          `Removed "${row.description}" (GHS ${billing.round2(row.amount)}) from bill #${billId}. Reason: ${String(reason).trim()}`);
      } else if (itemId) {
        const row = db.prepare('SELECT * FROM bill_line_items WHERE id = ? AND student_bill_id = ?').get(itemId, billId);
        if (!row) throw new Error('That line is not on this bill.');
        db.prepare('UPDATE bill_line_items SET description = ?, amount = ? WHERE id = ?')
          .run(description || row.description, billing.round2(amount), itemId);
        audit(db, billId, 'bill_item_edited',
          `Bill #${billId}: "${row.description}" GHS ${billing.round2(row.amount)} → ` +
          `"${description || row.description}" GHS ${billing.round2(amount)}. Reason: ${String(reason).trim()}`);
      } else {
        if (!description || !String(description).trim()) throw new Error('A description is required.');
        const no = db.prepare(
          'SELECT COALESCE(MAX(item_number), 0) AS n FROM bill_line_items WHERE student_bill_id = ?'
        ).get(billId).n + 1;
        db.prepare(`
          INSERT INTO bill_line_items
            (student_bill_id, item_number, description, amount, is_arrear, arrear_from_term_id,
             charge_type, source_template_id, added_at, added_by)
          VALUES (?, ?, ?, ?, 0, NULL, 'extra', NULL, ?, ?)
        `).run(billId, no, String(description).trim(), billing.round2(amount),
          new Date().toISOString(), security.getCurrentUserId());
        audit(db, billId, 'bill_item_added',
          `Added "${String(description).trim()}" GHS ${billing.round2(amount)} to bill #${billId}. Reason: ${String(reason).trim()}`);
      }
      return billing.recomputeBillTotals(db, billId);
    });

    try {
      const totals = tx();
      return { ok: true, totals };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });

  // The Proprietor/Super Admin review screen: every voided bill this term
  // with who voided it and why.
  ipcMain.handle('fees:list-voided-bills', (_e, termId) => {
    return db.prepare(`
      SELECT b.*, s.index_number, s.surname, s.first_name,
             c.name AS class_name, t.label AS term_label, y.label AS year_label,
             u.full_name AS voided_by_name
      FROM student_bills b
      JOIN students s ON s.id = b.student_id
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      JOIN terms t ON t.id = b.term_id
      LEFT JOIN academic_years y ON y.id = t.academic_year_id
      LEFT JOIN users u ON u.id = b.voided_by
      WHERE COALESCE(b.status, 'active') = 'voided'
        AND (? IS NULL OR b.term_id = ?)
      ORDER BY b.voided_at DESC
    `).all(termId || null, termId || null);
  });
};
