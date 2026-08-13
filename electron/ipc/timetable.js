// Timetable IPC handlers — bell schedule (periods) + per-class weekly grid.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Data model (see migration 22):
//   timetable_periods  — one school-wide bell schedule (label + start/end,
//                        display_order, is_break). Break/lunch rows line up
//                        across every class.
//   timetable_entries  — one row per (class, weekday, period): subject + teacher.
//
// The read helpers here are also used by the mobile API (electron/server/api.js)
// so the desktop, the teacher's phone, and the parent portal all agree on shape.

const DAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
];

// A sensible Ghana pre-tertiary default bell schedule, used to seed an empty
// school so the grid isn't blank on first open.
const DEFAULT_PERIODS = [
  { label: 'Period 1', start_time: '08:00', end_time: '08:40', is_break: 0 },
  { label: 'Period 2', start_time: '08:40', end_time: '09:20', is_break: 0 },
  { label: 'Period 3', start_time: '09:20', end_time: '10:00', is_break: 0 },
  { label: 'Break',    start_time: '10:00', end_time: '10:20', is_break: 1 },
  { label: 'Period 4', start_time: '10:20', end_time: '11:00', is_break: 0 },
  { label: 'Period 5', start_time: '11:00', end_time: '11:40', is_break: 0 },
  { label: 'Lunch',    start_time: '11:40', end_time: '12:20', is_break: 1 },
  { label: 'Period 6', start_time: '12:20', end_time: '13:00', is_break: 0 },
  { label: 'Period 7', start_time: '13:00', end_time: '13:40', is_break: 0 },
];

function listPeriods(db) {
  return db.prepare('SELECT * FROM timetable_periods ORDER BY display_order, start_time, id').all();
}

// Full grid for one class: the shared periods + this class's entries keyed by
// `${day}:${periodId}`, each resolved to subject and teacher names.
function getClassTimetable(db, classId) {
  const periods = listPeriods(db);
  const cls = db.prepare('SELECT id, name, short_code FROM class_groups WHERE id = ?').get(classId) || null;
  const entries = db.prepare(`
    SELECT e.id, e.day_of_week, e.period_id, e.subject_id, e.teacher_id, e.notes,
           sub.name AS subject_name,
           TRIM(COALESCE(st.first_name,'') || ' ' || COALESCE(st.surname,'')) AS teacher_name
    FROM timetable_entries e
    LEFT JOIN subjects sub ON sub.id = e.subject_id
    LEFT JOIN staff st ON st.id = e.teacher_id
    WHERE e.class_group_id = ?
  `).all(classId);
  const byCell = {};
  for (const e of entries) byCell[`${e.day_of_week}:${e.period_id}`] = e;
  return { class: cls, days: DAYS, periods, entries: byCell };
}

// One teacher's week: every entry assigned to them, with class + subject +
// period, grouped by weekday. Used by the mobile "My timetable / Today" view.
function getTeacherTimetable(db, staffId) {
  const rows = db.prepare(`
    SELECT e.day_of_week, e.period_id, e.notes,
           c.name AS class_name, c.short_code AS class_short,
           sub.name AS subject_name,
           p.label AS period_label, p.start_time, p.end_time, p.display_order, p.is_break
    FROM timetable_entries e
    JOIN timetable_periods p ON p.id = e.period_id
    LEFT JOIN class_groups c ON c.id = e.class_group_id
    LEFT JOIN subjects sub ON sub.id = e.subject_id
    WHERE e.teacher_id = ?
    ORDER BY e.day_of_week, p.display_order, p.start_time
  `).all(staffId);
  const byDay = DAYS.map(d => ({ ...d, periods: rows.filter(r => r.day_of_week === d.value) }));
  return { days: byDay };
}

function registerTimetableHandlers(ipcMain, db) {
  ipcMain.handle('timetable:list-periods', () => listPeriods(db));

  ipcMain.handle('timetable:seed-default-periods', () => {
    const existing = db.prepare('SELECT COUNT(*) c FROM timetable_periods').get().c;
    if (existing > 0) return { ok: true, seeded: 0 };
    const ins = db.prepare('INSERT INTO timetable_periods (label, start_time, end_time, display_order, is_break) VALUES (?, ?, ?, ?, ?)');
    const tx = db.transaction(() => DEFAULT_PERIODS.forEach((p, i) => ins.run(p.label, p.start_time, p.end_time, i, p.is_break)));
    tx();
    return { ok: true, seeded: DEFAULT_PERIODS.length };
  });

  ipcMain.handle('timetable:save-period', (_e, data) => {
    if (!data || !data.label || !data.start_time || !data.end_time) {
      return { ok: false, error: 'Label, start and end time are required.' };
    }
    if (data.id) {
      db.prepare(`
        UPDATE timetable_periods SET label = ?, start_time = ?, end_time = ?, display_order = ?, is_break = ?
        WHERE id = ?
      `).run(data.label, data.start_time, data.end_time, data.display_order || 0, data.is_break ? 1 : 0, data.id);
      return { ok: true, id: data.id };
    }
    const r = db.prepare(`
      INSERT INTO timetable_periods (label, start_time, end_time, display_order, is_break)
      VALUES (?, ?, ?, ?, ?)
    `).run(data.label, data.start_time, data.end_time, data.display_order || 0, data.is_break ? 1 : 0);
    return { ok: true, id: r.lastInsertRowid };
  });

  ipcMain.handle('timetable:delete-period', (_e, id) => {
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM timetable_entries WHERE period_id = ?').run(id);
      db.prepare('DELETE FROM timetable_periods WHERE id = ?').run(id);
    });
    tx();
    return { ok: true };
  });

  ipcMain.handle('timetable:get-class', (_e, { classId }) => getClassTimetable(db, classId));

  // Upsert one cell. A cell with neither subject nor teacher is cleared, so the
  // same editor handles "set" and "remove".
  ipcMain.handle('timetable:save-entry', (_e, { classId, dayOfWeek, periodId, subjectId, teacherId, notes }) => {
    if (!classId || !dayOfWeek || !periodId) return { ok: false, error: 'Class, day and period are required.' };
    if (!subjectId && !teacherId && !notes) {
      db.prepare('DELETE FROM timetable_entries WHERE class_group_id = ? AND day_of_week = ? AND period_id = ?')
        .run(classId, dayOfWeek, periodId);
      return { ok: true, cleared: true };
    }
    db.prepare(`
      INSERT INTO timetable_entries (class_group_id, day_of_week, period_id, subject_id, teacher_id, notes)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (class_group_id, day_of_week, period_id) DO UPDATE SET
        subject_id = excluded.subject_id, teacher_id = excluded.teacher_id, notes = excluded.notes
    `).run(classId, dayOfWeek, periodId, subjectId || null, teacherId || null, notes || null);
    return { ok: true };
  });

  ipcMain.handle('timetable:delete-entry', (_e, { classId, dayOfWeek, periodId }) => {
    db.prepare('DELETE FROM timetable_entries WHERE class_group_id = ? AND day_of_week = ? AND period_id = ?')
      .run(classId, dayOfWeek, periodId);
    return { ok: true };
  });

  ipcMain.handle('timetable:get-teacher', (_e, { staffId }) => getTeacherTimetable(db, staffId));
}

module.exports = registerTimetableHandlers;
module.exports.getClassTimetable = getClassTimetable;
module.exports.getTeacherTimetable = getTeacherTimetable;
module.exports.listPeriods = listPeriods;
module.exports.DAYS = DAYS;
