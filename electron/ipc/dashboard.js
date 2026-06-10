// Nickland Edusoft — Dashboard IPC Handler
// Copyright © 2026 Nickland Sales. All rights reserved.
// Aggregates metrics from all modules for the main Dashboard page.

module.exports = function registerDashboardHandlers(ipcMain, db) {

  // ── Main dashboard payload ───────────────────────────
  ipcMain.handle('dashboard:summary', (_e, termId) => {
    const currentTerm = termId || (() => {
      const t = db.prepare('SELECT id FROM terms WHERE is_current = 1').get();
      return t ? t.id : null;
    })();
    const term = currentTerm
      ? db.prepare('SELECT t.*, y.label AS year_label FROM terms t LEFT JOIN academic_years y ON y.id = t.academic_year_id WHERE t.id = ?').get(currentTerm)
      : null;

    // ── Top metric cards ────────────────────────────────
    const studentTotal = db.prepare("SELECT COUNT(*) AS c FROM students WHERE status = 'Active'").get().c;
    const classCount   = db.prepare("SELECT COUNT(DISTINCT current_class_id) AS c FROM students WHERE status = 'Active'").get().c;
    const staffActive  = db.prepare("SELECT COUNT(*) AS c FROM staff WHERE status = 'Active'").get().c;

    // Income this term (auto + manual)
    const startD = term?.start_date || '1970-01-01';
    const endD   = term?.end_date   || '2099-12-31';

    // Total income from income_records (handles both new transaction_date and legacy date columns)
    const incomeRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM income_records
      WHERE COALESCE(transaction_date, date) >= ? AND COALESCE(transaction_date, date) <= ?
    `).get(startD, endD);

    // Fees collected (sum of all payments this term)
    const feesCollectedRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM payments
      WHERE term_id = ? AND is_reversed = 0
    `).get(currentTerm);

    // Outstanding fees (sum of all balances)
    const outstandingRow = db.prepare(`
      SELECT COALESCE(SUM(balance), 0) AS total,
             COUNT(*) FILTER (WHERE balance > 0) AS debtor_count
      FROM student_bills
      WHERE term_id = ?
    `).get(currentTerm);

    // Canteen owed = days unpaid × daily rate
    const rateRow = db.prepare("SELECT value FROM settings WHERE key = 'canteen_daily_rate'").get();
    const dailyRate = parseFloat(rateRow ? rateRow.value : '5.00');
    const canteenOwedRow = db.prepare(`
      SELECT COUNT(*) AS unpaid_days, COUNT(DISTINCT student_id) AS unpaid_students
      FROM canteen_day_status
      WHERE status = 'unpaid' AND date >= ? AND date <= ?
    `).get(startD, endD);
    const canteenOwed = (canteenOwedRow.unpaid_days || 0) * dailyRate;

    // Total billed this term
    const billedRow = db.prepare(`
      SELECT COALESCE(SUM(total_billed), 0) AS total
      FROM student_bills WHERE term_id = ?
    `).get(currentTerm);

    // ── Income vs Expenses chart (monthly breakdown) ─────
    const incomeByMonth = db.prepare(`
      SELECT strftime('%Y-%m', COALESCE(transaction_date, date)) AS ym,
             COALESCE(SUM(amount), 0) AS total
      FROM income_records
      WHERE COALESCE(transaction_date, date) >= ? AND COALESCE(transaction_date, date) <= ?
      GROUP BY ym ORDER BY ym
    `).all(startD, endD);

    const expenseByMonth = db.prepare(`
      SELECT strftime('%Y-%m', COALESCE(transaction_date, date)) AS ym,
             COALESCE(SUM(amount), 0) AS total
      FROM expense_records
      WHERE COALESCE(transaction_date, date) >= ? AND COALESCE(transaction_date, date) <= ?
      GROUP BY ym ORDER BY ym
    `).all(startD, endD);

    // ── Recent payments ─────────────────────────────────
    const recentPayments = db.prepare(`
      SELECT
        p.id, p.amount, p.payment_date, p.receipt_number,
        s.surname, s.first_name, s.index_number,
        'Fee Payment' AS payment_type
      FROM payments p
      JOIN students s ON s.id = p.student_id
      WHERE p.is_reversed = 0
      ORDER BY p.payment_date DESC, p.id DESC
      LIMIT 5
    `).all();

    const recentCanteen = db.prepare(`
      SELECT
        cp.id, cp.amount, cp.payment_date,
        s.surname, s.first_name, s.index_number,
        'Canteen Payment' AS payment_type
      FROM canteen_payments cp
      JOIN students s ON s.id = cp.student_id
      ORDER BY cp.payment_date DESC, cp.id DESC
      LIMIT 5
    `).all();

    const allRecent = [...recentPayments, ...recentCanteen]
      .sort((a, b) => (b.payment_date || '').localeCompare(a.payment_date || ''))
      .slice(0, 5);

    // ── Top fee debtors ─────────────────────────────────
    const topFeeDebtors = db.prepare(`
      SELECT
        sb.balance,
        s.id AS student_id, s.surname, s.first_name, s.index_number,
        cg.short_code AS class_code,
        ROUND((julianday('now') - julianday(sb.generated_at))) AS days_outstanding
      FROM student_bills sb
      JOIN students s ON s.id = sb.student_id
      LEFT JOIN class_groups cg ON cg.id = s.current_class_id
      WHERE sb.balance > 0 AND sb.term_id = ?
      ORDER BY sb.balance DESC
      LIMIT 5
    `).all(currentTerm);

    // ── Top canteen debtors ────────────────────────────
    const topCanteenDebtors = db.prepare(`
      SELECT
        s.id AS student_id, s.surname, s.first_name, s.index_number,
        cg.short_code AS class_code,
        COUNT(cds.id) AS unpaid_days,
        COUNT(cds.id) * ? AS amount_owed
      FROM canteen_day_status cds
      JOIN students s ON s.id = cds.student_id
      LEFT JOIN class_groups cg ON cg.id = s.current_class_id
      WHERE cds.status = 'unpaid' AND cds.date >= ? AND cds.date <= ?
      GROUP BY s.id
      ORDER BY unpaid_days DESC
      LIMIT 5
    `).all(dailyRate, startD, endD);

    return {
      term: term ? {
        id: term.id,
        label: term.label,
        year_label: term.year_label,
        start_date: term.start_date,
        end_date: term.end_date,
      } : null,
      metrics: {
        student_total: studentTotal,
        class_count: classCount,
        staff_active: staffActive,
        income_total: Math.round(incomeRow.total),
        fees_collected: Math.round(feesCollectedRow.total),
        fees_outstanding: Math.round(outstandingRow.total),
        debtor_count: outstandingRow.debtor_count,
        canteen_owed: Math.round(canteenOwed),
        canteen_unpaid_students: canteenOwedRow.unpaid_students,
        total_billed: Math.round(billedRow.total),
        collection_pct: billedRow.total > 0
          ? Math.round((feesCollectedRow.total / billedRow.total) * 100)
          : 0,
      },
      charts: {
        income_by_month: incomeByMonth,
        expense_by_month: expenseByMonth,
      },
      recent_payments: allRecent,
      top_fee_debtors: topFeeDebtors,
      top_canteen_debtors: topCanteenDebtors,
    };
  });

  // ── Today's schedule (placeholder — populated by Timetable module later) ─
  ipcMain.handle('dashboard:today-schedule', () => {
    // For now, return default school day structure.
    // Real implementation will pull from a `schedule` table in Phase D2.
    return [
      { id: 1, start: '08:00', end: '09:00', title: 'Morning Assembly', sub: 'All Students' },
      { id: 2, start: '09:00', end: '11:00', title: 'Lessons in Session', sub: 'All Classes' },
      { id: 3, start: '11:00', end: '11:30', title: 'Break', sub: 'School-wide' },
      { id: 4, start: '11:30', end: '13:00', title: 'Lessons Continue', sub: 'All Classes' },
      { id: 5, start: '13:00', end: '14:00', title: 'Lunch', sub: 'Canteen' },
      { id: 6, start: '14:00', end: '15:30', title: 'Afternoon Lessons', sub: 'All Classes' },
    ];
  });
};
