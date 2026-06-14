// Scores IPC handlers — score entry, ranking, term summary.
function registerScoresHandlers(ipcMain, db) {
  ipcMain.handle('scores:list-subjects', () => {
    return db.prepare('SELECT * FROM subjects WHERE is_active = 1 ORDER BY name').all();
  });

  ipcMain.handle('scores:list-for-class', (_e, { classId, termId }) => {
    const students = db.prepare(`
      SELECT id, index_number, surname, first_name, other_names
      FROM students WHERE current_class_id = ? AND status = 'Active'
      ORDER BY surname, first_name
    `).all(classId);
    const subjects = db.prepare(`
      SELECT s.* FROM subjects s
      JOIN class_subjects cs ON cs.subject_id = s.id
      WHERE cs.class_group_id = ? AND s.is_active = 1
      ORDER BY s.name
    `).all(classId);
    const scores = db.prepare(`
      SELECT * FROM scores WHERE term_id = ? AND student_id IN (
        SELECT id FROM students WHERE current_class_id = ?
      )
    `).all(termId, classId);
    const summaries = db.prepare(`
      SELECT * FROM student_term_summary WHERE term_id = ? AND class_group_id = ?
    `).all(termId, classId);
    return { students, subjects, scores, summaries };
  });

  ipcMain.handle('scores:save-bulk', (_e, { entries, summaries }) => {
    const tx = db.transaction(() => {
      const ins = db.prepare(`
        INSERT INTO scores (student_id, term_id, subject_id, class_score, exam_score, total_score, grade_remark)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(student_id, term_id, subject_id) DO UPDATE SET
          class_score = excluded.class_score,
          exam_score = excluded.exam_score,
          total_score = excluded.total_score,
          grade_remark = excluded.grade_remark
      `);
      const bands = db.prepare('SELECT * FROM grading_bands ORDER BY min_score DESC').all();
      function remark(score) {
        for (const b of bands) {
          if (score >= b.min_score && score <= b.max_score) return b.remark;
        }
        return '';
      }
      for (const e of (entries || [])) {
        const cls = parseFloat(e.class_score) || 0;
        const exm = parseFloat(e.exam_score) || 0;
        const total = cls + exm;
        ins.run(e.student_id, e.term_id, e.subject_id, cls, exm, total, remark(total));
      }
      const insSum = db.prepare(`
        INSERT INTO student_term_summary (
          student_id, term_id, class_group_id, total_score_all, average_score,
          class_rank, number_on_roll, conduct_traits, learner_interests,
          learner_talents, teacher_remarks, days_present, total_days
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(student_id, term_id) DO UPDATE SET
          class_group_id = excluded.class_group_id,
          total_score_all = excluded.total_score_all,
          average_score = excluded.average_score,
          class_rank = excluded.class_rank,
          number_on_roll = excluded.number_on_roll,
          conduct_traits = excluded.conduct_traits,
          learner_interests = excluded.learner_interests,
          learner_talents = excluded.learner_talents,
          teacher_remarks = excluded.teacher_remarks,
          days_present = excluded.days_present,
          total_days = excluded.total_days
      `);
      for (const s of (summaries || [])) {
        insSum.run(
          s.student_id, s.term_id, s.class_group_id,
          s.total_score_all || 0, s.average_score || 0,
          s.class_rank || null, s.number_on_roll || null,
          s.conduct_traits || '', s.learner_interests || '',
          s.learner_talents || '', s.teacher_remarks || '',
          s.days_present || null, s.total_days || null
        );
      }
    });
    tx();
    return { ok: true };
  });

  ipcMain.handle('scores:student-report', (_e, { studentId, termId }) => {
    const student = db.prepare(`
      SELECT s.*, c.name AS class_name, c.short_code AS class_short
      FROM students s
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      WHERE s.id = ?
    `).get(studentId);
    const term = db.prepare('SELECT t.*, ay.label AS year_label FROM terms t JOIN academic_years ay ON ay.id = t.academic_year_id WHERE t.id = ?').get(termId);
    const scores = db.prepare(`
      SELECT sc.*, sub.name AS subject_name, sub.class_weight_pct, sub.exam_weight_pct
      FROM scores sc
      JOIN subjects sub ON sub.id = sc.subject_id
      WHERE sc.student_id = ? AND sc.term_id = ?
      ORDER BY sub.name
    `).all(studentId, termId);
    const summary = db.prepare(`
      SELECT * FROM student_term_summary WHERE student_id = ? AND term_id = ?
    `).get(studentId, termId);
    return { student, term, scores, summary };
  });

  ipcMain.handle('scores:rank-class', (_e, { classId, termId }) => {
    // Recompute totals & ranking for all students in this class for this term
    const students = db.prepare(`
      SELECT id FROM students WHERE current_class_id = ? AND status = 'Active'
    `).all(classId);
    const rows = students.map(s => {
      const totals = db.prepare(`
        SELECT SUM(total_score) AS total, AVG(total_score) AS avg, COUNT(*) AS n
        FROM scores WHERE student_id = ? AND term_id = ?
      `).get(s.id, termId);
      return {
        student_id: s.id,
        total: totals.total || 0,
        avg: totals.avg || 0,
        n: totals.n || 0,
      };
    });
    rows.sort((a, b) => b.avg - a.avg);
    const tx = db.transaction(() => {
      const upd = db.prepare(`
        INSERT INTO student_term_summary (
          student_id, term_id, class_group_id, total_score_all, average_score,
          class_rank, number_on_roll
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(student_id, term_id) DO UPDATE SET
          class_group_id = excluded.class_group_id,
          total_score_all = excluded.total_score_all,
          average_score = excluded.average_score,
          class_rank = excluded.class_rank,
          number_on_roll = excluded.number_on_roll
      `);
      rows.forEach((r, i) => {
        upd.run(r.student_id, termId, classId, r.total, r.avg, i + 1, rows.length);
      });
    });
    tx();
    return { ok: true, ranked: rows.length };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase F8b — Qualitative term summary editor (Conduct / Interests /
  // Talents / Remarks).
  //
  // F8a established that the NUMERIC fields on student_term_summary
  // (class_rank, number_on_roll, days_present, total_days) are live-computed
  // by the report-card render path. These two handlers manage ONLY the four
  // qualitative TEXT fields. The UPSERT explicitly does NOT touch any
  // numeric column — preserving whatever scores:rank-class persisted (the
  // position-range scope in reports.js relies on it).
  //
  // class_group_id is derived from students.current_class_id at save time
  // (callers don't need to know it) and is only filled in when previously
  // NULL, so an existing class context from a prior summary write is never
  // overwritten.
  // ─────────────────────────────────────────────────────────────────────────
  ipcMain.handle('scores:get-term-summary', (_e, { studentId, termId }) => {
    try {
      const row = db.prepare(`
        SELECT student_id, term_id, class_group_id,
               conduct_traits, learner_interests, learner_talents, teacher_remarks
        FROM student_term_summary
        WHERE student_id = ? AND term_id = ?
      `).get(studentId, termId);
      return { ok: true, row: row || null };
    } catch (err) {
      console.warn(`[scores:get-term-summary] failed for student ${studentId}, term ${termId}: ${err.message}`);
      return { ok: false, error: err.message, row: null };
    }
  });

  ipcMain.handle('scores:save-term-summary', (_e, data) => {
    const studentId = data?.studentId;
    const termId    = data?.termId;
    if (!studentId || !termId) {
      return { ok: false, error: 'studentId and termId are required.' };
    }
    // Coerce all four qualitative inputs to strings (DB column is TEXT). null
    // / undefined become empty strings so the column is cleared, not left
    // partially modified.
    const conduct   = (data.conduct_traits    ?? '').toString();
    const interests = (data.learner_interests ?? '').toString();
    const talents   = (data.learner_talents   ?? '').toString();
    const remarks   = (data.teacher_remarks   ?? '').toString();

    try {
      // Derive class_group_id from the student record (defensive — caller
      // doesn't need to know it). May be null if student is unassigned.
      const stu = db.prepare(
        'SELECT current_class_id FROM students WHERE id = ?'
      ).get(studentId);
      const classGroupId = stu?.current_class_id ?? null;

      db.prepare(`
        INSERT INTO student_term_summary (
          student_id, term_id, class_group_id,
          conduct_traits, learner_interests, learner_talents, teacher_remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(student_id, term_id) DO UPDATE SET
          conduct_traits    = excluded.conduct_traits,
          learner_interests = excluded.learner_interests,
          learner_talents   = excluded.learner_talents,
          teacher_remarks   = excluded.teacher_remarks,
          class_group_id    = COALESCE(student_term_summary.class_group_id, excluded.class_group_id)
      `).run(studentId, termId, classGroupId, conduct, interests, talents, remarks);

      return { ok: true };
    } catch (err) {
      console.warn(`[scores:save-term-summary] failed for student ${studentId}, term ${termId}: ${err.message}`);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('scores:save-subject', (_e, data) => {
    const result = db.prepare(`
      INSERT INTO subjects (name, code, class_weight_pct, exam_weight_pct)
      VALUES (?, ?, ?, ?)
    `).run(data.name, data.code || '', data.class_weight_pct || 40, data.exam_weight_pct || 60);
    return { ok: true, id: result.lastInsertRowid };
  });

  ipcMain.handle('scores:delete-subject', (_e, id) => {
    db.prepare('UPDATE subjects SET is_active = 0 WHERE id = ?').run(id);
    return { ok: true };
  });

  // ═══ WHONET-style Class Scores (assessment columns) ═══

  function getWeights() {
    const cw = db.prepare("SELECT value FROM settings WHERE key = 'class_weight_pct'").get();
    const ew = db.prepare("SELECT value FROM settings WHERE key = 'exam_weight_pct'").get();
    return {
      classWeight: parseFloat(cw?.value || '40'),
      examWeight: parseFloat(ew?.value || '60'),
    };
  }

  ipcMain.handle('scores:get-weights', () => getWeights());

  ipcMain.handle('scores:list-assessment-columns', (_e, { classId, subjectId, termId }) => {
    let cols = db.prepare(`
      SELECT * FROM assessment_columns
      WHERE class_group_id = ? AND subject_id = ? AND term_id = ?
      ORDER BY display_order, id
    `).all(classId, subjectId, termId);
    if (cols.length === 0) {
      const defaults = ['Assignment', 'Quiz', 'Class Test', 'Mid-Sem Exams'];
      const ins = db.prepare(`
        INSERT INTO assessment_columns (class_group_id, subject_id, term_id, assessment_type, max_marks, display_order)
        VALUES (?, ?, ?, ?, 10, ?)
      `);
      defaults.forEach((t, i) => ins.run(classId, subjectId, termId, t, i));
      cols = db.prepare(`
        SELECT * FROM assessment_columns
        WHERE class_group_id = ? AND subject_id = ? AND term_id = ?
        ORDER BY display_order, id
      `).all(classId, subjectId, termId);
    }
    return cols;
  });

  ipcMain.handle('scores:add-assessment-column', (_e, { classId, subjectId, termId, assessmentType, maxMarks, displayOrder }) => {
    const r = db.prepare(`
      INSERT INTO assessment_columns (class_group_id, subject_id, term_id, assessment_type, max_marks, display_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(classId, subjectId, termId, assessmentType || 'Assignment', maxMarks || 10, displayOrder || 0);
    return { ok: true, id: r.lastInsertRowid };
  });

  ipcMain.handle('scores:update-assessment-column', (_e, { id, assessmentType, maxMarks }) => {
    db.prepare('UPDATE assessment_columns SET assessment_type = ?, max_marks = ? WHERE id = ?')
      .run(assessmentType, maxMarks, id);
    return { ok: true };
  });

  ipcMain.handle('scores:delete-assessment-column', (_e, id) => {
    db.prepare('DELETE FROM assessment_columns WHERE id = ?').run(id);
    return { ok: true };
  });

  ipcMain.handle('scores:class-sheet', (_e, { classId, subjectId, termId }) => {
    const columns = db.prepare(`
      SELECT * FROM assessment_columns
      WHERE class_group_id = ? AND subject_id = ? AND term_id = ?
      ORDER BY display_order, id
    `).all(classId, subjectId, termId);
    const students = db.prepare(`
      SELECT id, index_number, surname, first_name, other_names
      FROM students WHERE current_class_id = ? AND status = 'Active'
      ORDER BY surname, first_name
    `).all(classId);
    const colIds = columns.map(c => c.id);
    const totalMax = columns.reduce((s, c) => s + c.max_marks, 0);
    const { classWeight } = getWeights();
    const rows = students.map(st => {
      const marks = {};
      if (colIds.length) {
        const ph = colIds.map(() => '?').join(',');
        const recs = db.prepare(`
          SELECT assessment_column_id, marks FROM assessment_scores
          WHERE student_id = ? AND assessment_column_id IN (${ph})
        `).all(st.id, ...colIds);
        for (const r of recs) marks[r.assessment_column_id] = r.marks;
      }
      const rawTotal = colIds.reduce((s, cid) => s + (marks[cid] || 0), 0);
      const converted = totalMax > 0 ? Math.round((rawTotal / totalMax) * classWeight * 100) / 100 : 0;
      return {
        student_id: st.id, index_number: st.index_number,
        surname: st.surname, first_name: st.first_name, other_names: st.other_names,
        marks, raw_total: rawTotal, converted_class_score: converted,
      };
    });
    return { columns, students: rows, total_max: totalMax, class_weight: classWeight };
  });

  ipcMain.handle('scores:save-assessment-mark', (_e, { columnId, studentId, marks }) => {
    db.prepare(`
      INSERT INTO assessment_scores (assessment_column_id, student_id, marks)
      VALUES (?, ?, ?)
      ON CONFLICT (assessment_column_id, student_id) DO UPDATE SET marks = excluded.marks
    `).run(columnId, studentId, marks || 0);
    const col = db.prepare('SELECT class_group_id, subject_id, term_id FROM assessment_columns WHERE id = ?').get(columnId);
    if (col) recomputeClassScore(db, col.class_group_id, col.subject_id, col.term_id, studentId, getWeights());
    return { ok: true };
  });

  // ═══ WHONET-style Exams Scores (all mapped subjects, one sheet) ═══
  ipcMain.handle('scores:exam-sheet', (_e, { classId, termId }) => {
    let subjects = db.prepare(`
      SELECT s.id, s.name, s.code
      FROM subjects s
      JOIN class_subjects cs ON cs.subject_id = s.id
      WHERE cs.class_group_id = ? AND s.is_active = 1
      ORDER BY s.name
    `).all(classId);
    if (subjects.length === 0) {
      subjects = db.prepare("SELECT id, name, code FROM subjects WHERE is_active = 1 ORDER BY name").all();
    }
    const students = db.prepare(`
      SELECT id, index_number, surname, first_name, other_names
      FROM students WHERE current_class_id = ? AND status = 'Active'
      ORDER BY surname, first_name
    `).all(classId);
    const { examWeight } = getWeights();
    const rows = students.map(st => {
      const examScores = {};
      const recs = db.prepare("SELECT subject_id, exam_score FROM scores WHERE student_id = ? AND term_id = ?").all(st.id, termId);
      for (const r of recs) examScores[r.subject_id] = r.exam_score;
      const converted = {};
      for (const sub of subjects) {
        converted[sub.id] = Math.round(((examScores[sub.id] || 0) / 100) * examWeight * 100) / 100;
      }
      return {
        student_id: st.id, index_number: st.index_number,
        surname: st.surname, first_name: st.first_name,
        exam_scores: examScores, converted_scores: converted,
      };
    });
    return { subjects, students: rows, exam_weight: examWeight };
  });

  ipcMain.handle('scores:save-exam-mark', (_e, { studentId, subjectId, termId, examScore }) => {
    db.prepare(`
      INSERT INTO scores (student_id, term_id, subject_id, exam_score)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (student_id, term_id, subject_id) DO UPDATE SET exam_score = excluded.exam_score
    `).run(studentId, termId, subjectId, examScore || 0);
    recomputeTotal(db, studentId, subjectId, termId, getWeights());
    return { ok: true };
  });

  // ═══ End of Term Results (class+exam combined) ═══
  ipcMain.handle('scores:end-of-term', (_e, { classId, termId }) => {
    const subjects = db.prepare("SELECT id, name, code FROM subjects WHERE is_active = 1 ORDER BY name").all();
    const students = db.prepare(`
      SELECT id, index_number, surname, first_name FROM students
      WHERE current_class_id = ? AND status = 'Active' ORDER BY surname, first_name
    `).all(classId);
    const { classWeight, examWeight } = getWeights();
    const rows = students.map(st => {
      const perSubject = {};
      let grandTotal = 0, subjectCount = 0;
      for (const sub of subjects) {
        const sc = db.prepare("SELECT class_score, exam_score, total_score FROM scores WHERE student_id = ? AND term_id = ? AND subject_id = ?").get(st.id, termId, sub.id);
        const classScore = sc?.class_score || 0;
        const examScore = sc?.exam_score || 0;
        const examConverted = Math.round((examScore / 100) * examWeight * 100) / 100;
        const total = Math.round((classScore + examConverted) * 100) / 100;
        perSubject[sub.id] = { class_score: classScore, exam_converted: examConverted, total };
        if (total > 0) { grandTotal += total; subjectCount++; }
      }
      const average = subjectCount > 0 ? Math.round((grandTotal / subjectCount) * 100) / 100 : 0;
      return {
        student_id: st.id, index_number: st.index_number,
        surname: st.surname, first_name: st.first_name,
        per_subject: perSubject, grand_total: Math.round(grandTotal * 100) / 100, average,
      };
    });
    rows.sort((a, b) => b.average - a.average);
    rows.forEach((r, i) => { r.position = i + 1; });
    return { subjects, students: rows, class_weight: classWeight, exam_weight: examWeight };
  });
}

function recomputeClassScore(db, classId, subjectId, termId, studentId, weights) {
  const cols = db.prepare(`
    SELECT id, max_marks FROM assessment_columns
    WHERE class_group_id = ? AND subject_id = ? AND term_id = ?
  `).all(classId, subjectId, termId);
  const totalMax = cols.reduce((s, c) => s + c.max_marks, 0);
  let raw = 0;
  for (const c of cols) {
    const m = db.prepare('SELECT marks FROM assessment_scores WHERE assessment_column_id = ? AND student_id = ?').get(c.id, studentId);
    raw += (m?.marks || 0);
  }
  const classScore = totalMax > 0 ? Math.round((raw / totalMax) * weights.classWeight * 100) / 100 : 0;
  db.prepare(`
    INSERT INTO scores (student_id, term_id, subject_id, class_score)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (student_id, term_id, subject_id) DO UPDATE SET class_score = excluded.class_score
  `).run(studentId, termId, subjectId, classScore);
  recomputeTotal(db, studentId, subjectId, termId, weights);
}

function recomputeTotal(db, studentId, subjectId, termId, weights) {
  const sc = db.prepare("SELECT class_score, exam_score FROM scores WHERE student_id = ? AND term_id = ? AND subject_id = ?").get(studentId, termId, subjectId);
  if (!sc) return;
  const examConverted = Math.round(((sc.exam_score || 0) / 100) * weights.examWeight * 100) / 100;
  const total = Math.round(((sc.class_score || 0) + examConverted) * 100) / 100;
  db.prepare('UPDATE scores SET total_score = ? WHERE student_id = ? AND term_id = ? AND subject_id = ?').run(total, studentId, termId, subjectId);
}

module.exports = registerScoresHandlers;
