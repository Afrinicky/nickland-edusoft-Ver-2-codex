// Homework / assignments IPC — a teacher sets work for a class + subject with a
// due date; parents see their child's class homework.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Read helpers are exported so the mobile API (electron/server/api.js) and the
// cloud snapshot (electron/server/sync/outbox.js) share one implementation.

function rowShape(db, h) {
  const sub = h.subject_id ? db.prepare('SELECT name FROM subjects WHERE id = ?').get(h.subject_id) : null;
  const st = h.teacher_id ? db.prepare('SELECT surname, first_name FROM staff WHERE id = ?').get(h.teacher_id) : null;
  return {
    id: h.id, class_group_id: h.class_group_id, subject_id: h.subject_id,
    subject_name: sub?.name || null,
    teacher_name: st ? `${st.first_name || ''} ${st.surname || ''}`.trim() : null,
    title: h.title, description: h.description, due_date: h.due_date, created_at: h.created_at,
  };
}

// Homework for a class. By default upcoming + recently-due (last 7 days); pass
// { all: true } for the full history (desktop management view).
function listForClass(db, classId, { all = false } = {}) {
  const rows = all
    ? db.prepare('SELECT * FROM homework WHERE class_group_id = ? ORDER BY COALESCE(due_date, created_at) DESC, id DESC').all(classId)
    : db.prepare(`
        SELECT * FROM homework
        WHERE class_group_id = ? AND (due_date IS NULL OR due_date >= date('now', '-7 days'))
        ORDER BY COALESCE(due_date, date('now')) ASC, id DESC
      `).all(classId);
  return rows.map(h => rowShape(db, h));
}

// A student's class homework (upcoming / recently due) for the portal + parent app.
function listForStudent(db, studentId) {
  const stu = db.prepare('SELECT current_class_id FROM students WHERE id = ?').get(studentId);
  if (!stu || !stu.current_class_id) return [];
  return listForClass(db, stu.current_class_id).slice(0, 20);
}

function saveHomework(db, data) {
  if (!data || !data.classId || !data.title || !String(data.title).trim()) {
    return { ok: false, error: 'Class and title are required.' };
  }
  if (data.id) {
    db.prepare(`UPDATE homework SET subject_id = ?, title = ?, description = ?, due_date = ? WHERE id = ?`)
      .run(data.subjectId || null, String(data.title).trim(), data.description || null, data.dueDate || null, data.id);
    return { ok: true, id: data.id };
  }
  const r = db.prepare(`
    INSERT INTO homework (class_group_id, subject_id, teacher_id, title, description, due_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(data.classId, data.subjectId || null, data.teacherId || null, String(data.title).trim(), data.description || null, data.dueDate || null);
  return { ok: true, id: r.lastInsertRowid };
}

function deleteHomework(db, id) {
  db.prepare('DELETE FROM homework WHERE id = ?').run(id);
  return { ok: true };
}

function registerHomeworkHandlers(ipcMain, db) {
  ipcMain.handle('homework:list-class', (_e, { classId, all }) => listForClass(db, classId, { all: !!all }));
  ipcMain.handle('homework:save', (_e, data) => saveHomework(db, data));
  ipcMain.handle('homework:delete', (_e, id) => deleteHomework(db, id));
}

module.exports = registerHomeworkHandlers;
module.exports.listForClass = listForClass;
module.exports.listForStudent = listForStudent;
module.exports.saveHomework = saveHomework;
