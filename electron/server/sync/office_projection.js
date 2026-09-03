// Nickland Edusoft — projecting the OFFICE read model to the cloud.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// staff_projection.js gives a teacher enough to work off-LAN. This gives the
// office enough to KNOW off-LAN: the term's fee position, the ledger's shape,
// this month's payroll, the school's enrolment and attendance this morning,
// and what is sitting there waiting for somebody to approve it.
//
// Two summaries, and deliberately only two:
//
//   finance_summary  finance:school   money
//   admin_summary    admin:school     the school
//
// What is NOT projected is the point of the design. Not the ledger — every
// income and expense row a school has ever recorded is its whole financial
// history, and putting a copy of it on somebody else's server is a liability
// the school did not ask for and cannot audit. Not a payroll line per member of
// staff; the totals, not what each person earns. Not a pupil's record. The
// question these answer is "how are we doing", which is the question somebody
// away from the school actually has, and it is answerable in a few kilobytes.
//
// The cloud filters them again by permission before serving (cloud/src/office.js):
// a head teacher who may not see expenditure is not sent it, even though the
// school pushed it. Projecting a summary and filtering on read is the same
// arrangement the teacher surface already uses.

const { postToOutbox, syncEnabled } = require('./outbox');
const { getSetting } = require('../../utils/idgen');

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const todayISO = () => new Date().toISOString().slice(0, 10);

function currentTerm(db) {
  try { return db.prepare('SELECT * FROM terms WHERE is_current = 1').get() || null; }
  catch (_) { return null; }
}

// ── finance_summary ─────────────────────────────────────────────────────────

function enqueueFinanceSummary(db) {
  try {
    if (!syncEnabled(db)) return null;
    const term = currentTerm(db);
    const from = (term && term.start_date) || '1970-01-01';
    const to = (term && term.end_date) || '2099-12-31';

    const collected = term ? db.prepare(
      'SELECT COALESCE(SUM(amount),0) t, COUNT(*) n FROM payments WHERE term_id = ? AND is_reversed = 0'
    ).get(term.id) : { t: 0, n: 0 };
    const billed = term ? db.prepare(`
      SELECT COALESCE(SUM(total_billed),0) billed, COALESCE(SUM(balance),0) outstanding,
             COUNT(*) FILTER (WHERE balance > 0) debtors, COUNT(*) bills
      FROM student_bills WHERE term_id = ? AND COALESCE(status,'active') = 'active'
    `).get(term.id) : { billed: 0, outstanding: 0, debtors: 0, bills: 0 };
    const today = db.prepare(
      'SELECT COALESCE(SUM(amount),0) t, COUNT(*) n FROM payments WHERE payment_date = ? AND is_reversed = 0'
    ).get(todayISO());

    const income = db.prepare(`
      SELECT COALESCE(SUM(amount),0) t FROM income_records
      WHERE COALESCE(transaction_date, date) BETWEEN ? AND ?
    `).get(from, to).t;
    const expense = db.prepare(`
      SELECT COALESCE(SUM(amount),0) t FROM expense_records
      WHERE COALESCE(transaction_date, date) BETWEEN ? AND ?
    `).get(from, to).t;

    const now = new Date();
    const payrollRow = db.prepare(`
      SELECT COUNT(*) n, COALESCE(SUM(net_salary),0) net,
             COUNT(*) FILTER (WHERE is_paid = 1) paid,
             COALESCE(SUM(CASE WHEN is_paid = 1 THEN actual_amount_paid ELSE 0 END),0) paid_total
      FROM staff_salaries WHERE month = ? AND year = ?
    `).get(now.getMonth() + 1, now.getFullYear());

    const payload = {
      term: term ? { id: term.id, label: term.label, start_date: term.start_date, end_date: term.end_date } : null,
      currency: getSetting(db, 'payment_currency', 'GHS'),
      fees: {
        billed: num(billed.billed), collected: num(collected.t), receipts: collected.n,
        outstanding: num(billed.outstanding), debtors: billed.debtors, bills: billed.bills,
        today: num(today.t), today_receipts: today.n,
        collection_rate: billed.billed ? Math.round((collected.t / billed.billed) * 100) : 0,
        pending_intents: db.prepare("SELECT COUNT(*) c FROM payment_intents WHERE status = 'pending'").get().c,
      },
      ledger: { income: num(income), expense: num(expense), net: num(income) - num(expense) },
      expense_categories: db.prepare(`
        SELECT category, COALESCE(SUM(amount),0) total, COUNT(*) n FROM expense_records
        WHERE COALESCE(transaction_date, date) BETWEEN ? AND ?
        GROUP BY category ORDER BY total DESC LIMIT 8
      `).all(from, to),
      payroll: {
        month: now.getMonth() + 1, year: now.getFullYear(),
        staff: payrollRow.n, net: num(payrollRow.net), paid: payrollRow.paid,
        paid_total: num(payrollRow.paid_total),
        outstanding: Math.max(0, num(payrollRow.net) - num(payrollRow.paid_total)),
      },
      // The last dozen receipts, so the office can see the day's takings from
      // anywhere. Names, not records: enough to recognise a payment, not
      // enough to be a copy of the roll.
      recent: db.prepare(`
        SELECT p.receipt_number, p.amount, p.payment_date, p.payment_method,
               TRIM(s.surname || ' ' || s.first_name) student_name, c.name class_name
        FROM payments p JOIN students s ON s.id = p.student_id
        LEFT JOIN class_groups c ON c.id = s.current_class_id
        WHERE p.is_reversed = 0 ORDER BY date(p.payment_date) DESC, p.id DESC LIMIT 12
      `).all(),
      top_debtors: term ? db.prepare(`
        SELECT s.id student_id, TRIM(s.surname || ' ' || s.first_name) student_name,
               s.index_number, c.name class_name, b.balance
        FROM student_bills b JOIN students s ON s.id = b.student_id
        LEFT JOIN class_groups c ON c.id = s.current_class_id
        WHERE b.term_id = ? AND b.balance > 0 AND s.status = 'Active'
          AND COALESCE(b.status,'active') = 'active'
        ORDER BY b.balance DESC LIMIT 10
      `).all(term.id) : [],
      debtors_by_class: term ? db.prepare(`
        SELECT c.name class_name, COUNT(*) n, COALESCE(SUM(b.balance),0) total
        FROM student_bills b JOIN students s ON s.id = b.student_id
        LEFT JOIN class_groups c ON c.id = s.current_class_id
        WHERE b.term_id = ? AND b.balance > 0 AND s.status = 'Active'
          AND COALESCE(b.status,'active') = 'active'
        GROUP BY c.id ORDER BY total DESC
      `).all(term.id) : [],
      updated_at: new Date().toISOString(),
    };

    return postToOutbox(db, {
      entity_type: 'finance_summary', entity_key: 'finance:school', payload,
    });
  } catch (_) { return null; }
}

// ── admin_summary ───────────────────────────────────────────────────────────

function enqueueAdminSummary(db) {
  try {
    if (!syncEnabled(db)) return null;
    const term = currentTerm(db);
    const today = todayISO();

    const enrolment = db.prepare(`
      SELECT COUNT(*) total,
             COUNT(*) FILTER (WHERE gender = 'Male') boys,
             COUNT(*) FILTER (WHERE gender = 'Female') girls
      FROM students WHERE status = 'Active'
    `).get();
    const byClass = db.prepare(`
      SELECT c.id, c.name, c.short_code, COUNT(s.id) pupils
      FROM class_groups c LEFT JOIN students s ON s.current_class_id = c.id AND s.status = 'Active'
      GROUP BY c.id ORDER BY c.level_order, c.name
    `).all();
    // The register belongs to a pupil; the class is reached through the pupil.
    const att = db.prepare(`
      SELECT COUNT(*) FILTER (WHERE a.status = 'present') present,
             COUNT(*) FILTER (WHERE a.status = 'absent') absent,
             COUNT(DISTINCT s.current_class_id) classes_marked
      FROM student_attendance a JOIN students s ON s.id = a.student_id
      WHERE a.date = ?
    `).get(today);

    const staffRow = db.prepare(`
      SELECT COUNT(*) total, COUNT(*) FILTER (WHERE role LIKE '%each%') teaching
      FROM staff WHERE status = 'Active'
    `).get();
    staffRow.clocked_in = db.prepare(
      "SELECT COUNT(*) c FROM staff_attendance WHERE date = ? AND status = 'present'"
    ).get(today).c;

    // Class-by-class performance from marks already entered — the same
    // averages the broadsheet shows, one level up.
    const classes = term ? (() => {
      const marks = db.prepare(`
        SELECT s.current_class_id class_id, COUNT(*) entries,
               ROUND(AVG(sc.total_score), 1) average,
               COUNT(*) FILTER (WHERE sc.total_score >= 50) passes
        FROM scores sc JOIN students s ON s.id = sc.student_id
        WHERE sc.term_id = ? AND s.status = 'Active' AND sc.total_score IS NOT NULL
        GROUP BY s.current_class_id
      `).all(term.id);
      const byId = new Map(marks.map(m => [m.class_id, m]));
      return byClass.map(c => {
        const m = byId.get(c.id) || {};
        return {
          id: c.id, name: c.name, pupils: c.pupils,
          entries: m.entries || 0,
          average: m.average == null ? null : num(m.average),
          pass_rate: m.entries ? Math.round((m.passes / m.entries) * 100) : null,
        };
      });
    })() : [];

    const pendingLeave = db.prepare(`
      SELECT lr.id, lr.leave_type, lr.start_date, lr.end_date, lr.days_requested,
             lr.justification, lr.created_at,
             TRIM(st.surname || ' ' || st.first_name) staff_name, st.staff_number, st.role
      FROM leave_requests lr JOIN staff st ON st.id = lr.staff_id
      WHERE lr.status = 'pending' ORDER BY lr.id DESC LIMIT 50
    `).all();
    const pendingNotes = db.prepare(`
      SELECT ln.id, ln.topic AS title, ln.week_number, ln.lesson_date, ln.updated_at,
             c.name class_name, sub.name subject_name,
             TRIM(st.surname || ' ' || st.first_name) teacher_name
      FROM lesson_notes ln
      LEFT JOIN class_groups c ON c.id = ln.class_group_id
      LEFT JOIN subjects sub ON sub.id = ln.subject_id
      LEFT JOIN staff st ON st.id = ln.staff_id
      WHERE COALESCE(ln.status,'draft') = 'submitted' ORDER BY ln.id DESC LIMIT 50
    `).all();

    const fees = term ? (() => {
      const f = db.prepare(`
        SELECT COALESCE(SUM(total_billed),0) billed, COALESCE(SUM(balance),0) outstanding
        FROM student_bills WHERE term_id = ? AND COALESCE(status,'active') = 'active'
      `).get(term.id);
      const collected = db.prepare(
        'SELECT COALESCE(SUM(amount),0) t FROM payments WHERE term_id = ? AND is_reversed = 0'
      ).get(term.id).t;
      return {
        billed: num(f.billed), collected: num(collected), outstanding: num(f.outstanding),
        collection_rate: f.billed ? Math.round((collected / f.billed) * 100) : 0,
      };
    })() : null;

    return postToOutbox(db, {
      entity_type: 'admin_summary', entity_key: 'admin:school',
      payload: {
        date: today,
        term: term ? { id: term.id, label: term.label } : null,
        enrolment,
        by_class: byClass,
        attendance: {
          ...att,
          classes_total: byClass.filter(c => c.pupils > 0).length,
          rate: (att.present + att.absent) ? Math.round((att.present / (att.present + att.absent)) * 100) : null,
        },
        staff: staffRow,
        classes,
        approvals: { leave: pendingLeave.length, lesson_notes: pendingNotes.length },
        pending_leave: pendingLeave,
        pending_lesson_notes: pendingNotes,
        fees,
        updated_at: new Date().toISOString(),
      },
    });
  } catch (_) { return null; }
}

/** Both, for the sync cycle and the backfill. */
function enqueueOffice(db) {
  const counts = { finance: 0, admin: 0 };
  if (enqueueFinanceSummary(db)) counts.finance = 1;
  if (enqueueAdminSummary(db)) counts.admin = 1;
  return counts;
}

module.exports = { enqueueFinanceSummary, enqueueAdminSummary, enqueueOffice };
