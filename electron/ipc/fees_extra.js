// Nickland Edusoft — Fees Extra IPC (dashboard, financial profile, expected income)
// Copyright © 2026 Nickland Sales. All rights reserved.

module.exports = function registerFeesExtraHandlers(ipcMain, db) {

  // ── Fees Dashboard ───────────────────────────────────
  ipcMain.handle('fees:dashboard', (_e, termId) => {
    const term = termId
      ? db.prepare('SELECT * FROM terms WHERE id = ?').get(termId)
      : db.prepare("SELECT * FROM terms WHERE is_current = 1").get();
    if (!term) return { metrics: {}, top_debtors: [], recent_payments: [] };

    // Total billed for this term
    const billedRow = db.prepare(`
      SELECT COALESCE(SUM(total_billed), 0) AS total,
             COUNT(*) AS count
      FROM student_bills WHERE term_id = ?
    `).get(term.id);

    // Total collected (sum of all valid payments this term)
    const collectedRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total,
             COUNT(*) AS payment_count
      FROM payments
      WHERE term_id = ? AND is_reversed = 0
    `).get(term.id);

    // Outstanding (sum of balances + count of debtors)
    const outstandingRow = db.prepare(`
      SELECT COALESCE(SUM(balance), 0) AS total,
             COUNT(*) FILTER (WHERE balance > 0) AS debtor_count
      FROM student_bills
      WHERE term_id = ?
    `).get(term.id);

    // Expected income (template amount × active students per class)
    const expectedRow = db.prepare(`
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
    `).all(term.id);

    const expectedTotal = expectedRow.reduce(
      (s, r) => s + (r.active_students * r.template_amount), 0
    );

    // Top debtors (5 biggest balances this term)
    const topDebtors = db.prepare(`
      SELECT
        sb.balance,
        s.id AS student_id, s.surname, s.first_name, s.index_number,
        cg.short_code AS class_code, cg.name AS class_name,
        ROUND(julianday('now') - julianday(sb.generated_at)) AS days_outstanding
      FROM student_bills sb
      JOIN students s ON s.id = sb.student_id
      LEFT JOIN class_groups cg ON cg.id = s.current_class_id
      WHERE sb.balance > 0 AND sb.term_id = ?
      ORDER BY sb.balance DESC
      LIMIT 10
    `).all(term.id);

    // Recent payments (last 10)
    const recentPayments = db.prepare(`
      SELECT
        p.id, p.amount, p.payment_date, p.receipt_number, p.payment_method,
        s.surname, s.first_name, s.index_number,
        cg.short_code AS class_code
      FROM payments p
      JOIN students s ON s.id = p.student_id
      LEFT JOIN class_groups cg ON cg.id = s.current_class_id
      WHERE p.term_id = ? AND p.is_reversed = 0
      ORDER BY p.payment_date DESC, p.id DESC
      LIMIT 10
    `).all(term.id);

    // Collection rate
    const collectionPct = billedRow.total > 0
      ? Math.round((collectedRow.total / billedRow.total) * 100)
      : 0;

    // Per-class breakdown
    const byClass = db.prepare(`
      SELECT
        cg.id, cg.name, cg.short_code,
        COUNT(DISTINCT sb.student_id) AS student_count,
        COALESCE(SUM(sb.total_billed), 0) AS total_billed,
        COALESCE(SUM(sb.total_paid), 0) AS total_paid,
        COALESCE(SUM(sb.balance), 0) AS total_outstanding
      FROM class_groups cg
      LEFT JOIN students s ON s.current_class_id = cg.id AND s.status = 'Active'
      LEFT JOIN student_bills sb ON sb.student_id = s.id AND sb.term_id = ?
      WHERE cg.is_active = 1
      GROUP BY cg.id
      HAVING student_count > 0
      ORDER BY cg.level_order
    `).all(term.id);

    return {
      term: { id: term.id, label: term.label, start_date: term.start_date, end_date: term.end_date },
      metrics: {
        expected_income: Math.round(expectedTotal),
        total_billed: Math.round(billedRow.total),
        total_collected: Math.round(collectedRow.total),
        outstanding: Math.round(outstandingRow.total),
        collection_pct: collectionPct,
        debtor_count: outstandingRow.debtor_count,
        bill_count: billedRow.count,
        payment_count: collectedRow.payment_count,
      },
      top_debtors: topDebtors,
      recent_payments: recentPayments,
      by_class: byClass,
    };
  });

  // ── Expected Income (per class) ──────────────────────
  ipcMain.handle('fees:expected-income', (_e, termId) => {
    const term = termId || db.prepare("SELECT id FROM terms WHERE is_current = 1").get()?.id;
    if (!term) return { total: 0, breakdown: [] };

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
      HAVING active_students > 0
      ORDER BY cg.level_order
    `).all(term);

    const enriched = breakdown.map(r => ({
      ...r,
      expected: r.active_students * r.template_amount,
    }));
    const total = enriched.reduce((s, r) => s + r.expected, 0);
    return { total, breakdown: enriched };
  });

  // ── Student Financial Profile (full payment history since admission) ──
  ipcMain.handle('fees:student-financial-profile', (_e, studentId) => {
    const student = db.prepare(`
      SELECT s.*, cg.name AS class_name, cg.short_code AS class_short
      FROM students s
      LEFT JOIN class_groups cg ON cg.id = s.current_class_id
      WHERE s.id = ?
    `).get(studentId);
    if (!student) return null;

    // All bills (across terms)
    const bills = db.prepare(`
      SELECT sb.*, t.label AS term_label, t.term_number,
             y.label AS year_label,
             cg_at_bill.name AS class_at_bill_name
      FROM student_bills sb
      JOIN terms t ON t.id = sb.term_id
      LEFT JOIN academic_years y ON y.id = t.academic_year_id
      LEFT JOIN class_groups cg_at_bill ON cg_at_bill.id = sb.template_id
      WHERE sb.student_id = ?
      ORDER BY y.start_date, t.term_number
    `).all(studentId);

    // All payments (across terms)
    const payments = db.prepare(`
      SELECT p.*, t.label AS term_label, t.term_number,
             y.label AS year_label,
             u.full_name AS received_by_name
      FROM payments p
      JOIN terms t ON t.id = p.term_id
      LEFT JOIN academic_years y ON y.id = t.academic_year_id
      LEFT JOIN users u ON u.id = p.received_by
      WHERE p.student_id = ?
      ORDER BY p.payment_date DESC, p.id DESC
    `).all(studentId);

    // Totals
    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(p.amount), 0) AS total_paid,
        COUNT(p.id) AS payment_count
      FROM payments p
      WHERE p.student_id = ? AND p.is_reversed = 0
    `).get(studentId);

    const billTotals = db.prepare(`
      SELECT
        COALESCE(SUM(total_billed), 0) AS total_billed,
        COALESCE(SUM(balance), 0) AS outstanding
      FROM student_bills WHERE student_id = ?
    `).get(studentId);

    return {
      student,
      bills,
      payments,
      summary: {
        total_billed: billTotals.total_billed,
        total_paid: totals.total_paid,
        outstanding: billTotals.outstanding,
        payment_count: totals.payment_count,
      },
    };
  });
};
