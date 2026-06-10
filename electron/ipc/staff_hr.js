// Nickland Edusoft — Staff HR IPC (documents, medical, training, performance,
// attendance/clock-in, leave management, HR dashboard)
// Copyright © 2026 Nickland Sales. All rights reserved.

const fs = require('fs');
const path = require('path');

function isClockInEnabled(db) {
  const r = db.prepare("SELECT value FROM settings WHERE key = 'staff_clockin_enabled'").get();
  return r ? r.value === 'true' : false;
}

module.exports = function registerStaffHrHandlers(ipcMain, db, userDataPath) {

  // ═════════════════════════════════════════════════════
  // DOCUMENTS (national ID, certificates, contracts, etc.)
  // ═════════════════════════════════════════════════════
  ipcMain.handle('staff:list-documents', (_e, staffId) => {
    return db.prepare(`
      SELECT * FROM staff_documents
      WHERE staff_id = ?
      ORDER BY doc_type, uploaded_at DESC
    `).all(staffId);
  });

  ipcMain.handle('staff:upload-document', (_e, data) => {
    // data: { staff_id, doc_type, title, sourcePath, issue_date, expiry_date, notes }
    let storedPath = null;
    if (data.sourcePath && fs.existsSync(data.sourcePath)) {
      const docsDir = path.join(userDataPath, 'uploads', 'staff_docs', String(data.staff_id));
      if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
      const ext = path.extname(data.sourcePath);
      const filename = `${data.doc_type}_${Date.now()}${ext}`;
      storedPath = path.join(docsDir, filename);
      fs.copyFileSync(data.sourcePath, storedPath);
    }
    const r = db.prepare(`
      INSERT INTO staff_documents
        (staff_id, doc_type, title, file_path, issue_date, expiry_date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.staff_id, data.doc_type, data.title,
      storedPath, data.issue_date || null, data.expiry_date || null, data.notes || null
    );
    return { ok: true, id: r.lastInsertRowid, path: storedPath };
  });

  ipcMain.handle('staff:delete-document', (_e, id) => {
    const doc = db.prepare('SELECT file_path FROM staff_documents WHERE id = ?').get(id);
    if (doc?.file_path && fs.existsSync(doc.file_path)) {
      try { fs.unlinkSync(doc.file_path); } catch (e) {}
    }
    db.prepare('DELETE FROM staff_documents WHERE id = ?').run(id);
    return { ok: true };
  });

  // ═════════════════════════════════════════════════════
  // MEDICAL RECORDS
  // ═════════════════════════════════════════════════════
  ipcMain.handle('staff:get-medical', (_e, staffId) => {
    return db.prepare('SELECT * FROM staff_medical WHERE staff_id = ?').get(staffId);
  });

  ipcMain.handle('staff:save-medical', (_e, data) => {
    const existing = db.prepare('SELECT id FROM staff_medical WHERE staff_id = ?').get(data.staff_id);
    if (existing) {
      db.prepare(`
        UPDATE staff_medical SET
          blood_group = ?, known_conditions = ?, allergies = ?,
          emergency_contact_name = ?, emergency_contact_phone = ?, emergency_contact_relation = ?,
          nhis_number = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE staff_id = ?
      `).run(
        data.blood_group || null, data.known_conditions || null, data.allergies || null,
        data.emergency_contact_name || null, data.emergency_contact_phone || null,
        data.emergency_contact_relation || null,
        data.nhis_number || null, data.notes || null,
        data.staff_id
      );
      return { ok: true, id: existing.id };
    } else {
      const r = db.prepare(`
        INSERT INTO staff_medical
          (staff_id, blood_group, known_conditions, allergies,
           emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
           nhis_number, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.staff_id, data.blood_group || null, data.known_conditions || null,
        data.allergies || null, data.emergency_contact_name || null,
        data.emergency_contact_phone || null, data.emergency_contact_relation || null,
        data.nhis_number || null, data.notes || null
      );
      return { ok: true, id: r.lastInsertRowid };
    }
  });

  // ═════════════════════════════════════════════════════
  // TRAINING / CPD RECORDS
  // ═════════════════════════════════════════════════════
  ipcMain.handle('staff:list-training', (_e, staffId) => {
    return db.prepare(`
      SELECT * FROM staff_training
      WHERE staff_id = ?
      ORDER BY start_date DESC, id DESC
    `).all(staffId);
  });

  ipcMain.handle('staff:save-training', (_e, data) => {
    if (data.id) {
      db.prepare(`
        UPDATE staff_training SET
          title = ?, provider = ?, start_date = ?, end_date = ?,
          certificate_path = ?, notes = ?
        WHERE id = ?
      `).run(
        data.title, data.provider || null,
        data.start_date || null, data.end_date || null,
        data.certificate_path || null, data.notes || null,
        data.id
      );
      return { ok: true, id: data.id };
    } else {
      const r = db.prepare(`
        INSERT INTO staff_training
          (staff_id, title, provider, start_date, end_date, certificate_path, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.staff_id, data.title, data.provider || null,
        data.start_date || null, data.end_date || null,
        data.certificate_path || null, data.notes || null
      );
      return { ok: true, id: r.lastInsertRowid };
    }
  });

  ipcMain.handle('staff:delete-training', (_e, id) => {
    db.prepare('DELETE FROM staff_training WHERE id = ?').run(id);
    return { ok: true };
  });

  // ═════════════════════════════════════════════════════
  // PERFORMANCE REVIEWS
  // ═════════════════════════════════════════════════════
  ipcMain.handle('staff:list-performance', (_e, staffId) => {
    return db.prepare(`
      SELECT sp.*, u.full_name AS reviewer_name
      FROM staff_performance sp
      LEFT JOIN users u ON u.id = sp.reviewer_id
      WHERE sp.staff_id = ?
      ORDER BY sp.reviewed_at DESC
    `).all(staffId);
  });

  ipcMain.handle('staff:save-performance', (_e, data) => {
    if (data.id) {
      db.prepare(`
        UPDATE staff_performance SET
          review_period = ?, reviewer_id = ?,
          overall_rating = ?, teaching_quality = ?, punctuality = ?, professionalism = ?,
          comments = ?
        WHERE id = ?
      `).run(
        data.review_period, data.reviewer_id || null,
        data.overall_rating || null, data.teaching_quality || null,
        data.punctuality || null, data.professionalism || null,
        data.comments || null, data.id
      );
      return { ok: true, id: data.id };
    } else {
      const r = db.prepare(`
        INSERT INTO staff_performance
          (staff_id, review_period, reviewer_id,
           overall_rating, teaching_quality, punctuality, professionalism, comments)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.staff_id, data.review_period, data.reviewer_id || null,
        data.overall_rating || null, data.teaching_quality || null,
        data.punctuality || null, data.professionalism || null,
        data.comments || null
      );
      return { ok: true, id: r.lastInsertRowid };
    }
  });

  // ═════════════════════════════════════════════════════
  // ATTENDANCE / CLOCK-IN
  // ═════════════════════════════════════════════════════
  ipcMain.handle('staff:clockin-status', () => {
    return { enabled: isClockInEnabled(db) };
  });

  ipcMain.handle('staff:clock-in', (_e, staffId) => {
    if (!isClockInEnabled(db)) return { ok: false, error: 'Clock-in is disabled in Settings' };
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toTimeString().slice(0, 5);

    const existing = db.prepare(
      'SELECT id, clock_in FROM staff_attendance WHERE staff_id = ? AND date = ?'
    ).get(staffId, today);

    if (existing && existing.clock_in) {
      return { ok: false, error: `Already clocked in at ${existing.clock_in}` };
    }

    if (existing) {
      db.prepare('UPDATE staff_attendance SET clock_in = ?, status = ? WHERE id = ?')
        .run(now, 'present', existing.id);
    } else {
      db.prepare(`
        INSERT INTO staff_attendance (staff_id, date, clock_in, status)
        VALUES (?, ?, ?, 'present')
      `).run(staffId, today, now);
    }
    return { ok: true, time: now };
  });

  ipcMain.handle('staff:clock-out', (_e, staffId) => {
    if (!isClockInEnabled(db)) return { ok: false, error: 'Clock-in is disabled in Settings' };
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toTimeString().slice(0, 5);

    const existing = db.prepare(
      'SELECT id, clock_in, clock_out FROM staff_attendance WHERE staff_id = ? AND date = ?'
    ).get(staffId, today);

    if (!existing || !existing.clock_in) {
      return { ok: false, error: 'No clock-in recorded for today' };
    }
    if (existing.clock_out) {
      return { ok: false, error: `Already clocked out at ${existing.clock_out}` };
    }
    db.prepare('UPDATE staff_attendance SET clock_out = ? WHERE id = ?').run(now, existing.id);
    return { ok: true, time: now };
  });

  ipcMain.handle('staff:list-attendance', (_e, { staffId, month, year }) => {
    let sql = `
      SELECT sa.* FROM staff_attendance sa
      WHERE sa.staff_id = ?
    `;
    const params = [staffId];
    if (month && year) {
      const monthStr = String(month).padStart(2, '0');
      sql += ' AND sa.date LIKE ?';
      params.push(`${year}-${monthStr}-%`);
    } else if (year) {
      sql += ' AND sa.date LIKE ?';
      params.push(`${year}-%`);
    }
    sql += ' ORDER BY sa.date DESC';
    return db.prepare(sql).all(...params);
  });

  // Get today's attendance row for a staff (used by clock-in widget)
  ipcMain.handle('staff:today-attendance', (_e, staffId) => {
    const today = new Date().toISOString().slice(0, 10);
    return db.prepare(
      'SELECT * FROM staff_attendance WHERE staff_id = ? AND date = ?'
    ).get(staffId, today);
  });

  // Manual attendance entry (admin override)
  ipcMain.handle('staff:mark-attendance', (_e, data) => {
    db.prepare(`
      INSERT INTO staff_attendance (staff_id, date, clock_in, clock_out, status, notes)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (staff_id, date) DO UPDATE SET
        clock_in = excluded.clock_in,
        clock_out = excluded.clock_out,
        status = excluded.status,
        notes = excluded.notes
    `).run(
      data.staff_id, data.date,
      data.clock_in || null, data.clock_out || null,
      data.status || 'present', data.notes || null
    );
    return { ok: true };
  });

  // ═════════════════════════════════════════════════════
  // LEAVE MANAGEMENT (request-based only, mandatory justification)
  // ═════════════════════════════════════════════════════
  ipcMain.handle('staff:list-leave', (_e, filters = {}) => {
    let sql = `
      SELECT lr.*,
             s.surname, s.first_name, s.role, s.staff_number,
             u.full_name AS reviewer_name
      FROM leave_requests lr
      JOIN staff s ON s.id = lr.staff_id
      LEFT JOIN users u ON u.id = lr.reviewed_by
      WHERE 1=1
    `;
    const params = [];
    if (filters.staffId) { sql += ' AND lr.staff_id = ?'; params.push(filters.staffId); }
    if (filters.status)  { sql += ' AND lr.status = ?';   params.push(filters.status);  }
    sql += ' ORDER BY lr.created_at DESC';
    return db.prepare(sql).all(...params);
  });

  ipcMain.handle('staff:submit-leave', (_e, data) => {
    // Mandatory justification — enforced here, not just in the UI
    if (!data.justification || !data.justification.trim()) {
      return { ok: false, error: 'A written justification is required for every leave request.' };
    }
    if (!data.start_date || !data.end_date) {
      return { ok: false, error: 'Start and end dates are required.' };
    }
    if (data.end_date < data.start_date) {
      return { ok: false, error: 'End date cannot be before start date.' };
    }
    // Compute days requested
    const startMs = new Date(data.start_date).getTime();
    const endMs = new Date(data.end_date).getTime();
    const days = Math.round((endMs - startMs) / (86400 * 1000)) + 1;

    const r = db.prepare(`
      INSERT INTO leave_requests
        (staff_id, leave_type, start_date, end_date, days_requested, justification, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      data.staff_id, data.leave_type || 'personal',
      data.start_date, data.end_date, days, data.justification.trim()
    );
    return { ok: true, id: r.lastInsertRowid, days_requested: days };
  });

  ipcMain.handle('staff:review-leave', (_e, { id, status, reviewerId, reviewerNotes }) => {
    if (!['approved', 'rejected', 'cancelled'].includes(status)) {
      return { ok: false, error: 'Status must be approved, rejected, or cancelled.' };
    }
    db.prepare(`
      UPDATE leave_requests SET
        status = ?, reviewed_by = ?, reviewer_notes = ?,
        reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, reviewerId || null, reviewerNotes || null, id);
    return { ok: true };
  });

  // ═════════════════════════════════════════════════════
  // HR DASHBOARD — aggregate metrics
  // ═════════════════════════════════════════════════════
  ipcMain.handle('staff:dashboard', () => {
    const totalActive = db.prepare("SELECT COUNT(*) AS c FROM staff WHERE status = 'Active'").get().c;
    const totalInactive = db.prepare("SELECT COUNT(*) AS c FROM staff WHERE status != 'Active'").get().c;
    const totalAll = totalActive + totalInactive;

    // By role
    const byRole = db.prepare(`
      SELECT role, COUNT(*) AS count
      FROM staff WHERE status = 'Active'
      GROUP BY role ORDER BY count DESC
    `).all();

    // By gender
    const byGender = db.prepare(`
      SELECT gender, COUNT(*) AS count
      FROM staff WHERE status = 'Active'
      GROUP BY gender
    `).all();

    // Today's attendance
    const today = new Date().toISOString().slice(0, 10);
    const todayAtt = db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS present,
        SUM(CASE WHEN status = 'absent'  THEN 1 ELSE 0 END) AS absent,
        SUM(CASE WHEN status = 'late'    THEN 1 ELSE 0 END) AS late,
        COUNT(*) AS total
      FROM staff_attendance WHERE date = ?
    `).get(today);

    // Pending leave requests
    const pendingLeave = db.prepare(
      "SELECT COUNT(*) AS c FROM leave_requests WHERE status = 'pending'"
    ).get().c;

    // Currently on approved leave (today within approved range)
    const onLeave = db.prepare(`
      SELECT COUNT(*) AS c FROM leave_requests
      WHERE status = 'approved' AND start_date <= ? AND end_date >= ?
    `).get(today, today).c;

    // Documents expiring soon (within 90 days)
    const ninetyDaysOut = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    const expiringDocs = db.prepare(`
      SELECT
        sd.id, sd.title, sd.doc_type, sd.expiry_date,
        s.surname, s.first_name, s.id AS staff_id
      FROM staff_documents sd
      JOIN staff s ON s.id = sd.staff_id
      WHERE sd.expiry_date IS NOT NULL
        AND sd.expiry_date >= ? AND sd.expiry_date <= ?
        AND s.status = 'Active'
      ORDER BY sd.expiry_date
      LIMIT 10
    `).all(today, ninetyDaysOut);

    // Recent hires (last 6 months)
    const sixMonthsAgo = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
    const recentHires = db.prepare(`
      SELECT s.id, s.surname, s.first_name, s.role, s.hire_date, s.photo_path
      FROM staff s
      WHERE s.hire_date >= ? AND s.status = 'Active'
      ORDER BY s.hire_date DESC
      LIMIT 6
    `).all(sixMonthsAgo);

    return {
      metrics: {
        total_active: totalActive,
        total_inactive: totalInactive,
        total_all: totalAll,
        today_present: todayAtt?.present || 0,
        today_absent: todayAtt?.absent || 0,
        today_late: todayAtt?.late || 0,
        today_total_marked: todayAtt?.total || 0,
        pending_leave: pendingLeave,
        on_leave_today: onLeave,
        clockin_enabled: isClockInEnabled(db),
      },
      by_role: byRole,
      by_gender: byGender,
      expiring_documents: expiringDocs,
      recent_hires: recentHires,
    };
  });
};
