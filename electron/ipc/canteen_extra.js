// Nickland Edusoft — Canteen Extra IPC (dashboard, quick-pay, bulk-pay, exemptions)
// Copyright © 2026 Nickland Sales. All rights reserved.
const { postIncome } = require('./_ledger');
const { getNextReceiptNumber } = require('../utils/idgen');

// Resolve the term a canteen collection belongs to.
//
// This must be the term of the DAYS BEING PAID FOR, not the day the cash was
// handed over: parents settle canteen arrears during vacation, when "today"
// falls outside every term window. Attributing by payment_date made those
// collections vanish from the canteen module (which filtered by the term's
// date range) while the ledger still counted them under the current term —
// the "canteen income does not match canteen payments" audit finding.
// Both sides now agree because the same term id is written to
// canteen_payments.term_id AND passed to postIncome.
function resolveCanteenTerm(db, dates) {
  const list = (Array.isArray(dates) ? dates : [dates]).filter(Boolean);
  for (const d of list) {
    const viaCalendar = db.prepare('SELECT term_id FROM school_calendar WHERE date = ? AND term_id IS NOT NULL').get(d);
    if (viaCalendar?.term_id) return viaCalendar.term_id;
  }
  for (const d of list) {
    const viaWindow = db.prepare(`
      SELECT id FROM terms
      WHERE start_date IS NOT NULL AND end_date IS NOT NULL
        AND date(start_date) <= date(?) AND date(end_date) >= date(?)
      ORDER BY date(start_date) DESC LIMIT 1
    `).get(d, d);
    if (viaWindow?.id) return viaWindow.id;
  }
  return db.prepare('SELECT id FROM terms WHERE is_current = 1').get()?.id || null;
}

function getDailyRate(db) {
  const r = db.prepare("SELECT value FROM settings WHERE key = 'canteen_daily_rate'").get();
  return parseFloat(r ? r.value : '5.00');
}

function isAttendanceExemptEnabled(db) {
  const r = db.prepare("SELECT value FROM settings WHERE key = 'canteen_attendance_exempt_enabled'").get();
  return r ? r.value === 'true' : true;
}


// ── Quick daily collection, shared ────────────────────────────────────────────
// These three were written inside the IPC closure, which meant only the desktop
// could reach them: the teacher's app had no quick-pay at all and had to
// collect from one pupil at a time. Lifting them out is what lets both surfaces
// run the SAME code — the alternative, a second implementation behind the API,
// is a second set of rounding bugs and a second place to forget the ledger.

// Who is in the class, and where each pupil stands on one particular day.
function classRosterForDate(db, classId, date) {
  const students = db.prepare(`
    SELECT s.id, s.index_number, s.surname, s.first_name, s.other_names, s.photo_path
    FROM students s
    WHERE s.current_class_id = ? AND s.status = 'Active'
    ORDER BY s.surname, s.first_name
  `).all(classId);

  if (students.length === 0) return [];

  const sids = students.map(s => s.id);
  const placeholders = sids.map(() => '?').join(',');
  const att = db.prepare(`
    SELECT student_id, status FROM student_attendance
    WHERE student_id IN (${placeholders}) AND date = ?
  `).all(...sids, date);
  const attMap = Object.fromEntries(att.map(a => [a.student_id, a.status]));

  const cds = db.prepare(`
    SELECT student_id, status FROM canteen_day_status
    WHERE student_id IN (${placeholders}) AND date = ?
  `).all(...sids, date);
  const cdsMap = Object.fromEntries(cds.map(c => [c.student_id, c.status]));

  return students.map(s => ({
    ...s,
    attendance_status: attMap[s.id] || null,
    canteen_status: cdsMap[s.id] || 'unpaid',
  }));
}

// Mark a batch of pupils paid for one day, at the daily rate, posting each
// collection to the finance ledger as it goes.
function markBulkPaid(db, { studentIds, date, paymentMethod, receivedBy }) {
  if (!studentIds || studentIds.length === 0) return { ok: false, error: 'No students selected' };
  const dailyRate = getDailyRate(db);
  const today = new Date().toISOString().slice(0, 10);
  const termId = resolveCanteenTerm(db, date);

  const tx = db.transaction(() => {
    let totalAmount = 0;
    let marked = 0;
    for (const sid of studentIds) {
      // A day already settled is left exactly as it is. Without this a second
      // tap of "Record" — a slow connection, a teacher pressing twice — bills
      // the same child for the same lunch again, and the ledger believes it.
      const existing = db.prepare('SELECT status FROM canteen_day_status WHERE student_id = ? AND date = ?').get(sid, date);
      if (existing && (existing.status === 'paid' || existing.status === 'exempt')) continue;

      const payRes = db.prepare(`
        INSERT INTO canteen_payments
          (student_id, term_id, payment_date, amount, days_covered, start_date, end_date,
           received_by, notes)
        VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'Bulk daily collection')
      `).run(sid, termId, today, dailyRate, date, date, receivedBy || null);

      db.prepare(`
        INSERT INTO canteen_day_status (student_id, date, status, payment_id)
        VALUES (?, ?, 'paid', ?)
        ON CONFLICT (student_id, date) DO UPDATE SET
          status = 'paid', payment_id = excluded.payment_id
      `).run(sid, date, payRes.lastInsertRowid);

      // Post this collection to the finance ledger. This was missing
      // entirely: the whole-class daily collection created payment rows and
      // marked the days paid, but never posted income — so real cash taken
      // at the gate never appeared in Finance, and the canteen module
      // reported money the ledger had no record of.
      postIncome(db, {
        category: 'canteen',
        amount: dailyRate,
        description: `Canteen — ${date} (daily collection)`,
        payment_method: paymentMethod || 'Cash',
        date: today,
        term_id: termId,
        source: 'canteen_bulk',
        student_id: sid,
        linked_canteen_payment_id: payRes.lastInsertRowid,
        recorded_by: receivedBy || null,
        is_auto: 1,
      });

      totalAmount += dailyRate;
      marked++;
    }
    return { total: Math.round(totalAmount * 100) / 100, marked };
  });

  const { total, marked } = tx();
  return { ok: true, count: marked, skipped: studentIds.length - marked, total, daily_rate: dailyRate };
}

// Excuse a pupil from paying on given days — absent, or excused by the office.
function markExempt(db, { studentId, dates }) {
  if (!dates || dates.length === 0) return { ok: false, error: 'No dates given.' };
  const stmt = db.prepare(`
    INSERT INTO canteen_day_status (student_id, date, status)
    VALUES (?, ?, 'exempt')
    ON CONFLICT (student_id, date) DO UPDATE SET status = 'exempt'
  `);
  // A day already paid for is not quietly turned into an exemption: that would
  // strand a real payment row against a day the school now says was free.
  const paid = db.prepare("SELECT date FROM canteen_day_status WHERE student_id = ? AND status = 'paid'").all(studentId)
    .map(r => r.date);
  const doable = dates.filter(d => !paid.includes(d));
  const tx = db.transaction(() => { for (const d of doable) stmt.run(studentId, d); });
  tx();
  return { ok: true, count: doable.length, skipped: dates.length - doable.length };
}

module.exports = function registerCanteenExtraHandlers(ipcMain, db) {

  // ── Dashboard ────────────────────────────────────────
  ipcMain.handle('canteen:dashboard', (_e, termId) => {
    const term = termId
      ? db.prepare('SELECT * FROM terms WHERE id = ?').get(termId)
      : db.prepare("SELECT * FROM terms WHERE is_current = 1").get();
    if (!term) return { metrics: {}, debtors: [], recent_payments: [] };

    const dailyRate = getDailyRate(db);

    // Days in this term
    const totalDays = db.prepare(`
      SELECT COUNT(*) AS c FROM school_calendar
      WHERE term_id = ? AND day_type = 'school_day'
    `).get(term.id).c;

    // Total paid in this term.
    //
    // Scoped by term_id — the same key the income ledger is attributed by — so
    // a collection taken outside the term's date window (e.g. arrears settled
    // during vacation) is still counted here. Rows from older installs whose
    // term_id was never backfilled fall back to the date window.
    const paidRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total,
             COUNT(*) AS payment_count
      FROM canteen_payments
      WHERE term_id = ?
         OR (term_id IS NULL AND payment_date >= ? AND payment_date <= ?)
    `).get(term.id, term.start_date, term.end_date);

    // Days unpaid (status='unpaid' across all students in this term)
    const unpaidRow = db.prepare(`
      SELECT COUNT(*) AS days, COUNT(DISTINCT student_id) AS students
      FROM canteen_day_status
      WHERE status = 'unpaid' AND date >= ? AND date <= ?
    `).get(term.start_date, term.end_date);

    // Total active students
    const activeStudents = db.prepare(`
      SELECT COUNT(*) AS c FROM students WHERE status = 'Active'
    `).get().c;

    // Top debtors
    const topDebtors = db.prepare(`
      SELECT
        s.id AS student_id, s.surname, s.first_name, s.index_number,
        cg.short_code AS class_code, cg.name AS class_name,
        COUNT(cds.id) AS unpaid_days,
        COUNT(cds.id) * ? AS amount_owed
      FROM canteen_day_status cds
      JOIN students s ON s.id = cds.student_id
      LEFT JOIN class_groups cg ON cg.id = s.current_class_id
      WHERE cds.status = 'unpaid' AND cds.date >= ? AND cds.date <= ?
      GROUP BY s.id
      ORDER BY unpaid_days DESC
      LIMIT 10
    `).all(dailyRate, term.start_date, term.end_date);

    // Recent payments
    const recentPayments = db.prepare(`
      SELECT
        cp.id, cp.amount, cp.payment_date, cp.days_covered, cp.start_date, cp.end_date,
        s.surname, s.first_name, s.index_number,
        cg.short_code AS class_code
      FROM canteen_payments cp
      JOIN students s ON s.id = cp.student_id
      LEFT JOIN class_groups cg ON cg.id = s.current_class_id
      WHERE cp.term_id = ?
         OR (cp.term_id IS NULL AND cp.payment_date >= ? AND cp.payment_date <= ?)
      ORDER BY cp.payment_date DESC, cp.id DESC
      LIMIT 10
    `).all(term.id, term.start_date, term.end_date);

    // Today's status
    const today = new Date().toISOString().slice(0, 10);
    const todayStats = db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paid,
        SUM(CASE WHEN status = 'unpaid' THEN 1 ELSE 0 END) AS unpaid,
        SUM(CASE WHEN status = 'exempt' THEN 1 ELSE 0 END) AS exempt
      FROM canteen_day_status WHERE date = ?
    `).get(today);

    return {
      term: { id: term.id, label: term.label, start_date: term.start_date, end_date: term.end_date },
      daily_rate: dailyRate,
      metrics: {
        // Money is rounded to pesewas, not whole cedis — Math.round() here
        // silently dropped up to 0.99 per figure and made the audit's
        // ledger-vs-module comparison disagree by the rounding error alone.
        total_collected: Math.round((paidRow.total || 0) * 100) / 100,
        payment_count: paidRow.payment_count,
        unpaid_days_total: unpaidRow.days,
        unpaid_students: unpaidRow.students,
        amount_owed: Math.round((unpaidRow.days || 0) * dailyRate * 100) / 100,
        total_school_days: totalDays,
        active_students: activeStudents,
        attendance_exempt_enabled: isAttendanceExemptEnabled(db),
        today_paid: todayStats?.paid || 0,
        today_unpaid: todayStats?.unpaid || 0,
        today_exempt: todayStats?.exempt || 0,
      },
      top_debtors: topDebtors,
      recent_payments: recentPayments,
    };
  });

  // ── Class roster for a date (for quick-pay) ──────────
  ipcMain.handle('canteen:class-roster-for-date', (_e, { classId, date }) => classRosterForDate(db, classId, date));

  // ── WHONET multi-day canteen sheet (students × multiple dates) ──
  // Returns each student with their canteen status for each given date.
  ipcMain.handle('canteen:class-roster-for-range', (_e, { classId, dates }) => {
    if (!classId || !dates || dates.length === 0) return [];
    const students = db.prepare(`
      SELECT s.id, s.index_number, s.surname, s.first_name
      FROM students s
      WHERE s.current_class_id = ? AND s.status = 'Active'
      ORDER BY s.surname, s.first_name
    `).all(classId);
    if (students.length === 0) return [];

    const sids = students.map(s => s.id);
    const sidPh = sids.map(() => '?').join(',');
    const datePh = dates.map(() => '?').join(',');

    // Canteen statuses for ALL dates × ALL students in one query
    const cds = db.prepare(`
      SELECT student_id, date, status FROM canteen_day_status
      WHERE student_id IN (${sidPh}) AND date IN (${datePh})
    `).all(...sids, ...dates);

    // Attendance statuses (so we can mark Absent days)
    const att = db.prepare(`
      SELECT student_id, date, status FROM student_attendance
      WHERE student_id IN (${sidPh}) AND date IN (${datePh})
    `).all(...sids, ...dates);

    return students.map(s => {
      const canteen = {};
      for (const r of cds) {
        if (r.student_id === s.id) canteen[r.date] = r.status;
      }
      const attendance = {};
      for (const r of att) {
        if (r.student_id === s.id) attendance[r.date] = r.status;
      }
      const paidCount = Object.values(canteen).filter(v => v === 'paid').length;
      const exemptCount = Object.values(canteen).filter(v => v === 'exempt').length;
      const unpaidCount = dates.length - paidCount - exemptCount;
      return {
        student_id: s.id,
        index_number: s.index_number,
        surname: s.surname,
        first_name: s.first_name,
        canteen,        // { '2026-05-27': 'paid' | 'unpaid' | 'exempt' }
        attendance,     // { '2026-05-27': 'present' | 'absent' }
        paid_count: paidCount,
        exempt_count: exemptCount,
        unpaid_count: unpaidCount,
      };
    });
  });

  // Mark a single cell (one student, one date) in the multi-day sheet.
  // Used by the WHONET sheet's per-cell click; creates a payment record only
  // when transitioning to 'paid' so income is recorded properly.
  ipcMain.handle('canteen:set-day-status', (_e, { studentId, date, status, receivedBy, paymentMethod }) => {
    if (!['paid', 'unpaid', 'exempt'].includes(status)) {
      return { ok: false, error: 'Invalid status' };
    }
    const today = new Date().toISOString().slice(0, 10);
    const dailyRate = getDailyRate(db);

    const tx = db.transaction(() => {
      // Get existing row (if any)
      const existing = db.prepare(
        'SELECT id, status, payment_id FROM canteen_day_status WHERE student_id = ? AND date = ?'
      ).get(studentId, date);

      // If transitioning AWAY from 'paid', undo the prior payment link.
      if (existing?.payment_id && existing.status === 'paid' && status !== 'paid') {
        db.prepare(`
          UPDATE canteen_day_status SET status = ?, payment_id = NULL
          WHERE student_id = ? AND date = ?
        `).run(status, studentId, date);

        // A quick-pay cell entry covers exactly this one day. Un-ticking it is
        // a correction, so the auto-created payment and its auto-posted income
        // must go with it — otherwise the school keeps money on the books for a
        // day the pupil is now shown as owing, and gets charged for it twice.
        // Multi-day payments are left alone (they cannot be safely split) and
        // are recorded to the audit log for manual reconciliation instead.
        const pay = db.prepare('SELECT id, days_covered, amount FROM canteen_payments WHERE id = ?').get(existing.payment_id);
        if (pay && (pay.days_covered || 0) <= 1) {
          db.prepare('DELETE FROM income_records WHERE linked_canteen_payment_id = ?').run(pay.id);
          db.prepare('DELETE FROM canteen_payments WHERE id = ?').run(pay.id);
        } else if (pay) {
          try {
            db.prepare(`
              INSERT INTO audit_log (entity_type, entity_id, action, justification, severity)
              VALUES ('canteen_payment', ?, 'day_unmarked_manual_reconcile', ?, 'medium')
            `).run(pay.id, `Day ${date} un-marked for student ${studentId}, but payment #${pay.id} covers ${pay.days_covered} days (GHS ${pay.amount}). Reconcile manually.`);
          } catch (_) { /* audit is best-effort */ }
        }
        return { paymentId: null };
      }

      // If transitioning TO 'paid', create a small one-day payment for the cell
      if (status === 'paid' && existing?.status !== 'paid') {
        const termId = resolveCanteenTerm(db, date);
        const payRes = db.prepare(`
          INSERT INTO canteen_payments
            (student_id, term_id, payment_date, amount, days_covered, start_date, end_date, received_by, notes)
          VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'Quick-pay cell entry')
        `).run(studentId, termId, today, dailyRate, date, date, receivedBy || null);
        const paymentId = payRes.lastInsertRowid;

        db.prepare(`
          INSERT INTO canteen_day_status (student_id, date, status, payment_id)
          VALUES (?, ?, 'paid', ?)
          ON CONFLICT (student_id, date) DO UPDATE SET status = 'paid', payment_id = excluded.payment_id
        `).run(studentId, date, paymentId);

        // Auto-record income via central ledger helper, under the SAME term the
        // payment row carries so the ledger and the canteen module agree.
        postIncome(db, {
          category: 'canteen',
          amount: dailyRate,
          description: `Canteen — ${date}`,
          payment_method: paymentMethod || 'Cash',
          date: today,
          term_id: termId,
          source: 'canteen_quick',
          student_id: studentId,
          linked_canteen_payment_id: paymentId,
          recorded_by: receivedBy || null,
          is_auto: 1,
        });
        return { paymentId };
      }

      // Same status or exempt/unpaid update without prior payment
      db.prepare(`
        INSERT INTO canteen_day_status (student_id, date, status)
        VALUES (?, ?, ?)
        ON CONFLICT (student_id, date) DO UPDATE SET status = excluded.status
      `).run(studentId, date, status);
      return { paymentId: null };
    });

    try {
      const result = tx();
      return { ok: true, ...result };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── Mark days paid for one student (multi-day selection) ──
  ipcMain.handle('canteen:mark-days-paid', (_e, { studentId, dates, paymentMethod, notes, receivedBy }) => {
    if (!dates || dates.length === 0) return { ok: false, error: 'No dates selected' };
    const dailyRate = getDailyRate(db);
    const amount = dates.length * dailyRate;
    const today = new Date().toISOString().slice(0, 10);
    const sortedDates = [...dates].sort();

    const termId = resolveCanteenTerm(db, sortedDates);

    const tx = db.transaction(() => {
      // Create payment record
      const payRes = db.prepare(`
        INSERT INTO canteen_payments
          (student_id, term_id, payment_date, amount, days_covered, start_date, end_date,
           received_by, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        studentId, termId, today, amount, dates.length,
        sortedDates[0], sortedDates[sortedDates.length - 1],
        receivedBy || null, notes || null
      );

      // Mark each day paid
      const stmt = db.prepare(`
        INSERT INTO canteen_day_status (student_id, date, status, payment_id)
        VALUES (?, ?, 'paid', ?)
        ON CONFLICT (student_id, date) DO UPDATE SET
          status = 'paid', payment_id = excluded.payment_id
      `);
      for (const d of dates) stmt.run(studentId, d, payRes.lastInsertRowid);

      // Auto-record income via central ledger helper. Use the shared,
      // upsert-backed counter (a bare UPDATE no-ops if the row is missing).
      const n = getNextReceiptNumber(db);
      const receiptNo = `CT/${new Date().getFullYear().toString().slice(-2)}/${String(n).padStart(5, '0')}`;

      postIncome(db, {
        receipt_number: receiptNo,
        category: 'canteen',
        amount,
        description: `Canteen payment — ${dates.length} day${dates.length > 1 ? 's' : ''}`,
        payment_method: paymentMethod || 'Cash',
        date: today,
        term_id: termId,
        source: 'canteen_payment',
        student_id: studentId,
        linked_canteen_payment_id: payRes.lastInsertRowid,
        recorded_by: receivedBy || null,
        is_auto: 1,
      });

      return payRes.lastInsertRowid;
    });

    const paymentId = tx();
    return { ok: true, payment_id: paymentId, amount, days: dates.length };
  });

  // ── Mark bulk paid for a class on a date (quick daily pay) ──
  ipcMain.handle('canteen:mark-bulk-paid', (_e, { studentIds, date, paymentMethod, receivedBy }) =>
    markBulkPaid(db, { studentIds, date, paymentMethod, receivedBy }));

  // ── Mark exempt (absent or excused) for a student on dates ──
  ipcMain.handle('canteen:mark-exempt', (_e, { studentId, dates, reason }) =>
    markExempt(db, { studentId, dates, reason }));

  // ── Apply attendance-linked exemption for a date range ──
  // For every student absent on a school day, mark canteen as exempt
  ipcMain.handle('canteen:apply-attendance-exemption', (_e, { fromDate, toDate }) => {
    if (!isAttendanceExemptEnabled(db)) {
      return { ok: false, error: 'Attendance exemption is disabled in Settings' };
    }
    const result = db.prepare(`
      INSERT INTO canteen_day_status (student_id, date, status)
      SELECT sa.student_id, sa.date, 'exempt'
      FROM student_attendance sa
      JOIN school_calendar sc ON sc.date = sa.date AND sc.day_type = 'school_day'
      WHERE sa.status = 'absent'
        AND sa.date >= ? AND sa.date <= ?
        AND NOT EXISTS (
          SELECT 1 FROM canteen_day_status cds
          WHERE cds.student_id = sa.student_id
          AND cds.date = sa.date
          AND cds.status = 'paid'
        )
      ON CONFLICT (student_id, date) DO UPDATE SET status = 'exempt'
    `).run(fromDate, toDate);
    return { ok: true, count: result.changes };
  });
};

// Shared with the mobile/web API (electron/server/staff_api.js), so a teacher
// collecting on a phone runs the same code as the office does on the desktop.
module.exports.classRosterForDate = classRosterForDate;
module.exports.markBulkPaid = markBulkPaid;
module.exports.markExempt = markExempt;
module.exports.getDailyRate = getDailyRate;
module.exports.resolveCanteenTerm = resolveCanteenTerm;
