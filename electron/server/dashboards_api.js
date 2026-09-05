// Nickland Edusoft — the dashboards, over HTTP.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The installed application's dashboards, served to the browser app so that
// the two are the same screen rather than two designs that happen to share a
// database.
//
// ── Why this file exists ───────────────────────────────────────────────────
//
// The desktop's dashboards are IPC handlers — `dashboard:summary`,
// `fees:dashboard`, `staff:dashboard` and the rest — which only the Electron
// renderer can call. The browser app had no equivalent, so its dashboards were
// assembled out of whatever the general-purpose endpoints happened to return:
// four counts where the desktop shows five metric cards, a progress bar where
// the desktop draws a collection donut, and no chart of income against
// expenditure at all. An office that opens the installed app in the morning
// and the browser in the afternoon was being shown two different products.
//
// So: one route per dashboard, each one running the SAME query the IPC handler
// runs, returning the SAME shape. Where a figure is computed rather than read
// (canteen owed = unpaid days × the daily rate; a collection percentage) the
// arithmetic is copied rather than re-derived, so the browser and the desktop
// cannot drift apart by a rounding rule.
//
// ── What is NOT here ───────────────────────────────────────────────────────
//
// Nothing that writes. A dashboard is a reading, and every one of these routes
// is a GET behind the same module permission the desktop checks — a bursar
// with no Students tick gets no enrolment figures, and is told so once rather
// than handed a page of zeroes. The permission is `view` throughout, because
// there is no dashboard anybody may change.

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const money = (n) => Math.round(num(n) * 100) / 100;
const todayISO = () => new Date().toISOString().slice(0, 10);

// A query against a table an older school database may not have yet. The
// dashboard is a summary: one missing table should cost that one figure, not
// the whole screen.
//
// It reports what it swallowed, once per distinct fault. A dashboard whose
// figures are quietly zero because a column was renamed is worse than one that
// fails outright — the office reads the zero and believes it — so the fault
// reaches the log even though the request succeeds. Once per message, because
// this runs on every dashboard load and a school leaves the app open all day.
const reported = new Set();
function safe(fn, fallback) {
  try { const v = fn(); return v === undefined || v === null ? fallback : v; }
  catch (e) {
    const msg = (e && e.message) || String(e);
    if (!reported.has(msg)) {
      reported.add(msg);
      console.warn('[dashboards] a figure could not be computed:', msg);
    }
    return fallback;
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function registerDashboardRoutes({ add, db, json, can, API, getSetting }) {
  const deny = (res, msg) => json(res, 403, { ok: false, error: msg || 'Access denied.' });

  const gate = (ctx, res, module) => {
    if (!ctx || ctx.role !== 'staff') { deny(res, 'Staff only.'); return false; }
    if (!can(ctx, module, 'view')) {
      deny(res, `Access denied. You do not have permission to view ${module}.`);
      return false;
    }
    return true;
  };

  const termOf = (query) => {
    const asked = query && query.termId ? parseInt(query.termId, 10) : null;
    const row = asked
      ? db.prepare(`SELECT t.*, y.label AS year_label FROM terms t
                    LEFT JOIN academic_years y ON y.id = t.academic_year_id WHERE t.id = ?`).get(asked)
      : db.prepare(`SELECT t.*, y.label AS year_label FROM terms t
                    LEFT JOIN academic_years y ON y.id = t.academic_year_id
                    WHERE t.is_current = 1`).get();
    return row || null;
  };

  const termOut = (t) => (t ? {
    id: t.id, label: t.label, year_label: t.year_label,
    start_date: t.start_date, end_date: t.end_date,
  } : null);

  const dailyRate = () => {
    const v = parseFloat(getSetting(db, 'canteen_daily_rate', '5.00'));
    return Number.isFinite(v) ? v : 5;
  };

  // ══ The main dashboard ════════════════════════════════════════════════════
  //
  // The desktop's dashboard:summary, field for field. Five metric cards, the
  // income-against-expenditure series, the collection split, the last five
  // receipts of either kind, and the two debtor lists.
  add('GET', `${API}/dash/main`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!gate(ctx, res, 'dashboard')) return undefined;

    const term = termOf(query);
    const termId = term ? term.id : null;
    const startD = (term && term.start_date) || '1970-01-01';
    const endD = (term && term.end_date) || '2099-12-31';
    const rate = dailyRate();

    const studentTotal = safe(() =>
      db.prepare("SELECT COUNT(*) c FROM students WHERE status = 'Active'").get().c, 0);
    const classCount = safe(() =>
      db.prepare("SELECT COUNT(DISTINCT current_class_id) c FROM students WHERE status = 'Active'").get().c, 0);
    const staffActive = safe(() =>
      db.prepare("SELECT COUNT(*) c FROM staff WHERE status = 'Active'").get().c, 0);

    const income = safe(() => db.prepare(`
      SELECT COALESCE(SUM(amount), 0) total FROM income_records
      WHERE term_id = ? OR (term_id IS NULL AND COALESCE(transaction_date, date) BETWEEN ? AND ?)
    `).get(termId, startD, endD).total, 0);

    const collected = safe(() => db.prepare(
      'SELECT COALESCE(SUM(amount), 0) total FROM payments WHERE term_id = ? AND is_reversed = 0'
    ).get(termId).total, 0);

    const outstanding = safe(() => db.prepare(`
      SELECT COALESCE(SUM(balance), 0) total, COUNT(*) FILTER (WHERE balance > 0) debtor_count
      FROM student_bills WHERE term_id = ? AND COALESCE(status, 'active') = 'active'
    `).get(termId), { total: 0, debtor_count: 0 });

    const canteenOwed = safe(() => db.prepare(`
      SELECT COUNT(*) unpaid_days, COUNT(DISTINCT student_id) unpaid_students
      FROM canteen_day_status WHERE status = 'unpaid' AND date >= ? AND date <= ?
    `).get(startD, endD), { unpaid_days: 0, unpaid_students: 0 });

    const billed = safe(() => db.prepare(`
      SELECT COALESCE(SUM(total_billed), 0) total FROM student_bills
      WHERE term_id = ? AND COALESCE(status, 'active') = 'active'
    `).get(termId).total, 0);

    const incomeByMonth = safe(() => db.prepare(`
      SELECT strftime('%Y-%m', COALESCE(transaction_date, date)) ym, COALESCE(SUM(amount), 0) total
      FROM income_records
      WHERE COALESCE(transaction_date, date) >= ? AND COALESCE(transaction_date, date) <= ?
      GROUP BY ym ORDER BY ym
    `).all(startD, endD), []);

    const expenseByMonth = safe(() => db.prepare(`
      SELECT strftime('%Y-%m', COALESCE(transaction_date, date)) ym, COALESCE(SUM(amount), 0) total
      FROM expense_records
      WHERE COALESCE(transaction_date, date) >= ? AND COALESCE(transaction_date, date) <= ?
      GROUP BY ym ORDER BY ym
    `).all(startD, endD), []);

    const feePayments = safe(() => db.prepare(`
      SELECT p.id, p.amount, p.payment_date, p.receipt_number,
             s.surname, s.first_name, s.index_number, 'Fee Payment' AS payment_type
      FROM payments p JOIN students s ON s.id = p.student_id
      WHERE p.is_reversed = 0
      ORDER BY p.payment_date DESC, p.id DESC LIMIT 5
    `).all(), []);

    const canteenPayments = safe(() => db.prepare(`
      SELECT cp.id, cp.amount, cp.payment_date,
             s.surname, s.first_name, s.index_number, 'Canteen Payment' AS payment_type
      FROM canteen_payments cp JOIN students s ON s.id = cp.student_id
      ORDER BY cp.payment_date DESC, cp.id DESC LIMIT 5
    `).all(), []);

    const recent = [...feePayments, ...canteenPayments]
      .sort((a, b) => String(b.payment_date || '').localeCompare(String(a.payment_date || '')))
      .slice(0, 5);

    const topFeeDebtors = safe(() => db.prepare(`
      SELECT sb.balance, s.id AS student_id, s.surname, s.first_name, s.index_number,
             cg.short_code AS class_code,
             ROUND(julianday('now') - julianday(sb.generated_at)) AS days_outstanding
      FROM student_bills sb
      JOIN students s ON s.id = sb.student_id
      LEFT JOIN class_groups cg ON cg.id = s.current_class_id
      WHERE sb.balance > 0 AND sb.term_id = ? AND COALESCE(sb.status, 'active') = 'active'
      ORDER BY sb.balance DESC LIMIT 5
    `).all(termId), []);

    const topCanteenDebtors = safe(() => db.prepare(`
      SELECT s.id AS student_id, s.surname, s.first_name, s.index_number,
             cg.short_code AS class_code,
             COUNT(cds.id) unpaid_days, COUNT(cds.id) * ? amount_owed
      FROM canteen_day_status cds
      JOIN students s ON s.id = cds.student_id
      LEFT JOIN class_groups cg ON cg.id = s.current_class_id
      WHERE cds.status = 'unpaid' AND cds.date >= ? AND cds.date <= ?
      GROUP BY s.id ORDER BY unpaid_days DESC LIMIT 5
    `).all(rate, startD, endD), []);

    return json(res, 200, {
      ok: true,
      term: termOut(term),
      school: {
        name: getSetting(db, 'school_name', 'School'),
        motto: getSetting(db, 'school_motto', ''),
      },
      metrics: {
        student_total: studentTotal,
        class_count: classCount,
        staff_active: staffActive,
        income_total: Math.round(num(income)),
        fees_collected: Math.round(num(collected)),
        fees_outstanding: Math.round(num(outstanding.total)),
        debtor_count: outstanding.debtor_count || 0,
        canteen_owed: Math.round(num(canteenOwed.unpaid_days) * rate),
        canteen_unpaid_students: canteenOwed.unpaid_students || 0,
        total_billed: Math.round(num(billed)),
        collection_pct: num(billed) > 0 ? Math.round((num(collected) / num(billed)) * 100) : 0,
      },
      charts: { income_by_month: incomeByMonth, expense_by_month: expenseByMonth },
      recent_payments: recent,
      top_fee_debtors: topFeeDebtors,
      top_canteen_debtors: topCanteenDebtors,
      schedule: schoolDay(),
    });
  });

  // The school day, as the desktop states it. Fixed on both sides until the
  // timetable module owns it; stated in one place so it cannot be fixed
  // differently in two.
  function schoolDay() {
    return [
      { id: 1, start: '08:00', end: '09:00', title: 'Morning Assembly', sub: 'All Students' },
      { id: 2, start: '09:00', end: '11:00', title: 'Lessons in Session', sub: 'All Classes' },
      { id: 3, start: '11:00', end: '11:30', title: 'Break', sub: 'School-wide' },
      { id: 4, start: '11:30', end: '13:00', title: 'Lessons Continue', sub: 'All Classes' },
      { id: 5, start: '13:00', end: '14:00', title: 'Lunch', sub: 'Canteen' },
      { id: 6, start: '14:00', end: '15:30', title: 'Afternoon Lessons', sub: 'All Classes' },
    ];
  }

  // ══ Students ══════════════════════════════════════════════════════════════
  //
  // The desktop computes this in the browser from the whole roll — it has the
  // rows in memory anyway. Over a school's Wi-Fi that would be a thousand
  // pupil records to draw four counts, so the counting happens here and the
  // answer is the same one.
  add('GET', `${API}/dash/students`, async (ctx, req, res) => {
    if (!gate(ctx, res, 'students')) return undefined;

    const byStatus = safe(() => db.prepare(`
      SELECT COALESCE(status, 'Active') status, COUNT(*) c FROM students GROUP BY status
    `).all(), []);
    const count = (name) => (byStatus.find(r => r.status === name) || { c: 0 }).c;
    const total = byStatus.reduce((n, r) => n + r.c, 0);
    const active = count('Active');

    // 'M'/'Male'/'boy' all mean the same thing in a school's own records, and
    // a register typed by four people over six years contains all of them.
    const gender = safe(() => db.prepare(`
      SELECT
        COUNT(*) FILTER (WHERE lower(trim(COALESCE(gender,''))) IN ('m','male','boy'))    male,
        COUNT(*) FILTER (WHERE lower(trim(COALESCE(gender,''))) IN ('f','female','girl')) female
      FROM students WHERE status = 'Active'
    `).get(), { male: 0, female: 0 });

    const byClass = safe(() => db.prepare(`
      SELECT COALESCE(c.name, 'Unassigned') name, COUNT(s.id) count
      FROM students s LEFT JOIN class_groups c ON c.id = s.current_class_id
      WHERE s.status = 'Active'
      GROUP BY COALESCE(c.name, 'Unassigned')
      ORDER BY count DESC
    `).all(), []);

    const recent = safe(() => db.prepare(`
      SELECT s.id, s.index_number, s.surname, s.first_name, s.photo_path,
             s.admission_date, c.name AS class_name
      FROM students s LEFT JOIN class_groups c ON c.id = s.current_class_id
      WHERE s.admission_date IS NOT NULL
      ORDER BY s.admission_date DESC, s.id DESC LIMIT 6
    `).all(), []);

    return json(res, 200, {
      ok: true,
      metrics: {
        total,
        active,
        inactive: count('Inactive') + count('Withdrawn') + count('Suspended'),
        graduated: count('Graduated'),
        male: gender.male || 0,
        female: gender.female || 0,
        male_pct: active > 0 ? Math.round(((gender.male || 0) / active) * 100) : 0,
        female_pct: active > 0 ? Math.round(((gender.female || 0) / active) * 100) : 0,
      },
      by_class: byClass,
      recent_admissions: recent,
    });
  });

  // ══ Academics ═════════════════════════════════════════════════════════════
  add('GET', `${API}/dash/academics`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!gate(ctx, res, 'academics')) return undefined;
    const term = termOf(query);
    if (!term) {
      return json(res, 200, { ok: true, term: null, metrics: {}, class_performance: [], top_students: [] });
    }

    const scoresEntered = safe(() =>
      db.prepare('SELECT COUNT(*) c FROM scores WHERE term_id = ?').get(term.id).c, 0);
    const studentsWithScores = safe(() =>
      db.prepare('SELECT COUNT(DISTINCT student_id) c FROM scores WHERE term_id = ?').get(term.id).c, 0);

    const classPerformance = safe(() => db.prepare(`
      SELECT cg.id, cg.name AS class_name, cg.short_code,
             COUNT(DISTINCT sts.student_id) students_assessed,
             ROUND(AVG(sts.average_score), 1) class_average
      FROM student_term_summary sts
      JOIN class_groups cg ON cg.id = sts.class_group_id
      WHERE sts.term_id = ? AND sts.average_score IS NOT NULL
      GROUP BY cg.id ORDER BY cg.level_order
    `).all(term.id), []);

    const topStudents = safe(() => db.prepare(`
      SELECT sts.average_score, sts.class_rank,
             s.id AS student_id, s.surname, s.first_name, s.index_number,
             cg.name AS class_name, cg.short_code
      FROM student_term_summary sts
      JOIN students s ON s.id = sts.student_id
      LEFT JOIN class_groups cg ON cg.id = sts.class_group_id
      WHERE sts.term_id = ? AND sts.average_score IS NOT NULL
      ORDER BY sts.average_score DESC LIMIT 10
    `).all(term.id), []);

    const papers = safe(() => db.prepare(`
      SELECT COUNT(*) total,
             SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) published,
             SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) draft
      FROM exam_papers WHERE term_id = ?
    `).get(term.id), { total: 0, published: 0, draft: 0 });

    const bank = safe(() =>
      db.prepare('SELECT COUNT(*) c FROM exam_questions WHERE in_question_bank = 1').get().c, 0);

    return json(res, 200, {
      ok: true,
      term: termOut(term),
      metrics: {
        scores_entered: scoresEntered,
        students_with_scores: studentsWithScores,
        exam_papers_total: papers.total || 0,
        exam_papers_published: papers.published || 0,
        exam_papers_draft: papers.draft || 0,
        question_bank_size: bank,
      },
      class_performance: classPerformance,
      top_students: topStudents,
    });
  });

  // ══ Fees ══════════════════════════════════════════════════════════════════
  add('GET', `${API}/dash/fees`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!gate(ctx, res, 'fees')) return undefined;
    const term = termOf(query);
    if (!term) {
      return json(res, 200, { ok: true, term: null, metrics: {}, top_debtors: [], recent_payments: [], by_class: [] });
    }

    const billed = safe(() => db.prepare(`
      SELECT COALESCE(SUM(total_billed), 0) total, COUNT(*) count
      FROM student_bills WHERE term_id = ? AND COALESCE(status, 'active') = 'active'
    `).get(term.id), { total: 0, count: 0 });

    const collected = safe(() => db.prepare(`
      SELECT COALESCE(SUM(amount), 0) total, COUNT(*) payment_count
      FROM payments WHERE term_id = ? AND is_reversed = 0
    `).get(term.id), { total: 0, payment_count: 0 });

    const outstanding = safe(() => db.prepare(`
      SELECT COALESCE(SUM(balance), 0) total, COUNT(*) FILTER (WHERE balance > 0) debtor_count
      FROM student_bills WHERE term_id = ? AND COALESCE(status, 'active') = 'active'
    `).get(term.id), { total: 0, debtor_count: 0 });

    // The same projection the desktop shows, from the same module: bills that
    // exist are authoritative, and pupils with no bill yet are put through the
    // template bill generation would use — so raising the missing bills does
    // not move the figure.
    const projected = safe(() => {
      const billing = require('../ipc/_billing');
      return billing.projectedIncomeForTerm(db, term.id);
    }, { total: 0, billed_total: 0, projected_total: 0, projected_count: 0, unresolved_count: 0 });

    const topDebtors = safe(() => db.prepare(`
      SELECT sb.balance, s.id AS student_id, s.surname, s.first_name, s.index_number, s.photo_path,
             cg.short_code AS class_code, cg.name AS class_name,
             ROUND(julianday('now') - julianday(sb.generated_at)) days_outstanding
      FROM student_bills sb
      JOIN students s ON s.id = sb.student_id
      LEFT JOIN class_groups cg ON cg.id = s.current_class_id
      WHERE sb.balance > 0 AND sb.term_id = ? AND COALESCE(sb.status, 'active') = 'active'
      ORDER BY sb.balance DESC LIMIT 10
    `).all(term.id), []);

    const recentPayments = safe(() => db.prepare(`
      SELECT p.id, p.amount, p.payment_date, p.receipt_number, p.payment_method,
             s.surname, s.first_name, s.index_number, cg.short_code AS class_code
      FROM payments p JOIN students s ON s.id = p.student_id
      LEFT JOIN class_groups cg ON cg.id = s.current_class_id
      WHERE p.term_id = ? AND p.is_reversed = 0
      ORDER BY p.payment_date DESC, p.id DESC LIMIT 10
    `).all(term.id), []);

    const byClass = safe(() => db.prepare(`
      SELECT cg.id, cg.name, cg.short_code,
             COUNT(DISTINCT sb.student_id) student_count,
             COALESCE(SUM(sb.total_billed), 0) total_billed,
             COALESCE(SUM(sb.total_paid), 0) total_paid,
             COALESCE(SUM(sb.balance), 0) total_outstanding
      FROM class_groups cg
      LEFT JOIN students s ON s.current_class_id = cg.id AND s.status = 'Active'
      LEFT JOIN student_bills sb ON sb.student_id = s.id AND sb.term_id = ?
                                AND COALESCE(sb.status, 'active') = 'active'
      WHERE cg.is_active = 1
      GROUP BY cg.id HAVING student_count > 0 ORDER BY cg.level_order
    `).all(term.id), []);

    return json(res, 200, {
      ok: true,
      term: termOut(term),
      metrics: {
        expected_income: money(projected.total),
        expected_billed: money(projected.billed_total),
        expected_projected: money(projected.projected_total),
        unbilled_students: projected.projected_count || 0,
        unbillable_students: projected.unresolved_count || 0,
        total_billed: money(billed.total),
        total_collected: money(collected.total),
        outstanding: money(outstanding.total),
        collection_pct: num(billed.total) > 0
          ? Math.round((num(collected.total) / num(billed.total)) * 100) : 0,
        debtor_count: outstanding.debtor_count || 0,
        bill_count: billed.count || 0,
        payment_count: collected.payment_count || 0,
      },
      top_debtors: topDebtors,
      recent_payments: recentPayments,
      by_class: byClass,
    });
  });

  // ══ Canteen ═══════════════════════════════════════════════════════════════
  add('GET', `${API}/dash/canteen`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!gate(ctx, res, 'canteen')) return undefined;
    const term = termOf(query);
    if (!term) {
      return json(res, 200, { ok: true, term: null, metrics: {}, top_debtors: [], recent_payments: [] });
    }
    const rate = dailyRate();
    const from = term.start_date, to = term.end_date;

    const totalDays = safe(() => db.prepare(`
      SELECT COUNT(*) c FROM school_calendar WHERE term_id = ? AND day_type = 'school_day'
    `).get(term.id).c, 0);

    const paid = safe(() => db.prepare(`
      SELECT COALESCE(SUM(amount), 0) total, COUNT(*) payment_count
      FROM canteen_payments
      WHERE term_id = ? OR (term_id IS NULL AND payment_date >= ? AND payment_date <= ?)
    `).get(term.id, from, to), { total: 0, payment_count: 0 });

    const unpaid = safe(() => db.prepare(`
      SELECT COUNT(*) days, COUNT(DISTINCT student_id) students
      FROM canteen_day_status WHERE status = 'unpaid' AND date >= ? AND date <= ?
    `).get(from, to), { days: 0, students: 0 });

    const activeStudents = safe(() =>
      db.prepare("SELECT COUNT(*) c FROM students WHERE status = 'Active'").get().c, 0);

    const topDebtors = safe(() => db.prepare(`
      SELECT s.id AS student_id, s.surname, s.first_name, s.index_number, s.photo_path,
             cg.short_code AS class_code, cg.name AS class_name,
             COUNT(cds.id) unpaid_days, COUNT(cds.id) * ? amount_owed
      FROM canteen_day_status cds
      JOIN students s ON s.id = cds.student_id
      LEFT JOIN class_groups cg ON cg.id = s.current_class_id
      WHERE cds.status = 'unpaid' AND cds.date >= ? AND cds.date <= ?
      GROUP BY s.id ORDER BY unpaid_days DESC LIMIT 10
    `).all(rate, from, to), []);

    const recentPayments = safe(() => db.prepare(`
      SELECT cp.id, cp.amount, cp.payment_date, cp.days_covered, cp.start_date, cp.end_date,
             s.surname, s.first_name, s.index_number, cg.short_code AS class_code
      FROM canteen_payments cp JOIN students s ON s.id = cp.student_id
      LEFT JOIN class_groups cg ON cg.id = s.current_class_id
      WHERE cp.term_id = ? OR (cp.term_id IS NULL AND cp.payment_date >= ? AND cp.payment_date <= ?)
      ORDER BY cp.payment_date DESC, cp.id DESC LIMIT 10
    `).all(term.id, from, to), []);

    const today = safe(() => db.prepare(`
      SELECT SUM(CASE WHEN status = 'paid'   THEN 1 ELSE 0 END) paid,
             SUM(CASE WHEN status = 'unpaid' THEN 1 ELSE 0 END) unpaid,
             SUM(CASE WHEN status = 'exempt' THEN 1 ELSE 0 END) exempt
      FROM canteen_day_status WHERE date = ?
    `).get(todayISO()), { paid: 0, unpaid: 0, exempt: 0 });

    return json(res, 200, {
      ok: true,
      term: termOut(term),
      daily_rate: rate,
      metrics: {
        total_collected: money(paid.total),
        payment_count: paid.payment_count || 0,
        unpaid_days_total: unpaid.days || 0,
        unpaid_students: unpaid.students || 0,
        amount_owed: money(num(unpaid.days) * rate),
        total_school_days: totalDays,
        active_students: activeStudents,
        attendance_exempt_enabled: getSetting(db, 'canteen_attendance_exempt_enabled', 'true') === 'true',
        today_paid: today.paid || 0,
        today_unpaid: today.unpaid || 0,
        today_exempt: today.exempt || 0,
      },
      top_debtors: topDebtors,
      recent_payments: recentPayments,
    });
  });

  // ══ Staff ═════════════════════════════════════════════════════════════════
  add('GET', `${API}/dash/staff`, async (ctx, req, res) => {
    if (!gate(ctx, res, 'staff')) return undefined;
    const today = todayISO();

    const totalActive = safe(() =>
      db.prepare("SELECT COUNT(*) c FROM staff WHERE status = 'Active'").get().c, 0);
    const totalInactive = safe(() =>
      db.prepare("SELECT COUNT(*) c FROM staff WHERE status != 'Active'").get().c, 0);

    const byRole = safe(() => db.prepare(`
      SELECT COALESCE(role, 'Unassigned') role, COUNT(*) count
      FROM staff WHERE status = 'Active' GROUP BY role ORDER BY count DESC
    `).all(), []);

    const byGender = safe(() => db.prepare(`
      SELECT gender, COUNT(*) count FROM staff WHERE status = 'Active' GROUP BY gender
    `).all(), []);

    const att = safe(() => db.prepare(`
      SELECT SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) present,
             SUM(CASE WHEN status = 'absent'  THEN 1 ELSE 0 END) absent,
             SUM(CASE WHEN status = 'late'    THEN 1 ELSE 0 END) late,
             COUNT(*) total
      FROM staff_attendance WHERE date = ?
    `).get(today), { present: 0, absent: 0, late: 0, total: 0 });

    const pendingLeave = safe(() =>
      db.prepare("SELECT COUNT(*) c FROM leave_requests WHERE status = 'pending'").get().c, 0);
    const onLeave = safe(() => db.prepare(`
      SELECT COUNT(*) c FROM leave_requests
      WHERE status = 'approved' AND start_date <= ? AND end_date >= ?
    `).get(today, today).c, 0);

    const ninetyDays = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    const expiring = safe(() => db.prepare(`
      SELECT sd.id, sd.title, sd.doc_type, sd.expiry_date,
             s.surname, s.first_name, s.id AS staff_id
      FROM staff_documents sd JOIN staff s ON s.id = sd.staff_id
      WHERE sd.expiry_date IS NOT NULL AND sd.expiry_date >= ? AND sd.expiry_date <= ?
        AND s.status = 'Active'
      ORDER BY sd.expiry_date LIMIT 10
    `).all(today, ninetyDays), []);

    const sixMonths = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
    const recentHires = safe(() => db.prepare(`
      SELECT s.id, s.surname, s.first_name, s.role, s.hire_date, s.photo_path
      FROM staff s WHERE s.hire_date >= ? AND s.status = 'Active'
      ORDER BY s.hire_date DESC LIMIT 6
    `).all(sixMonths), []);

    return json(res, 200, {
      ok: true,
      metrics: {
        total_active: totalActive,
        total_inactive: totalInactive,
        total_all: totalActive + totalInactive,
        today_present: att.present || 0,
        today_absent: att.absent || 0,
        today_late: att.late || 0,
        today_total_marked: att.total || 0,
        pending_leave: pendingLeave,
        on_leave_today: onLeave,
        clockin_enabled: getSetting(db, 'staff_clockin_enabled', 'false') === 'true',
      },
      by_role: byRole,
      by_gender: byGender,
      expiring_documents: expiring,
      recent_hires: recentHires,
    });
  });

  // ══ Payroll ═══════════════════════════════════════════════════════════════
  //
  // The five figures the installed application puts above its monthly run:
  // who is on it, what it comes to before deductions, what SSNIT and the GRA
  // take, and what actually leaves the account.
  //
  // SSNIT is reported as three numbers rather than one because they are three
  // different obligations: the worker's 5.5%, the employer's 13%, and the 18.5%
  // that is filed. A single "SSNIT" figure is the one a school gets wrong on
  // the return.
  add('GET', `${API}/dash/payroll`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!gate(ctx, res, 'payroll')) return undefined;
    const now = new Date();
    const month = query && query.month ? parseInt(query.month, 10) : now.getMonth() + 1;
    const year = query && query.year ? parseInt(query.year, 10) : now.getFullYear();
    if (!(month >= 1 && month <= 12) || !(year >= 1970 && year <= 2999)) {
      return json(res, 400, { ok: false, error: 'Bad month or year.' });
    }

    const run = safe(() => db.prepare(`
      SELECT COUNT(*) staff, COALESCE(SUM(gross_salary), 0) gross,
             COALESCE(SUM(net_salary), 0) net,
             COALESCE(SUM(ssnit_worker), 0) ssnit_employee,
             COALESCE(SUM(ssnit_employer), 0) ssnit_employer,
             COALESCE(SUM(paye_tax), 0) paye,
             COUNT(*) FILTER (WHERE is_paid = 1) paid_count,
             COALESCE(SUM(CASE WHEN is_paid = 1 THEN actual_amount_paid ELSE 0 END), 0) paid_total
      FROM staff_salaries WHERE month = ? AND year = ?
    `).get(month, year), {});

    const eligible = safe(() =>
      db.prepare("SELECT COUNT(*) c FROM staff WHERE status = 'Active'").get().c, 0);

    const ssnitCombined = num(run.ssnit_employee) + num(run.ssnit_employer);

    return json(res, 200, {
      ok: true,
      month, year,
      month_label: `${MONTHS[month - 1]} ${year}`,
      metrics: {
        staff_on_run: run.staff || 0,
        eligible_staff: eligible,
        gross: money(run.gross),
        net: money(run.net),
        ssnit_employee: money(run.ssnit_employee),
        ssnit_employer: money(run.ssnit_employer),
        ssnit_combined: money(ssnitCombined),
        paye: money(run.paye),
        employer_cost: money(num(run.gross) + num(run.ssnit_employer)),
        paid_count: run.paid_count || 0,
        paid_total: money(run.paid_total),
        outstanding: money(Math.max(0, num(run.net) - num(run.paid_total))),
      },
    });
  });

  // ══ Finance ═══════════════════════════════════════════════════════════════
  add('GET', `${API}/dash/finance`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!gate(ctx, res, 'finance')) return undefined;
    const term = termOf(query);
    if (!term) {
      return json(res, 200, {
        ok: true, term: null, metrics: {},
        income_by_category: [], expense_by_category: [],
        recent_income: [], recent_expenses: [],
      });
    }
    const from = term.start_date, to = term.end_date;

    const income = safe(() => db.prepare(`
      SELECT category, COALESCE(SUM(amount), 0) total FROM income_records
      WHERE term_id = ? OR (term_id IS NULL AND COALESCE(transaction_date, date) BETWEEN ? AND ?)
      GROUP BY category ORDER BY total DESC
    `).all(term.id, from, to), []);

    const expense = safe(() => db.prepare(`
      SELECT category, COALESCE(SUM(amount), 0) total FROM expense_records
      WHERE term_id = ? OR (term_id IS NULL AND COALESCE(transaction_date, date) BETWEEN ? AND ?)
      GROUP BY category ORDER BY total DESC
    `).all(term.id, from, to), []);

    const incomeTotal = income.reduce((n, r) => n + num(r.total), 0);
    const expenseTotal = expense.reduce((n, r) => n + num(r.total), 0);

    const expected = safe(() => {
      const billing = require('../ipc/_billing');
      return billing.projectedIncomeForTerm(db, term.id).total;
    }, 0);

    const staffCount = safe(() =>
      db.prepare("SELECT COUNT(*) c FROM staff WHERE status = 'Active'").get().c, 0);

    const recentIncome = safe(() => db.prepare(`
      SELECT ir.id, ir.receipt_number, ir.category, ir.amount, ir.payer_name,
             ir.description, COALESCE(ir.transaction_date, ir.date) transaction_date
      FROM income_records ir
      WHERE ir.term_id = ? OR (ir.term_id IS NULL AND COALESCE(ir.transaction_date, ir.date) BETWEEN ? AND ?)
      ORDER BY COALESCE(ir.transaction_date, ir.date) DESC, ir.id DESC LIMIT 5
    `).all(term.id, from, to), []);

    const recentExpenses = safe(() => db.prepare(`
      SELECT er.id, er.transaction_number, er.category, er.amount, er.payee_name,
             er.description, COALESCE(er.transaction_date, er.date) transaction_date
      FROM expense_records er
      WHERE er.term_id = ? OR (er.term_id IS NULL AND COALESCE(er.transaction_date, er.date) BETWEEN ? AND ?)
      ORDER BY COALESCE(er.transaction_date, er.date) DESC, er.id DESC LIMIT 5
    `).all(term.id, from, to), []);

    return json(res, 200, {
      ok: true,
      term: termOut(term),
      may: { record: can(ctx, 'finance', 'create') || can(ctx, 'finance', 'edit') },
      metrics: {
        expected_income: money(expected),
        income_total: money(incomeTotal),
        expense_total: money(expenseTotal),
        net: money(incomeTotal - expenseTotal),
        staff_active: staffCount,
      },
      income_by_category: income,
      expense_by_category: expense,
      recent_income: recentIncome,
      recent_expenses: recentExpenses,
    });
  });
}

module.exports = { registerDashboardRoutes };
