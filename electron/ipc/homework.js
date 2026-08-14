// Homework / assignments IPC.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// A homework is a real assignment record: it belongs to a class, a term and
// (optionally) a subject, carries a due date, and may be GRADED out of
// `max_marks`.
//
// Grading is the important part. A graded homework is backed by an
// `assessment_columns` row, so the marks a teacher records here are the same
// marks the Class Scores sheet works with. Saving marks recomputes the pupil's
// weighted class score, subject total and therefore the end-of-term report —
// homework is continuous assessment, not a separate island.
//
// Read helpers are exported for the mobile API and the cloud snapshot.

const DEFAULT_MAX_MARKS = 10;

function currentTermId(db) {
  return db.prepare('SELECT id FROM terms WHERE is_current = 1').get()?.id || null;
}

function rowShape(db, h) {
  const sub = h.subject_id ? db.prepare('SELECT name FROM subjects WHERE id = ?').get(h.subject_id) : null;
  const st = h.teacher_id ? db.prepare('SELECT surname, first_name FROM staff WHERE id = ?').get(h.teacher_id) : null;
  const stats = db.prepare(`
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE status IN ('submitted','late')) AS submitted,
           COUNT(*) FILTER (WHERE status = 'missing') AS missing,
           COUNT(*) FILTER (WHERE marks IS NOT NULL) AS marked,
           AVG(marks) AS average_mark
    FROM homework_submissions WHERE homework_id = ?
  `).get(h.id) || {};
  return {
    id: h.id,
    class_group_id: h.class_group_id,
    term_id: h.term_id,
    subject_id: h.subject_id,
    subject_name: sub?.name || null,
    teacher_name: st ? `${st.first_name || ''} ${st.surname || ''}`.trim() : null,
    title: h.title,
    description: h.description,
    assigned_date: h.assigned_date,
    due_date: h.due_date,
    max_marks: h.max_marks,
    is_graded: h.max_marks != null,
    status: h.status || 'published',
    created_at: h.created_at,
    submitted_count: stats.submitted || 0,
    missing_count: stats.missing || 0,
    marked_count: stats.marked || 0,
    average_mark: stats.average_mark != null ? Math.round(stats.average_mark * 100) / 100 : null,
  };
}

// Homework for a class. `all` returns the full history; otherwise only work
// that is still upcoming or recently due. `termId` scopes to a term.
function listForClass(db, classId, { all = false, termId = null } = {}) {
  const params = [classId];
  let sql = 'SELECT * FROM homework WHERE class_group_id = ?';
  if (termId) { sql += ' AND term_id = ?'; params.push(termId); }
  if (!all) sql += " AND (due_date IS NULL OR due_date >= date('now', '-7 days'))";
  sql += all
    ? ' ORDER BY COALESCE(due_date, assigned_date, created_at) DESC, id DESC'
    : " ORDER BY COALESCE(due_date, date('now')) ASC, id DESC";
  return db.prepare(sql).all(...params).map(h => rowShape(db, h));
}

// A pupil's class homework, each annotated with that pupil's own submission
// status and mark — this is what parents see.
function listForStudent(db, studentId, { limit = 20 } = {}) {
  const stu = db.prepare('SELECT current_class_id FROM students WHERE id = ?').get(studentId);
  if (!stu || !stu.current_class_id) return [];
  const rows = db.prepare(`
    SELECT h.*, hs.status AS my_status, hs.marks AS my_marks, hs.remarks AS my_remarks
    FROM homework h
    LEFT JOIN homework_submissions hs ON hs.homework_id = h.id AND hs.student_id = ?
    WHERE h.class_group_id = ? AND COALESCE(h.status,'published') = 'published'
      AND (h.due_date IS NULL OR h.due_date >= date('now', '-7 days'))
    ORDER BY COALESCE(h.due_date, date('now')) ASC, h.id DESC
    LIMIT ?
  `).all(studentId, stu.current_class_id, limit);
  return rows.map(h => ({
    ...rowShape(db, h),
    my_status: h.my_status || 'pending',
    my_marks: h.my_marks,
    my_remarks: h.my_remarks,
  }));
}

// The marking sheet: every active pupil in the class with their submission row.
function getSheet(db, homeworkId) {
  const h = db.prepare('SELECT * FROM homework WHERE id = ?').get(homeworkId);
  if (!h) return null;
  const students = db.prepare(`
    SELECT id, index_number, surname, first_name, other_names
    FROM students WHERE current_class_id = ? AND status = 'Active'
    ORDER BY surname, first_name
  `).all(h.class_group_id);
  const subs = Object.fromEntries(
    db.prepare('SELECT student_id, status, marks, remarks FROM homework_submissions WHERE homework_id = ?')
      .all(homeworkId).map(s => [s.student_id, s])
  );
  return {
    homework: rowShape(db, h),
    students: students.map(s => ({
      student_id: s.id,
      index_number: s.index_number,
      name: `${s.surname} ${s.first_name} ${s.other_names || ''}`.trim(),
      status: subs[s.id]?.status || 'pending',
      marks: subs[s.id]?.marks ?? null,
      remarks: subs[s.id]?.remarks || '',
    })),
  };
}

// Find or create the assessment column that backs a graded homework, so its
// marks land in the same continuous-assessment pool as the Class Scores sheet.
function ensureAssessmentColumn(db, h) {
  if (h.max_marks == null || !h.subject_id || !h.term_id) return null;
  if (h.assessment_column_id) {
    const existing = db.prepare('SELECT id FROM assessment_columns WHERE id = ?').get(h.assessment_column_id);
    if (existing) {
      db.prepare('UPDATE assessment_columns SET assessment_type = ?, max_marks = ? WHERE id = ?')
        .run(`Homework: ${h.title}`.slice(0, 80), h.max_marks, h.assessment_column_id);
      return h.assessment_column_id;
    }
  }
  const order = db.prepare(`
    SELECT COALESCE(MAX(display_order), 0) + 1 AS n FROM assessment_columns
    WHERE class_group_id = ? AND subject_id = ? AND term_id = ?
  `).get(h.class_group_id, h.subject_id, h.term_id).n;
  const r = db.prepare(`
    INSERT INTO assessment_columns (class_group_id, subject_id, term_id, assessment_type, max_marks, display_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(h.class_group_id, h.subject_id, h.term_id, `Homework: ${h.title}`.slice(0, 80), h.max_marks, order);
  db.prepare('UPDATE homework SET assessment_column_id = ? WHERE id = ?').run(r.lastInsertRowid, h.id);
  return r.lastInsertRowid;
}

function saveHomework(db, data) {
  if (!data || !data.classId || !data.title || !String(data.title).trim()) {
    return { ok: false, error: 'Class and title are required.' };
  }
  const maxMarks = data.maxMarks === '' || data.maxMarks == null ? null : Number(data.maxMarks);
  if (maxMarks != null && (!Number.isFinite(maxMarks) || maxMarks <= 0)) {
    return { ok: false, error: 'Total marks must be a positive number.' };
  }
  if (maxMarks != null && !data.subjectId) {
    return { ok: false, error: 'Graded homework needs a subject so the marks can count towards the class score.' };
  }
  const termId = data.termId || currentTermId(db);
  const title = String(data.title).trim();
  const status = data.status === 'draft' ? 'draft' : 'published';

  if (data.id) {
    db.prepare(`
      UPDATE homework
         SET subject_id = ?, title = ?, description = ?, due_date = ?,
             assigned_date = ?, max_marks = ?, status = ?, term_id = ?
       WHERE id = ?
    `).run(
      data.subjectId || null, title, data.description || null, data.dueDate || null,
      data.assignedDate || null, maxMarks, status, termId, data.id
    );
    const h = db.prepare('SELECT * FROM homework WHERE id = ?').get(data.id);
    if (maxMarks != null) ensureAssessmentColumn(db, h);
    return { ok: true, id: data.id };
  }

  const r = db.prepare(`
    INSERT INTO homework (class_group_id, term_id, subject_id, teacher_id, title, description,
                          assigned_date, due_date, max_marks, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.classId, termId, data.subjectId || null, data.teacherId || null, title,
    data.description || null, data.assignedDate || new Date().toISOString().slice(0, 10),
    data.dueDate || null, maxMarks, status
  );
  const h = db.prepare('SELECT * FROM homework WHERE id = ?').get(r.lastInsertRowid);
  if (maxMarks != null) ensureAssessmentColumn(db, h);
  return { ok: true, id: r.lastInsertRowid };
}

// Save submission statuses and marks, then push the marks into the assessment
// pipeline so the class score, subject total and report card all update.
function saveMarks(db, { homeworkId, entries }) {
  const h = db.prepare('SELECT * FROM homework WHERE id = ?').get(homeworkId);
  if (!h) return { ok: false, error: 'Homework not found.' };
  if (!Array.isArray(entries)) return { ok: false, error: 'entries[] is required.' };

  const graded = h.max_marks != null;
  for (const e of entries) {
    if (e.marks === '' || e.marks == null) continue;
    const v = Number(e.marks);
    if (!Number.isFinite(v) || v < 0) return { ok: false, error: 'Marks must be zero or more.' };
    if (graded && v > h.max_marks) return { ok: false, error: `Marks cannot exceed the total of ${h.max_marks}.` };
  }

  const columnId = graded ? ensureAssessmentColumn(db, h) : null;
  const upSub = db.prepare(`
    INSERT INTO homework_submissions (homework_id, student_id, status, marks, remarks, submitted_at, marked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (homework_id, student_id) DO UPDATE SET
      status = excluded.status, marks = excluded.marks, remarks = excluded.remarks,
      submitted_at = COALESCE(homework_submissions.submitted_at, excluded.submitted_at),
      marked_at = excluded.marked_at
  `);
  const upScore = db.prepare(`
    INSERT INTO assessment_scores (assessment_column_id, student_id, marks)
    VALUES (?, ?, ?)
    ON CONFLICT (assessment_column_id, student_id) DO UPDATE SET marks = excluded.marks
  `);

  let saved = 0;
  const touched = [];
  const tx = db.transaction(() => {
    for (const e of entries) {
      const marks = (e.marks === '' || e.marks == null) ? null : Number(e.marks);
      const status = e.status || (marks != null ? 'submitted' : 'pending');
      const now = new Date().toISOString();
      upSub.run(
        homeworkId, e.student_id, status, marks, e.remarks || null,
        (status === 'submitted' || status === 'late') ? now : null,
        marks != null ? now : null
      );
      if (columnId) {
        // A pupil who did not turn the work in scores zero for this assessment,
        // which is what makes the continuous-assessment total honest.
        const contributes = marks != null ? marks : (status === 'missing' ? 0 : null);
        if (contributes != null) { upScore.run(columnId, e.student_id, contributes); touched.push(e.student_id); }
      }
      saved++;
    }
  });
  tx();

  // Recompute each affected pupil's class score → subject total → report card.
  if (columnId && touched.length) {
    try {
      const { recomputeClassScore, readWeights } = require('./scores');
      const weights = readWeights(db);
      for (const sid of [...new Set(touched)]) {
        recomputeClassScore(db, h.class_group_id, h.subject_id, h.term_id, sid, weights);
      }
    } catch (_) { /* scoring is best-effort; submissions are already saved */ }
    try {
      const { enqueueStudentSnapshot } = require('../server/sync/outbox');
      for (const sid of [...new Set(touched)]) enqueueStudentSnapshot(db, sid);
    } catch (_) {}
  }
  return { ok: true, saved, linked_to_assessment: !!columnId };
}

function deleteHomework(db, id) {
  const h = db.prepare('SELECT assessment_column_id FROM homework WHERE id = ?').get(id);
  const tx = db.transaction(() => {
    // Removing the homework removes its contribution to the class score too,
    // otherwise pupils keep marks for work that no longer exists.
    if (h?.assessment_column_id) {
      db.prepare('DELETE FROM assessment_scores WHERE assessment_column_id = ?').run(h.assessment_column_id);
      db.prepare('DELETE FROM assessment_columns WHERE id = ?').run(h.assessment_column_id);
    }
    db.prepare('DELETE FROM homework_submissions WHERE homework_id = ?').run(id);
    db.prepare('DELETE FROM homework WHERE id = ?').run(id);
  });
  tx();
  return { ok: true };
}

// Per-pupil homework record for the Student Academic Profile.
function studentReport(db, studentId, termId) {
  const rows = db.prepare(`
    SELECT h.id, h.title, h.due_date, h.max_marks, sub.name AS subject_name,
           hs.status, hs.marks, hs.remarks
    FROM homework h
    LEFT JOIN subjects sub ON sub.id = h.subject_id
    LEFT JOIN homework_submissions hs ON hs.homework_id = h.id AND hs.student_id = ?
    WHERE h.class_group_id = (SELECT current_class_id FROM students WHERE id = ?)
      AND (? IS NULL OR h.term_id = ?)
      AND COALESCE(h.status,'published') = 'published'
    ORDER BY COALESCE(h.due_date, h.created_at) DESC
  `).all(studentId, studentId, termId || null, termId || null);
  const graded = rows.filter(r => r.max_marks != null && r.marks != null);
  const totalMarks = graded.reduce((s, r) => s + r.marks, 0);
  const totalMax = graded.reduce((s, r) => s + r.max_marks, 0);
  return {
    items: rows,
    summary: {
      assigned: rows.length,
      submitted: rows.filter(r => r.status === 'submitted' || r.status === 'late').length,
      missing: rows.filter(r => r.status === 'missing').length,
      graded: graded.length,
      total_marks: Math.round(totalMarks * 100) / 100,
      total_max: Math.round(totalMax * 100) / 100,
      percentage: totalMax > 0 ? Math.round((totalMarks / totalMax) * 10000) / 100 : null,
    },
  };
}

function registerHomeworkHandlers(ipcMain, db) {
  ipcMain.handle('homework:list-class', (_e, { classId, all, termId }) => listForClass(db, classId, { all: !!all, termId }));
  ipcMain.handle('homework:save', (_e, data) => saveHomework(db, data));
  ipcMain.handle('homework:delete', (_e, id) => deleteHomework(db, id));
  ipcMain.handle('homework:sheet', (_e, homeworkId) => getSheet(db, homeworkId));
  ipcMain.handle('homework:save-marks', (_e, data) => saveMarks(db, data));
  ipcMain.handle('homework:student-report', (_e, { studentId, termId }) => studentReport(db, studentId, termId));
}

module.exports = registerHomeworkHandlers;
module.exports.listForClass = listForClass;
module.exports.listForStudent = listForStudent;
module.exports.saveHomework = saveHomework;
module.exports.saveMarks = saveMarks;
module.exports.getSheet = getSheet;
module.exports.studentReport = studentReport;
module.exports.deleteHomework = deleteHomework;
