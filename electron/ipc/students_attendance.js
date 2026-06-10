// Nickland Edusoft — Student Attendance & Events IPC
// Copyright © 2026 Nickland Sales. All rights reserved.

module.exports = function registerStudentAttendanceHandlers(ipcMain, db) {

  // ── Attendance: list for a student in a term ──────────
  ipcMain.handle('students:list-attendance', (_e, { studentId, termId }) => {
    const term = termId
      ? db.prepare('SELECT * FROM terms WHERE id = ?').get(termId)
      : db.prepare("SELECT * FROM terms WHERE is_current = 1").get();
    if (!term) return [];

    return db.prepare(`
      SELECT sa.*, u.full_name AS marked_by_name
      FROM student_attendance sa
      LEFT JOIN users u ON u.id = sa.marked_by
      WHERE sa.student_id = ? AND sa.date >= ? AND sa.date <= ?
      ORDER BY sa.date DESC
    `).all(studentId, term.start_date, term.end_date);
  });

  // ── Attendance: list for a class on a date ────────────
  ipcMain.handle('students:list-class-attendance', (_e, { classId, date }) => {
    const students = db.prepare(`
      SELECT s.id, s.index_number, s.surname, s.first_name, s.other_names, s.photo_path
      FROM students s
      WHERE s.current_class_id = ? AND s.status = 'Active'
      ORDER BY s.surname, s.first_name
    `).all(classId);

    const att = db.prepare(`
      SELECT student_id, status, notes
      FROM student_attendance
      WHERE student_id IN (${students.map(() => '?').join(',') || 'NULL'}) AND date = ?
    `).all(...students.map(s => s.id), date);
    const attMap = Object.fromEntries(att.map(a => [a.student_id, a]));

    return students.map(s => ({
      ...s,
      attendance_status: attMap[s.id]?.status || null,
      attendance_notes: attMap[s.id]?.notes || null,
    }));
  });

  // ── Mark single attendance ────────────────────────────
  ipcMain.handle('students:mark-attendance', (_e, { studentId, date, status, markedBy, termId, notes }) => {
    db.prepare(`
      INSERT INTO student_attendance (student_id, date, status, marked_by, term_id, notes)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (student_id, date) DO UPDATE SET
        status = excluded.status,
        marked_by = excluded.marked_by,
        notes = excluded.notes
    `).run(studentId, date, status, markedBy || null, termId || null, notes || null);
    return { ok: true };
  });

  // ── Mark bulk attendance (whole class for a date) ─────
  ipcMain.handle('students:mark-bulk-attendance', (_e, { date, markedBy, termId, entries }) => {
    const tx = db.transaction(() => {
      const stmt = db.prepare(`
        INSERT INTO student_attendance (student_id, date, status, marked_by, term_id, notes)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (student_id, date) DO UPDATE SET
          status = excluded.status,
          marked_by = excluded.marked_by,
          notes = excluded.notes
      `);
      for (const e of (entries || [])) {
        stmt.run(e.student_id, date, e.status, markedBy || null, termId || null, e.notes || null);
      }
    });
    tx();
    return { ok: true, count: (entries || []).length };
  });

  // ── Attendance summary for a student ─────────────────
  ipcMain.handle('students:attendance-summary', (_e, { studentId, termId }) => {
    const term = termId
      ? db.prepare('SELECT * FROM terms WHERE id = ?').get(termId)
      : db.prepare("SELECT * FROM terms WHERE is_current = 1").get();
    if (!term) return { present: 0, absent: 0, late: 0, excused: 0, total: 0 };

    const rows = db.prepare(`
      SELECT status, COUNT(*) AS c
      FROM student_attendance
      WHERE student_id = ? AND date >= ? AND date <= ?
      GROUP BY status
    `).all(studentId, term.start_date, term.end_date);

    const summary = { present: 0, absent: 0, late: 0, excused: 0, total: 0 };
    for (const r of rows) {
      if (r.status in summary) summary[r.status] = r.c;
      summary.total += r.c;
    }
    return summary;
  });

  // ── Student Events (misconduct, achievement, note) ────
  ipcMain.handle('students:list-events', (_e, studentId) => {
    return db.prepare(`
      SELECT se.*, u.full_name AS recorded_by_name
      FROM student_events se
      LEFT JOIN users u ON u.id = se.recorded_by
      WHERE se.student_id = ?
      ORDER BY se.date DESC, se.id DESC
    `).all(studentId);
  });

  ipcMain.handle('students:add-event', (_e, data) => {
    const r = db.prepare(`
      INSERT INTO student_events (student_id, event_type, title, description, date, recorded_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      data.student_id, data.event_type, data.title,
      data.description || null,
      data.date || new Date().toISOString().slice(0, 10),
      data.recorded_by || null
    );
    return { ok: true, id: r.lastInsertRowid };
  });

  ipcMain.handle('students:delete-event', (_e, id) => {
    db.prepare('DELETE FROM student_events WHERE id = ?').run(id);
    return { ok: true };
  });

  // ── Weekly Attendance Register ────────────────────────
  // Returns every active student in a class with their attendance status
  // for each of the given week's dates, plus accumulated absence reasons.
  ipcMain.handle('students:weekly-register', (_e, { classId, dates }) => {
    if (!classId || !dates || dates.length === 0) return [];
    const students = db.prepare(`
      SELECT id, index_number, surname, first_name, other_names
      FROM students
      WHERE current_class_id = ? AND status = 'Active'
      ORDER BY surname, first_name
    `).all(classId);

    const placeholders = dates.map(() => '?').join(',');
    return students.map(s => {
      const records = db.prepare(`
        SELECT date, status, notes FROM student_attendance
        WHERE student_id = ? AND date IN (${placeholders})
      `).all(s.id, ...dates);
      const byDate = {};
      for (const r of records) byDate[r.date] = { status: r.status, notes: r.notes };
      const presentCount = records.filter(r => r.status === 'present').length;
      // Accumulated reasons across the week
      const reasons = records
        .filter(r => r.status === 'absent' && r.notes)
        .map(r => `${r.date}: ${r.notes}`)
        .join('\n');
      return {
        student_id: s.id,
        index_number: s.index_number,
        surname: s.surname,
        first_name: s.first_name,
        other_names: s.other_names,
        attendance: byDate,          // { '2026-04-27': { status, notes }, ... }
        present_count: presentCount,
        absence_reasons: reasons,
      };
    });
  });

  // Mark a single day for a student; appends to existing reason if absent.
  ipcMain.handle('students:register-mark', (_e, { studentId, date, status, reason, markedBy, termId }) => {
    const existing = db.prepare('SELECT notes FROM student_attendance WHERE student_id = ? AND date = ?')
      .get(studentId, date);
    let notes = reason || null;
    db.prepare(`
      INSERT INTO student_attendance (student_id, date, status, marked_by, term_id, notes)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (student_id, date) DO UPDATE SET
        status = excluded.status,
        marked_by = excluded.marked_by,
        notes = CASE WHEN excluded.status = 'absent' THEN excluded.notes ELSE NULL END
    `).run(studentId, date, status, markedBy || null, termId || null, notes);
    return { ok: true };
  });

  // Save just the absence reason for a student on a date
  ipcMain.handle('students:register-save-reason', (_e, { studentId, date, reason, markedBy, termId }) => {
    db.prepare(`
      INSERT INTO student_attendance (student_id, date, status, marked_by, term_id, notes)
      VALUES (?, ?, 'absent', ?, ?, ?)
      ON CONFLICT (student_id, date) DO UPDATE SET notes = excluded.notes, status = 'absent'
    `).run(studentId, date, markedBy || null, termId || null, reason || null);
    return { ok: true };
  });
};
