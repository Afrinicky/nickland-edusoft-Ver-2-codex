// Nickland Edusoft — Finance IPC Handler
// Copyright © 2026 Nickland Sales. All rights reserved.

function nextTransactionNumber(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'transaction_counter'").get();
  const n = parseInt(row ? row.value : '1', 10);
  const next = n + 1;
  db.prepare("UPDATE settings SET value = ? WHERE key = 'transaction_counter'").run(String(next));
  const year = new Date().getFullYear().toString().slice(-2);
  return `TXN/${year}/${String(n).padStart(5, '0')}`;
}

module.exports = function registerFinanceHandlers(ipcMain, db) {
  const security = require('./_security');


  // ── Dashboard (legacy — Dashboard.jsx uses dashboard:summary instead) ──
  ipcMain.handle('finance:dashboard', (_e, termId) => {
    return {
      income_total: 0, expense_total: 0, net: 0,
      fees_collected: 0, fees_outstanding: 0,
      canteen_collected: 0, recent: [],
    };
  });

  // ── Income ───────────────────────────────────────────
  ipcMain.handle('finance:list-income', (_e, filters = {}) => {
    let sql = `
      SELECT ir.*, t.label AS term_label, y.label AS year_label,
             u.full_name AS recorded_by_name
      FROM income_records ir
      LEFT JOIN terms t ON t.id = ir.term_id
      LEFT JOIN academic_years y ON y.id = ir.academic_year_id
      LEFT JOIN users u ON u.id = ir.recorded_by
      WHERE 1=1
    `;
    const params = [];
    if (filters.termId) { sql += ' AND ir.term_id = ?'; params.push(filters.termId); }
    if (filters.category) { sql += ' AND ir.category = ?'; params.push(filters.category); }
    if (filters.fromDate) { sql += ' AND COALESCE(ir.transaction_date, ir.date) >= ?'; params.push(filters.fromDate); }
    if (filters.toDate) { sql += ' AND COALESCE(ir.transaction_date, ir.date) <= ?'; params.push(filters.toDate); }
    sql += ' ORDER BY COALESCE(ir.transaction_date, ir.date) DESC, ir.id DESC';
    if (filters.limit) { sql += ' LIMIT ?'; params.push(filters.limit); }
    return db.prepare(sql).all(...params);
  });

  ipcMain.handle('finance:record-income', (_e, data) => {
    if (!security.checkPermission(db, 'finance', 'edit')) {
      return { ok: false, error: 'Access denied. You do not have permission to edit finance records.' };
    }

    const receipt = data.receipt_number || nextTransactionNumber(db);
    const stmt = db.prepare(`
      INSERT INTO income_records
        (receipt_number, category, subcategory, amount, payer_name, description,
         payment_method, reference, transaction_date, date, academic_year_id, term_id,
         recorded_by, student_id, staff_id, is_auto)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const r = stmt.run(
      receipt, data.category, data.subcategory || null, data.amount,
      data.payer_name || null, data.description || null,
      data.payment_method || 'Cash', data.reference || null,
      data.transaction_date, data.transaction_date,
      data.academic_year_id || null, data.term_id || null,
      data.recorded_by || null, data.student_id || null, data.staff_id || null,
      data.is_auto ? 1 : 0
    );
    return { ok: true, id: r.lastInsertRowid, receipt_number: receipt };
  });

  ipcMain.handle('finance:update-income', (_e, { id, data }) => {
    if (!security.checkPermission(db, 'finance', 'edit')) {
      return { ok: false, error: 'Access denied. You do not have permission to edit finance records.' };
    }

    db.prepare(`
      UPDATE income_records SET
        category = ?, subcategory = ?, amount = ?, payer_name = ?,
        description = ?, payment_method = ?, reference = ?, transaction_date = ?
      WHERE id = ?
    `).run(
      data.category, data.subcategory || null, data.amount,
      data.payer_name || null, data.description || null,
      data.payment_method || 'Cash', data.reference || null,
      data.transaction_date, id
    );
    return { ok: true };
  });

  // ── Expense ──────────────────────────────────────────
  ipcMain.handle('finance:list-expense', (_e, filters = {}) => {
    let sql = `
      SELECT er.*, t.label AS term_label, y.label AS year_label,
             u.full_name AS approved_by_name, ru.full_name AS recorded_by_name
      FROM expense_records er
      LEFT JOIN terms t ON t.id = er.term_id
      LEFT JOIN academic_years y ON y.id = er.academic_year_id
      LEFT JOIN users u ON u.id = er.approved_by
      LEFT JOIN users ru ON ru.id = er.recorded_by
      WHERE 1=1
    `;
    const params = [];
    if (filters.termId) { sql += ' AND er.term_id = ?'; params.push(filters.termId); }
    if (filters.category) { sql += ' AND er.category = ?'; params.push(filters.category); }
    if (filters.fromDate) { sql += ' AND COALESCE(er.transaction_date, er.date) >= ?'; params.push(filters.fromDate); }
    if (filters.toDate) { sql += ' AND COALESCE(er.transaction_date, er.date) <= ?'; params.push(filters.toDate); }
    sql += ' ORDER BY COALESCE(er.transaction_date, er.date) DESC, er.id DESC';
    if (filters.limit) { sql += ' LIMIT ?'; params.push(filters.limit); }
    return db.prepare(sql).all(...params);
  });

  ipcMain.handle('finance:record-expense', (_e, data) => {
    if (!security.checkPermission(db, 'finance', 'edit')) {
      return { ok: false, error: 'Access denied. You do not have permission to edit finance records.' };
    }

    const txn = data.transaction_number || nextTransactionNumber(db);
    const stmt = db.prepare(`
      INSERT INTO expense_records
        (transaction_number, category, subcategory, amount, payee_name, description,
         payment_method, reference, transaction_date, date, academic_year_id, term_id,
         approved_by, recorded_by, is_auto)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const r = stmt.run(
      txn, data.category, data.subcategory || null, data.amount,
      data.payee_name || null, data.description,
      data.payment_method || 'Cash', data.reference || null,
      data.transaction_date, data.transaction_date,
      data.academic_year_id || null, data.term_id || null,
      data.approved_by || null, data.recorded_by || null,
      data.is_auto ? 1 : 0
    );

    // Auto-create inventory movement if this expense is purchase-class
    const PURCHASE_CATS = ['supplies', 'canteen_supplies', 'construction', 'maintenance'];
    if (PURCHASE_CATS.includes(data.category) && data.inventory_item_name) {
      try {
        const itemName = data.inventory_item_name.trim();
        let item = db.prepare('SELECT * FROM inventory_items WHERE LOWER(name) = LOWER(?)').get(itemName);
        const quantity = parseFloat(data.inventory_quantity) || 1;
        const unitCost = data.amount / quantity;
        if (!item) {
          const ir = db.prepare(`
            INSERT INTO inventory_items (name, category, unit, unit_cost, quantity_on_hand)
            VALUES (?, ?, 'piece', ?, 0)
          `).run(itemName, data.category, unitCost);
          item = { id: ir.lastInsertRowid };
        }
        db.prepare(`
          INSERT INTO inventory_movements
            (inventory_item_id, movement_type, quantity, unit_cost, total_cost,
             movement_date, reference, linked_expense_id, recorded_by, notes)
          VALUES (?, 'in', ?, ?, ?, ?, ?, ?, ?, 'Auto-created from expense')
        `).run(
          item.id, quantity, unitCost, data.amount,
          data.transaction_date, txn, r.lastInsertRowid,
          data.recorded_by || null
        );
        db.prepare(`
          UPDATE inventory_items SET
            quantity_on_hand = quantity_on_hand + ?,
            unit_cost = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(quantity, unitCost, item.id);
      } catch (e) { /* ignore — keep the expense regardless */ }
    }

    return { ok: true, id: r.lastInsertRowid, transaction_number: txn };
  });

  ipcMain.handle('finance:update-expense', (_e, { id, data }) => {
    if (!security.checkPermission(db, 'finance', 'edit')) {
      return { ok: false, error: 'Access denied. You do not have permission to edit finance records.' };
    }

    db.prepare(`
      UPDATE expense_records SET
        category = ?, subcategory = ?, amount = ?, payee_name = ?,
        description = ?, payment_method = ?, reference = ?, transaction_date = ?
      WHERE id = ?
    `).run(
      data.category, data.subcategory || null, data.amount,
      data.payee_name || null, data.description,
      data.payment_method || 'Cash', data.reference || null,
      data.transaction_date, id
    );
    return { ok: true };
  });

  // ── Term summary ─────────────────────────────────────
  ipcMain.handle('finance:summary', (_e, termId) => {
    const term = termId
      ? db.prepare('SELECT * FROM terms WHERE id = ?').get(termId)
      : db.prepare("SELECT * FROM terms WHERE is_current = 1").get();
    if (!term) return { income_total: 0, expense_total: 0, net: 0 };

    const inc = db.prepare(`
      SELECT category, COALESCE(SUM(amount), 0) AS total
      FROM income_records
      WHERE COALESCE(transaction_date, date) >= ? AND COALESCE(transaction_date, date) <= ?
      GROUP BY category
    `).all(term.start_date, term.end_date);

    const exp = db.prepare(`
      SELECT category, COALESCE(SUM(amount), 0) AS total
      FROM expense_records
      WHERE COALESCE(transaction_date, date) >= ? AND COALESCE(transaction_date, date) <= ?
      GROUP BY category
    `).all(term.start_date, term.end_date);

    const incomeTotal = inc.reduce((s, r) => s + r.total, 0);
    const expenseTotal = exp.reduce((s, r) => s + r.total, 0);

    return {
      term_id: term.id,
      term_label: term.label,
      income_total: incomeTotal,
      expense_total: expenseTotal,
      net: incomeTotal - expenseTotal,
      income_by_category: inc,
      expense_by_category: exp,
    };
  });

  // ── Financial Statement (accounting-standard) ────────────
  // Produces a structured statement of income & expenditure for a
  // given range (date-range, termly, or annual). Returns category
  // groupings + totals + opening/closing balances + net surplus/deficit.
  //
  // Range types:
  //   'date'   — explicit fromDate/toDate
  //   'term'   — termId (uses term start/end)
  //   'annual' — academicYearId (sums all terms in the year)
  ipcMain.handle('finance:financial-statement', (_e, params) => {
    let fromDate, toDate, periodLabel, periodKind;

    if (params.rangeType === 'date') {
      fromDate = params.fromDate;
      toDate = params.toDate;
      periodLabel = `${fromDate} to ${toDate}`;
      periodKind = 'Date Range';
    } else if (params.rangeType === 'term') {
      const t = db.prepare('SELECT * FROM terms WHERE id = ?').get(params.termId);
      if (!t) return { ok: false, error: 'Term not found' };
      fromDate = t.start_date; toDate = t.end_date;
      periodLabel = t.label;
      periodKind = 'Term';
    } else if (params.rangeType === 'annual') {
      const y = db.prepare('SELECT * FROM academic_years WHERE id = ?').get(params.academicYearId);
      if (!y) return { ok: false, error: 'Academic year not found' };
      fromDate = y.start_date; toDate = y.end_date;
      periodLabel = y.label || `${fromDate.slice(0,4)}/${toDate.slice(0,4)}`;
      periodKind = 'Annual';
    } else {
      return { ok: false, error: 'rangeType must be date|term|annual' };
    }

    // Opening balance: net of all transactions BEFORE fromDate
    const openIncome = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total FROM income_records
      WHERE COALESCE(transaction_date, date) < ?
    `).get(fromDate).total;
    const openExpense = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total FROM expense_records
      WHERE COALESCE(transaction_date, date) < ?
    `).get(fromDate).total;
    const openingBalance = openIncome - openExpense;

    // Income by category (within range)
    const incomeByCategory = db.prepare(`
      SELECT category,
             COALESCE(SUM(amount), 0) AS total,
             COUNT(*) AS count
      FROM income_records
      WHERE COALESCE(transaction_date, date) >= ?
        AND COALESCE(transaction_date, date) <= ?
      GROUP BY category
      ORDER BY total DESC
    `).all(fromDate, toDate);

    const expenseByCategory = db.prepare(`
      SELECT category,
             COALESCE(SUM(amount), 0) AS total,
             COUNT(*) AS count
      FROM expense_records
      WHERE COALESCE(transaction_date, date) >= ?
        AND COALESCE(transaction_date, date) <= ?
      GROUP BY category
      ORDER BY total DESC
    `).all(fromDate, toDate);

    // Income breakdown by payment method (cash vs bank vs momo)
    const incomeByMethod = db.prepare(`
      SELECT COALESCE(payment_method, 'Unspecified') AS method,
             COALESCE(SUM(amount), 0) AS total
      FROM income_records
      WHERE COALESCE(transaction_date, date) >= ?
        AND COALESCE(transaction_date, date) <= ?
      GROUP BY payment_method
      ORDER BY total DESC
    `).all(fromDate, toDate);

    const totalIncome = incomeByCategory.reduce((s, r) => s + r.total, 0);
    const totalExpense = expenseByCategory.reduce((s, r) => s + r.total, 0);
    const netSurplus = totalIncome - totalExpense;
    const closingBalance = openingBalance + netSurplus;

    // Sub-period breakdown (for annual, break into terms; for term, into months)
    let subPeriods = [];
    if (params.rangeType === 'annual') {
      const terms = db.prepare(`
        SELECT id, label, start_date, end_date FROM terms
        WHERE academic_year_id = ? ORDER BY start_date
      `).all(params.academicYearId);
      for (const t of terms) {
        const ti = db.prepare(`
          SELECT COALESCE(SUM(amount), 0) AS total FROM income_records
          WHERE COALESCE(transaction_date, date) BETWEEN ? AND ?
        `).get(t.start_date, t.end_date).total;
        const te = db.prepare(`
          SELECT COALESCE(SUM(amount), 0) AS total FROM expense_records
          WHERE COALESCE(transaction_date, date) BETWEEN ? AND ?
        `).get(t.start_date, t.end_date).total;
        subPeriods.push({
          label: t.label, fromDate: t.start_date, toDate: t.end_date,
          income: ti, expense: te, net: ti - te,
        });
      }
    } else if (params.rangeType === 'term' || params.rangeType === 'date') {
      // Month-by-month breakdown within the range
      const monthly = db.prepare(`
        SELECT strftime('%Y-%m', COALESCE(transaction_date, date)) AS month,
               COALESCE(SUM(amount), 0) AS total
        FROM income_records
        WHERE COALESCE(transaction_date, date) BETWEEN ? AND ?
        GROUP BY month ORDER BY month
      `).all(fromDate, toDate);
      const monthlyE = db.prepare(`
        SELECT strftime('%Y-%m', COALESCE(transaction_date, date)) AS month,
               COALESCE(SUM(amount), 0) AS total
        FROM expense_records
        WHERE COALESCE(transaction_date, date) BETWEEN ? AND ?
        GROUP BY month ORDER BY month
      `).all(fromDate, toDate);
      const allMonths = new Set([...monthly.map(r => r.month), ...monthlyE.map(r => r.month)]);
      for (const m of [...allMonths].sort()) {
        const i = monthly.find(r => r.month === m)?.total || 0;
        const e = monthlyE.find(r => r.month === m)?.total || 0;
        subPeriods.push({ label: m, income: i, expense: e, net: i - e });
      }
    }

    return {
      ok: true,
      period_kind: periodKind,
      period_label: periodLabel,
      from_date: fromDate,
      to_date: toDate,
      opening_balance: openingBalance,
      income_by_category: incomeByCategory,
      expense_by_category: expenseByCategory,
      income_by_method: incomeByMethod,
      total_income: totalIncome,
      total_expense: totalExpense,
      net_surplus: netSurplus,
      closing_balance: closingBalance,
      sub_periods: subPeriods,
    };
  });

  // ── Expected Income (template amount × active students) ──
  ipcMain.handle('finance:expected-income', (_e, termId) => {
    const term = termId || db.prepare("SELECT id FROM terms WHERE is_current = 1").get()?.id;
    if (!term) return { total: 0, breakdown: [] };

    // For each class with a fee template for this term, expected = template_total × active_students_in_class
    const breakdown = db.prepare(`
      SELECT
        cg.id AS class_id, cg.name AS class_name, cg.short_code,
        COUNT(DISTINCT s.id) AS active_students,
        COALESCE(SUM(fti.amount), 0) AS template_amount
      FROM class_groups cg
      LEFT JOIN students s ON s.current_class_id = cg.id AND s.status = 'Active'
      LEFT JOIN fee_templates ft ON ft.class_group_id = cg.id AND ft.term_id = ? AND ft.is_active = 1
      LEFT JOIN fee_template_items fti ON fti.template_id = ft.id
      WHERE cg.is_active = 1
      GROUP BY cg.id
    `).all(term);

    const enriched = breakdown.map(r => ({
      ...r,
      expected: r.active_students * r.template_amount,
    }));

    const total = enriched.reduce((s, r) => s + r.expected, 0);
    return { total, breakdown: enriched };
  });

  // ── Budgets ──────────────────────────────────────────
  ipcMain.handle('finance:list-budgets', (_e, filters = {}) => {
    let sql = `
      SELECT b.*, t.label AS term_label, y.label AS year_label
      FROM budgets b
      LEFT JOIN terms t ON t.id = b.term_id
      LEFT JOIN academic_years y ON y.id = b.academic_year_id
      WHERE 1=1
    `;
    const params = [];
    if (filters.budgetType) { sql += ' AND b.budget_type = ?'; params.push(filters.budgetType); }
    if (filters.termId)     { sql += ' AND b.term_id = ?';     params.push(filters.termId); }
    if (filters.academicYearId) { sql += ' AND b.academic_year_id = ?'; params.push(filters.academicYearId); }
    sql += ' ORDER BY b.created_at DESC';
    return db.prepare(sql).all(...params);
  });

  ipcMain.handle('finance:get-budget', (_e, id) => {
    const budget = db.prepare(`
      SELECT b.*, t.label AS term_label, y.label AS year_label
      FROM budgets b
      LEFT JOIN terms t ON t.id = b.term_id
      LEFT JOIN academic_years y ON y.id = b.academic_year_id
      WHERE b.id = ?
    `).get(id);
    if (!budget) return null;
    const items = db.prepare(`
      SELECT * FROM budget_items WHERE budget_id = ? ORDER BY display_order, id
    `).all(id);
    return { ...budget, items };
  });

  ipcMain.handle('finance:save-budget', (_e, data) => {
    if (!security.checkPermission(db, 'finance', 'edit')) {
      return { ok: false, error: 'Access denied. You do not have permission to edit finance records.' };
    }

    if (data.id) {
      db.prepare(`
        UPDATE budgets SET
          title = ?, budget_type = ?, academic_year_id = ?, term_id = ?,
          period_label = ?, start_date = ?, end_date = ?, notes = ?, status = ?
        WHERE id = ?
      `).run(
        data.title, data.budget_type, data.academic_year_id || null, data.term_id || null,
        data.period_label || null, data.start_date || null, data.end_date || null,
        data.notes || null, data.status || 'draft', data.id
      );
      return { ok: true, id: data.id };
    } else {
      const r = db.prepare(`
        INSERT INTO budgets (title, budget_type, academic_year_id, term_id,
                             period_label, start_date, end_date, notes, status, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.title, data.budget_type, data.academic_year_id || null, data.term_id || null,
        data.period_label || null, data.start_date || null, data.end_date || null,
        data.notes || null, data.status || 'draft', data.created_by || null
      );
      return { ok: true, id: r.lastInsertRowid };
    }
  });

  ipcMain.handle('finance:delete-budget', (_e, id) => {
    if (!security.checkPermission(db, 'finance', 'delete')) {
      return { ok: false, error: 'Access denied. You do not have permission to delete finance records.' };
    }

    db.prepare('DELETE FROM budgets WHERE id = ?').run(id);
    return { ok: true };
  });

  ipcMain.handle('finance:save-budget-item', (_e, data) => {
    if (!security.checkPermission(db, 'finance', 'edit')) {
      return { ok: false, error: 'Access denied. You do not have permission to edit finance records.' };
    }

    if (data.id) {
      db.prepare(`
        UPDATE budget_items SET
          item_type = ?, category = ?, description = ?,
          projected_amount = ?, actual_amount = ?, notes = ?, display_order = ?
        WHERE id = ?
      `).run(
        data.item_type, data.category, data.description,
        data.projected_amount || 0, data.actual_amount || 0,
        data.notes || null, data.display_order || 0, data.id
      );
      return { ok: true, id: data.id };
    } else {
      const r = db.prepare(`
        INSERT INTO budget_items
          (budget_id, item_type, category, description,
           projected_amount, actual_amount, notes, display_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.budget_id, data.item_type, data.category, data.description,
        data.projected_amount || 0, data.actual_amount || 0,
        data.notes || null, data.display_order || 0
      );
      return { ok: true, id: r.lastInsertRowid };
    }
  });

  ipcMain.handle('finance:delete-budget-item', (_e, id) => {
    if (!security.checkPermission(db, 'finance', 'delete')) {
      return { ok: false, error: 'Access denied. You do not have permission to delete finance records.' };
    }

    db.prepare('DELETE FROM budget_items WHERE id = ?').run(id);
    return { ok: true };
  });

  // ── Delete income with justification (writes to audit log) ──
  ipcMain.handle('finance:delete-income', (_e, { id, justification, userId }) => {
    if (!justification || justification.trim().length < 15) {
      return { ok: false, error: 'Justification of at least 15 characters required.' };
    }
    const before = db.prepare('SELECT * FROM income_records WHERE id = ?').get(id);
    if (!before) return { ok: false, error: 'Income record not found.' };

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO audit_log
          (entity_type, entity_id, action, user_id, justification, before_data, severity)
        VALUES ('income', ?, 'delete', ?, ?, ?, 'high')
      `).run(id, userId || null, justification.trim(), JSON.stringify(before));

      db.prepare('DELETE FROM income_records WHERE id = ?').run(id);
    });
    tx();
    return { ok: true };
  });

  // ── Delete expense with justification (writes to audit log) ──
  ipcMain.handle('finance:delete-expense', (_e, { id, justification, userId }) => {
    if (!justification || justification.trim().length < 15) {
      return { ok: false, error: 'Justification of at least 15 characters required.' };
    }
    const before = db.prepare('SELECT * FROM expense_records WHERE id = ?').get(id);
    if (!before) return { ok: false, error: 'Expense record not found.' };

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO audit_log
          (entity_type, entity_id, action, user_id, justification, before_data, severity)
        VALUES ('expense', ?, 'delete', ?, ?, ?, 'high')
      `).run(id, userId || null, justification.trim(), JSON.stringify(before));

      db.prepare('DELETE FROM expense_records WHERE id = ?').run(id);
    });
    tx();
    return { ok: true };
  });
};
