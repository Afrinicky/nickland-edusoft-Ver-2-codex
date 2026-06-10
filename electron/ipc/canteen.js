// Canteen IPC handlers — academic calendar, per-student canteen profile, payments, debtors.
const { getSetting } = require('../utils/idgen');

function registerCanteenHandlers(ipcMain, db) {
  // ===== Calendar =====
  ipcMain.handle('canteen:list-calendar', (_e, termId) => {
    if (termId) {
      return db.prepare('SELECT * FROM school_calendar WHERE term_id = ? ORDER BY date').all(termId);
    }
    return db.prepare('SELECT * FROM school_calendar ORDER BY date').all();
  });

  ipcMain.handle('canteen:save-calendar-day', (_e, data) => {
    const existing = db.prepare('SELECT id FROM school_calendar WHERE date = ?').get(data.date);
    if (existing) {
      db.prepare(
        'UPDATE school_calendar SET day_type = ?, label = ?, term_id = ? WHERE date = ?'
      ).run(data.day_type, data.label || '', data.term_id || null, data.date);
    } else {
      db.prepare(
        'INSERT INTO school_calendar (date, day_type, label, term_id) VALUES (?, ?, ?, ?)'
      ).run(data.date, data.day_type, data.label || '', data.term_id || null);
    }
    return { ok: true };
  });

  ipcMain.handle('canteen:setup-term-calendar', (_e, { termId, startDate, endDate, excludeWeekends = true, holidays = [] }) => {
    // Auto-generate calendar for term, marking weekdays as school days, weekends/holidays accordingly
    const tx = db.transaction(() => {
      const ins = db.prepare(`
        INSERT OR REPLACE INTO school_calendar (date, day_type, label, term_id)
        VALUES (?, ?, ?, ?)
      `);
      const start = new Date(startDate);
      const end = new Date(endDate);
      const holidaySet = new Set(holidays.map(h => h.date));
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const iso = d.toISOString().slice(0, 10);
        const dow = d.getDay();
        let dayType = 'school_day';
        let label = '';
        if (excludeWeekends && (dow === 0 || dow === 6)) {
          dayType = 'holiday';
          label = dow === 0 ? 'Sunday' : 'Saturday';
        }
        if (holidaySet.has(iso)) {
          const h = holidays.find(x => x.date === iso);
          dayType = 'holiday';
          label = h.label || 'Holiday';
        }
        ins.run(iso, dayType, label, termId);
      }
    });
    tx();
    return { ok: true };
  });

  // ===== Per-student profile =====
  ipcMain.handle('canteen:student-profile', (_e, { studentId, termId }) => {
    const student = db.prepare(`
      SELECT s.id, s.index_number, s.surname, s.first_name, c.name AS class_name
      FROM students s LEFT JOIN class_groups c ON c.id = s.current_class_id
      WHERE s.id = ?
    `).get(studentId);
    if (!student) return null;

    const dailyRate = parseFloat(getSetting(db, 'canteen_daily_rate', '5'));

    // Pull calendar
    const calendar = db.prepare(
      'SELECT * FROM school_calendar WHERE term_id = ? ORDER BY date'
    ).all(termId);
    // Pull this student's day statuses
    const dayStatuses = db.prepare(`
      SELECT * FROM canteen_day_status
      WHERE student_id = ? AND date IN (
        SELECT date FROM school_calendar WHERE term_id = ?
      )
    `).all(studentId, termId);
    const dayMap = Object.fromEntries(dayStatuses.map(d => [d.date, d]));

    // Payment history
    const payments = db.prepare(`
      SELECT * FROM canteen_payments WHERE student_id = ? AND term_id = ?
      ORDER BY payment_date DESC
    `).all(studentId, termId);

    // Build per-day view
    const days = calendar.map(c => ({
      date: c.date,
      day_type: c.day_type,
      label: c.label,
      status: dayMap[c.date] ? dayMap[c.date].status :
              (c.day_type === 'school_day' ? 'unpaid' : 'na'),
    }));

    const totalSchoolDays = days.filter(d => d.day_type === 'school_day').length;
    const paidDays = days.filter(d => d.status === 'paid').length;
    const unpaidDays = days.filter(d => d.status === 'unpaid').length;
    const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const expectedTotal = totalSchoolDays * dailyRate;
    const balance = expectedTotal - totalPaid;

    return {
      student, daily_rate: dailyRate, calendar: days, payments,
      summary: {
        total_school_days: totalSchoolDays,
        paid_days: paidDays,
        unpaid_days: unpaidDays,
        total_paid: totalPaid,
        expected_total: expectedTotal,
        balance,
      },
    };
  });

  ipcMain.handle('canteen:record-payment', (_e, data) => {
    const dailyRate = parseFloat(data.daily_rate ||
      getSetting(db, 'canteen_daily_rate', '5'));
    const amount = parseFloat(data.amount);
    const days = Math.floor(amount / dailyRate);

    // Find next unpaid school day from payment_date forward
    const startFrom = data.payment_date;
    const unpaidDays = db.prepare(`
      SELECT sc.date FROM school_calendar sc
      LEFT JOIN canteen_day_status cds ON cds.date = sc.date AND cds.student_id = ?
      WHERE sc.date >= ? AND sc.day_type = 'school_day'
        AND (cds.status IS NULL OR cds.status = 'unpaid')
      ORDER BY sc.date
      LIMIT ?
    `).all(data.student_id, startFrom, days);

    const tx = db.transaction(() => {
      const startDate = unpaidDays.length > 0 ? unpaidDays[0].date : startFrom;
      const endDate = unpaidDays.length > 0 ? unpaidDays[unpaidDays.length - 1].date : startFrom;
      const paymentResult = db.prepare(`
        INSERT INTO canteen_payments (student_id, term_id, payment_date, amount,
          daily_rate, days_covered, start_date, end_date, received_by, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.student_id, data.term_id, data.payment_date, amount,
        dailyRate, days, startDate, endDate,
        data.received_by || '', data.notes || ''
      );
      const paymentId = paymentResult.lastInsertRowid;
      const insStatus = db.prepare(`
        INSERT OR REPLACE INTO canteen_day_status (student_id, date, status, payment_id)
        VALUES (?, ?, 'paid', ?)
      `);
      for (const d of unpaidDays) insStatus.run(data.student_id, d.date, paymentId);
      // Add to income ledger
      db.prepare(`
        INSERT INTO income_records (date, category, description, amount, source, linked_canteen_payment_id)
        VALUES (?, 'canteen', ?, ?, 'canteen_payment', ?)
      `).run(
        data.payment_date,
        `Canteen payment - ${days} days @ GHS ${dailyRate.toFixed(2)}`,
        amount, paymentId
      );
      return paymentId;
    });
    const id = tx();
    return { ok: true, id, days_covered: days };
  });

  ipcMain.handle('canteen:debtors-report', (_e, termId) => {
    const dailyRate = parseFloat(getSetting(db, 'canteen_daily_rate', '5'));
    // For each active student, count unpaid school days
    return db.prepare(`
      SELECT s.id, s.index_number, s.surname, s.first_name, c.name AS class_name,
             s.father_contact, s.mother_contact, s.guardian_contact,
             (
               SELECT COUNT(*) FROM school_calendar sc
               LEFT JOIN canteen_day_status cds ON cds.date = sc.date AND cds.student_id = s.id
               WHERE sc.term_id = ? AND sc.day_type = 'school_day'
                 AND (cds.status IS NULL OR cds.status = 'unpaid')
             ) AS unpaid_days
      FROM students s
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      WHERE s.status = 'Active'
      ORDER BY unpaid_days DESC, s.surname
    `).all(termId).map(r => ({
      ...r,
      amount_owed: (r.unpaid_days || 0) * dailyRate,
    })).filter(r => r.unpaid_days > 0);
  });
}

module.exports = registerCanteenHandlers;
