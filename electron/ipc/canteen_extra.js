// Nickland Edusoft — Canteen Extra IPC (dashboard, quick-pay, bulk-pay, exemptions)
// Copyright © 2026 Nickland Sales. All rights reserved.

function getDailyRate(db) {
  const r = db.prepare("SELECT value FROM settings WHERE key = 'canteen_daily_rate'").get();
  return parseFloat(r ? r.value : '5.00');
}

function isAttendanceExemptEnabled(db) {
  const r = db.prepare("SELECT value FROM settings WHERE key = 'canteen_attendance_exempt_enabled'").get();
  return r ? r.value === 'true' : true;
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

    // Total paid in this term
    const paidRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total,
             COUNT(*) AS payment_count
      FROM canteen_payments
      WHERE payment_date >= ? AND payment_date <= ?
    `).get(term.start_date, term.end_date);

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
      WHERE cp.payment_date >= ? AND cp.payment_date <= ?
      ORDER BY cp.payment_date DESC, cp.id DESC
      LIMIT 10
    `).all(term.start_date, term.end_date);

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
        total_collected: Math.round(paidRow.total),
        payment_count: paidRow.payment_count,
        unpaid_days_total: unpaidRow.days,
        unpaid_students: unpaidRow.students,
        amount_owed: Math.round((unpaidRow.days || 0) * dailyRate),
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
  ipcMain.handle('canteen:class-roster-for-date', (_e, { classId, date }) => {
    const students = db.prepare(`
      SELECT s.id, s.index_number, s.surname, s.first_name, s.photo_path
      FROM students s
      WHERE s.current_class_id = ? AND s.status = 'Active'
      ORDER BY s.surname, s.first_name
    `).all(classId);

    if (students.length === 0) return [];

    // Get attendance and canteen status for this date
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
  });

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

      // If transitioning AWAY from 'paid', remove the prior payment link
      if (existing?.payment_id && existing.status === 'paid' && status !== 'paid') {
        // Don't delete the payment (audit trail) — just unlink and reduce its days
        db.prepare(`
          UPDATE canteen_day_status SET status = ?, payment_id = NULL
          WHERE student_id = ? AND date = ?
        `).run(status, studentId, date);
        return { paymentId: null };
      }

      // If transitioning TO 'paid', create a small one-day payment for the cell
      if (status === 'paid' && existing?.status !== 'paid') {
        const payRes = db.prepare(`
          INSERT INTO canteen_payments
            (student_id, payment_date, amount, days_covered, start_date, end_date, received_by, notes)
          VALUES (?, ?, ?, 1, ?, ?, ?, 'Quick-pay cell entry')
        `).run(studentId, today, dailyRate, date, date, receivedBy || null);
        const paymentId = payRes.lastInsertRowid;

        db.prepare(`
          INSERT INTO canteen_day_status (student_id, date, status, payment_id)
          VALUES (?, ?, 'paid', ?)
          ON CONFLICT (student_id, date) DO UPDATE SET status = 'paid', payment_id = excluded.payment_id
        `).run(studentId, date, paymentId);

        // Auto-record income
        try {
          db.prepare(`
            INSERT INTO income_records
              (receipt_number, category, amount, description, payment_method,
               transaction_date, date, source, student_id, linked_canteen_payment_id,
               recorded_by, is_auto)
            VALUES (NULL, 'canteen', ?, ?, ?, ?, ?, 'canteen_quick', ?, ?, ?, 1)
          `).run(dailyRate, `Canteen — ${date}`, paymentMethod || 'Cash',
                 today, today, studentId, paymentId, receivedBy || null);
        } catch (e) {
          try {
            db.prepare(`
              INSERT INTO audit_log (entity_type, entity_id, action, justification, severity)
              VALUES ('canteen_payment', ?, 'auto_record_failed', ?, 'high')
            `).run(studentId, `Canteen income auto-record failed: ${e.message}`);
          } catch (_) {}
        }
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

    const tx = db.transaction(() => {
      // Create payment record
      const payRes = db.prepare(`
        INSERT INTO canteen_payments
          (student_id, payment_date, amount, days_covered, start_date, end_date,
           received_by, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        studentId, today, amount, dates.length,
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

      // Auto-record income
      try {
        const receipt = db.prepare("SELECT value FROM settings WHERE key = 'receipt_counter'").get();
        const n = parseInt(receipt?.value || '1', 10);
        const receiptNo = `CT/${new Date().getFullYear().toString().slice(-2)}/${String(n).padStart(5, '0')}`;
        db.prepare("UPDATE settings SET value = ? WHERE key = 'receipt_counter'").run(String(n + 1));

        db.prepare(`
          INSERT INTO income_records
            (receipt_number, category, amount, description,
             payment_method, transaction_date, date,
             linked_canteen_payment_id, recorded_by, is_auto)
          VALUES (?, 'canteen', ?, ?, ?, ?, ?, ?, ?, 1)
        `).run(
          receiptNo, amount,
          `Canteen payment — ${dates.length} day${dates.length > 1 ? 's' : ''}`,
          paymentMethod || 'Cash', today, today,
          payRes.lastInsertRowid, receivedBy || null
        );
      } catch (e) {
        try {
          db.prepare(`
            INSERT INTO audit_log (entity_type, entity_id, action, justification, severity)
            VALUES ('canteen_payment', ?, 'auto_record_failed', ?, 'high')
          `).run(studentId || null, `Canteen income auto-record failed: ${e.message}`);
        } catch (_) {}
      }

      return payRes.lastInsertRowid;
    });

    const paymentId = tx();
    return { ok: true, payment_id: paymentId, amount, days: dates.length };
  });

  // ── Mark bulk paid for a class on a date (quick daily pay) ──
  ipcMain.handle('canteen:mark-bulk-paid', (_e, { studentIds, date, paymentMethod, receivedBy }) => {
    if (!studentIds || studentIds.length === 0) return { ok: false, error: 'No students selected' };
    const dailyRate = getDailyRate(db);
    const today = new Date().toISOString().slice(0, 10);

    const tx = db.transaction(() => {
      let totalAmount = 0;
      for (const sid of studentIds) {
        // Create individual payment for each student
        const payRes = db.prepare(`
          INSERT INTO canteen_payments
            (student_id, payment_date, amount, days_covered, start_date, end_date,
             received_by, notes)
          VALUES (?, ?, ?, 1, ?, ?, ?, 'Bulk daily collection')
        `).run(sid, today, dailyRate, date, date, receivedBy || null);

        db.prepare(`
          INSERT INTO canteen_day_status (student_id, date, status, payment_id)
          VALUES (?, ?, 'paid', ?)
          ON CONFLICT (student_id, date) DO UPDATE SET
            status = 'paid', payment_id = excluded.payment_id
        `).run(sid, date, payRes.lastInsertRowid);

        totalAmount += dailyRate;
      }
      return totalAmount;
    });

    const total = tx();
    return { ok: true, count: studentIds.length, total };
  });

  // ── Mark exempt (absent or excused) for a student on dates ──
  ipcMain.handle('canteen:mark-exempt', (_e, { studentId, dates, reason }) => {
    if (!dates || dates.length === 0) return { ok: false };
    const stmt = db.prepare(`
      INSERT INTO canteen_day_status (student_id, date, status)
      VALUES (?, ?, 'exempt')
      ON CONFLICT (student_id, date) DO UPDATE SET status = 'exempt'
    `);
    const tx = db.transaction(() => {
      for (const d of dates) stmt.run(studentId, d);
    });
    tx();
    return { ok: true, count: dates.length };
  });

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
