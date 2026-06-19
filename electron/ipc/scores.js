// Scores IPC handlers — score entry, ranking, term summary.
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
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



  // ═══ Assessment Compilation (foundation sheet; existing tables only) ═══
  ipcMain.handle('scores:assessment-compilation-sheet', (_e, { classId, termId }) => {
    let subjects = db.prepare(`
      SELECT s.id, s.name, s.code
      FROM subjects s
      JOIN class_subjects cs ON cs.subject_id = s.id
      WHERE cs.class_group_id = ? AND s.is_active = 1
      ORDER BY s.name
    `).all(classId);
    const usedFallbackSubjects = subjects.length === 0;
    if (usedFallbackSubjects) {
      subjects = db.prepare('SELECT id, name, code FROM subjects WHERE is_active = 1 ORDER BY name').all();
    }

    const students = db.prepare(`
      SELECT id, index_number, surname, first_name, other_names
      FROM students
      WHERE current_class_id = ? AND status = 'Active'
      ORDER BY surname, first_name
    `).all(classId);

    const { classWeight, examWeight } = getWeights();
    const rows = students.map(st => {
      const subjectScores = {};
      const recs = db.prepare(`
        SELECT subject_id, class_score, exam_score, total_score
        FROM scores
        WHERE student_id = ? AND term_id = ?
      `).all(st.id, termId);
      for (const r of recs) {
        subjectScores[r.subject_id] = {
          class_score: r.class_score ?? '',
          exam_score: r.exam_score ?? '',
          total_score: r.total_score ?? 0,
        };
      }
      const summary = db.prepare(`
        SELECT days_present, total_days, conduct_traits, learner_interests,
               learner_talents, teacher_remarks, total_score_all,
               average_score, class_rank, number_on_roll
        FROM student_term_summary
        WHERE student_id = ? AND term_id = ?
      `).get(st.id, termId) || {};
      return {
        student_id: st.id,
        index_number: st.index_number,
        surname: st.surname,
        first_name: st.first_name,
        other_names: st.other_names,
        subject_scores: subjectScores,
        summary,
      };
    });

    return {
      subjects,
      students: rows,
      used_fallback_subjects: usedFallbackSubjects,
      class_weight: classWeight,
      exam_weight: examWeight,
    };
  });

  ipcMain.handle('scores:save-assessment-compilation', (_e, { classId, termId, students }) => {
    try {
      const tx = db.transaction(() => {
        const upsertScore = db.prepare(`
          INSERT INTO scores (student_id, term_id, subject_id, class_score, exam_score, total_score)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(student_id, term_id, subject_id) DO UPDATE SET
            class_score = excluded.class_score,
            exam_score = excluded.exam_score,
            total_score = excluded.total_score
        `);
        const upsertSummary = db.prepare(`
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

        for (const st of (students || [])) {
          for (const sub of (st.subjects || [])) {
            upsertScore.run(
              st.student_id, termId, sub.subject_id,
              parseFloat(sub.class_score) || 0,
              parseFloat(sub.exam_score) || 0,
              parseFloat(sub.total_score) || 0
            );
          }
          const summary = st.summary || {};
          upsertSummary.run(
            st.student_id, termId, classId,
            parseFloat(st.total_score_all) || 0,
            parseFloat(st.average_score) || 0,
            st.class_rank || null,
            st.number_on_roll || null,
            summary.conduct_traits || '',
            summary.learner_interests || '',
            summary.learner_talents || '',
            summary.teacher_remarks || '',
            summary.days_present === '' ? null : (parseInt(summary.days_present, 10) || 0),
            summary.total_days === '' ? null : (parseInt(summary.total_days, 10) || 0)
          );
        }
      });
      tx();
      return { ok: true };
    } catch (err) {
      console.warn(`[scores:save-assessment-compilation] failed: ${err.message}`);
      return { ok: false, error: err.message };
    }
  });

  // ═══ Assessment Compilation — Excel export ═══
  // Receives a fully computed grid (headers + rows) from the renderer so the
  // exported sheet mirrors exactly what is shown on screen.
  ipcMain.handle('scores:export-assessment-compilation', async (_e, { savePath, headers, rows, meta }) => {
    try {
      const cols = Array.isArray(headers) ? headers : [];
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Assessment Compilation');
      let headerRowIdx = 1;

      if (meta && (meta.className || meta.term)) {
        ws.mergeCells(1, 1, 1, Math.max(1, cols.length));
        const titleParts = [];
        if (meta.className) titleParts.push(meta.className);
        if (meta.term) titleParts.push(meta.term);
        const titleCell = ws.getCell(1, 1);
        titleCell.value = `Assessment Compilation — ${titleParts.join('  •  ')}`;
        titleCell.font = { bold: true, size: 13, color: { argb: 'FF1B3A6B' } };
        headerRowIdx = 3;
      }

      const headerRow = ws.getRow(headerRowIdx);
      cols.forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.eachCell({ includeEmpty: false }, c => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3A6B' } };
        c.alignment = { vertical: 'middle', wrapText: true };
      });
      ws.views = [{ state: 'frozen', xSplit: 3, ySplit: headerRowIdx }];

      (rows || []).forEach(rowVals => {
        const row = ws.addRow([]);
        (rowVals || []).forEach((v, i) => {
          row.getCell(i + 1).value = (v === '' || v === null || v === undefined) ? null : v;
        });
      });

      cols.forEach((h, i) => {
        const col = ws.getColumn(i + 1);
        col.width = Math.min(28, Math.max(10, String(h || '').length + 2));
      });

      await wb.xlsx.writeFile(savePath);
      return { ok: true, path: savePath, count: (rows || []).length };
    } catch (err) {
      console.warn(`[scores:export-assessment-compilation] failed: ${err.message}`);
      return { ok: false, error: err.message };
    }
  });

  // ═══ Assessment Compilation — Excel import ═══
  // Reads a workbook and returns the raw header row + data rows. The renderer
  // maps editable columns back onto the in-memory sheet (nothing is persisted
  // until the user saves), so matching is done by the "Index No." column.
  ipcMain.handle('scores:import-assessment-compilation', async (_e, { filePath }) => {
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(filePath);
      const ws = wb.worksheets[0];
      if (!ws) return { ok: false, error: 'No worksheet found in the selected file.' };

      const wantHeader = 'index no.';
      let headerRowIdx = -1;
      let headers = [];
      const scanLimit = Math.min(ws.rowCount || 0, 15);
      for (let i = 1; i <= scanLimit; i++) {
        const vals = ws.getRow(i).values;
        const cells = vals.map(v => unwrapScoreCell(v));
        if (cells.some(c => String(c == null ? '' : c).trim().toLowerCase() === wantHeader)) {
          headerRowIdx = i;
          headers = cells.slice(1).map(c => (c == null ? '' : String(c)));
          break;
        }
      }
      if (headerRowIdx === -1) {
        return { ok: false, error: 'Could not find a header row containing "Index No." in the file.' };
      }

      const rows = [];
      for (let i = headerRowIdx + 1; i <= ws.rowCount; i++) {
        const vals = ws.getRow(i).values;
        const arr = [];
        for (let j = 1; j <= headers.length; j++) arr.push(unwrapScoreCell(vals[j]));
        if (arr.every(v => v == null || v === '')) continue;
        rows.push(arr);
      }
      return { ok: true, headers, rows };
    } catch (err) {
      console.warn(`[scores:import-assessment-compilation] failed: ${err.message}`);
      return { ok: false, error: err.message };
    }
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


function getAssessmentCompilationData(db, classId, termId, weights) {
  let subjects = db.prepare(`
    SELECT s.id, s.name, s.code
    FROM subjects s
    JOIN class_subjects cs ON cs.subject_id = s.id
    WHERE cs.class_group_id = ? AND s.is_active = 1
    ORDER BY s.name
  `).all(classId);
  const usedFallbackSubjects = subjects.length === 0;
  if (usedFallbackSubjects) subjects = db.prepare('SELECT id, name, code FROM subjects WHERE is_active = 1 ORDER BY name').all();
  const classRow = db.prepare('SELECT name FROM class_groups WHERE id = ?').get(classId) || {};
  const termRow = db.prepare('SELECT label FROM terms WHERE id = ?').get(termId) || {};
  const students = db.prepare(`
    SELECT id, index_number, surname, first_name, other_names
    FROM students
    WHERE current_class_id = ? AND status = 'Active'
    ORDER BY surname, first_name
  `).all(classId);
  const rows = students.map(st => {
    const subjectScores = {};
    const recs = db.prepare(`
      SELECT subject_id, class_score, exam_score, total_score
      FROM scores
      WHERE student_id = ? AND term_id = ?
    `).all(st.id, termId);
    for (const r of recs) {
      subjectScores[r.subject_id] = {
        class_score: r.class_score ?? '',
        exam_score: r.exam_score == null ? '' : Math.round(((r.exam_score || 0) / 100) * weights.examWeight * 100) / 100,
        total_score: r.total_score ?? 0,
      };
    }
    const summary = db.prepare(`
      SELECT days_present, total_days, conduct_traits, learner_interests,
             learner_talents, teacher_remarks, total_score_all,
             average_score, class_rank, number_on_roll
      FROM student_term_summary
      WHERE student_id = ? AND term_id = ?
    `).get(st.id, termId) || {};
    return {
      student_id: st.id,
      index_number: st.index_number,
      surname: st.surname,
      first_name: st.first_name,
      other_names: st.other_names,
      subject_scores: subjectScores,
      summary,
    };
  });
  return { subjects, students: rows, used_fallback_subjects: usedFallbackSubjects, class_weight: weights.classWeight, exam_weight: weights.examWeight, class_name: classRow.name, term_label: termRow.label };
}

function computeCompilationRows(sheet) {
  const rows = sheet.students.map(st => {
    const perSubject = {};
    let grandTotal = 0;
    let subjectCount = 0;
    for (const sub of sheet.subjects) {
      const classScore = Number(st.subject_scores[sub.id]?.class_score || 0);
      const examScore = Number(st.subject_scores[sub.id]?.exam_score || 0);
      const total = Math.round((classScore + examScore) * 100) / 100;
      perSubject[sub.id] = { class_score: classScore, exam_score: examScore, total };
      if (total > 0) { grandTotal += total; subjectCount += 1; }
    }
    return { ...st, perSubject, grand_total: Math.round(grandTotal * 100) / 100, average: subjectCount ? Math.round((grandTotal / subjectCount) * 100) / 100 : 0 };
  });
  [...rows].sort((a, b) => b.average - a.average).forEach((row, idx) => { row.position = row.average > 0 ? idx + 1 : ''; });
  return rows;
}

// Unwrap any value ExcelJS can return (strings, numbers, dates, rich text,
// formula results, hyperlinks) into a plain primitive for import matching.
function unwrapScoreCell(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (v.richText && Array.isArray(v.richText)) return v.richText.map(rt => rt.text).join('');
  if (v.result !== undefined) return unwrapScoreCell(v.result);
  if (v.text !== undefined) return v.text;
  return String(v);
}

function saveAssessmentCompilationPayload(db, { classId, termId, students }, weights) {
  if (!classId || !termId) return { ok: false, error: 'Class and term are required.' };
  const { classWeight, examWeight } = weights;
  const bands = db.prepare('SELECT * FROM grading_bands ORDER BY min_score DESC').all();
  function remark(score) { for (const b of bands) if (score >= b.min_score && score <= b.max_score) return b.remark; return ''; }
  function asNumber(value, label, min, max) {
    if (value === '' || value == null) return 0;
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${label} must be between ${min} and ${max}.`);
    return Math.round(n * 100) / 100;
  }
  function asDayCount(value, label) {
    if (value === '' || value == null) return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) throw new Error(`${label} must be a whole number of days.`);
    return n;
  }
  try {
    const tx = db.transaction(() => {
      const upsertScore = db.prepare(`
        INSERT INTO scores (student_id, term_id, subject_id, class_score, exam_score, total_score, grade_remark)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(student_id, term_id, subject_id) DO UPDATE SET
          class_score = excluded.class_score,
          exam_score = excluded.exam_score,
          total_score = excluded.total_score,
          grade_remark = excluded.grade_remark
      `);
      const upsertCompiledAssessment = db.prepare(`
        INSERT INTO assessment_scores (assessment_column_id, student_id, marks)
        VALUES (?, ?, ?)
        ON CONFLICT(assessment_column_id, student_id) DO UPDATE SET marks = excluded.marks
      `);
      const findAssessmentColumns = db.prepare(`SELECT id FROM assessment_columns WHERE class_group_id = ? AND subject_id = ? AND term_id = ? ORDER BY display_order, id`);
      const findCompiledAssessmentColumn = db.prepare(`SELECT id FROM assessment_columns WHERE class_group_id = ? AND subject_id = ? AND term_id = ? AND assessment_type = 'Assessment Compilation' ORDER BY id LIMIT 1`);
      const createCompiledAssessmentColumn = db.prepare(`INSERT INTO assessment_columns (class_group_id, subject_id, term_id, assessment_type, max_marks, display_order) VALUES (?, ?, ?, 'Assessment Compilation', ?, 999)`);
      const upsertSummary = db.prepare(`
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
      const prepared = (students || []).map(st => {
        let totalAll = 0, subjectCount = 0;
        const subjects = (st.subjects || []).map(sub => {
          const classScore = asNumber(sub.class_score, 'Class score', 0, classWeight);
          const examConverted = asNumber(sub.exam_score, 'Exam score', 0, examWeight);
          const examRaw = examWeight > 0 ? Math.round((examConverted / examWeight) * 100 * 100) / 100 : 0;
          const totalScore = Math.round((classScore + examConverted) * 100) / 100;
          if (totalScore > 0) { totalAll += totalScore; subjectCount += 1; }
          return { subject_id: sub.subject_id, classScore, examRaw, totalScore };
        });
        const summary = st.summary || {};
        const daysPresent = asDayCount(summary.days_present, 'Attendance Present');
        const totalDays = asDayCount(summary.total_days, 'Attendance Total');
        if (daysPresent != null && totalDays != null && totalDays > 0 && daysPresent > totalDays) throw new Error('Attendance Present cannot exceed Attendance Total.');
        return { student_id: st.student_id, subjects, totalAll: Math.round(totalAll * 100) / 100, average: subjectCount ? Math.round((totalAll / subjectCount) * 100) / 100 : 0, summary, daysPresent, totalDays };
      });
      const ranked = [...prepared].sort((a, b) => b.average - a.average);
      const rankByStudent = new Map(ranked.map((row, idx) => [row.student_id, row.average > 0 ? idx + 1 : null]));
      for (const st of prepared) {
        for (const sub of st.subjects) {
          upsertScore.run(st.student_id, termId, sub.subject_id, sub.classScore, sub.examRaw, sub.totalScore, remark(sub.totalScore));
          const existingCols = findAssessmentColumns.all(classId, sub.subject_id, termId);
          const compiledCol = findCompiledAssessmentColumn.get(classId, sub.subject_id, termId);
          if (compiledCol) upsertCompiledAssessment.run(compiledCol.id, st.student_id, sub.classScore);
          else if (existingCols.length === 0) {
            const col = createCompiledAssessmentColumn.run(classId, sub.subject_id, termId, classWeight);
            upsertCompiledAssessment.run(col.lastInsertRowid, st.student_id, sub.classScore);
          }
        }
        upsertSummary.run(st.student_id, termId, classId, st.totalAll, st.average, rankByStudent.get(st.student_id), prepared.length, st.summary.conduct_traits || '', st.summary.learner_interests || '', st.summary.learner_talents || '', st.summary.teacher_remarks || '', st.daysPresent, st.totalDays);
      }
    });
    tx();
    return { ok: true };
  } catch (err) {
    console.warn(`[scores:save-assessment-compilation] failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

function parseAssessmentCompilationWorksheet(ws, sheet) {
  const subjectsByName = new Map(sheet.subjects.map(s => [String(s.name).trim().toLowerCase(), s]));
  const studentsByIndex = new Map(sheet.students.map(s => [String(s.index_number || '').trim().toLowerCase(), s]));
  const headerRow = ws.getRow(4);
  const subHeaderRow = ws.getRow(5);
  const subjectColumns = [];
  let activeSubject = null;
  for (let col = 4; col <= ws.columnCount; col++) {
    const name = String(headerRow.getCell(col).value || '').trim();
    if (name) activeSubject = subjectsByName.get(name.toLowerCase()) || null;
    const label = String(subHeaderRow.getCell(col).value || headerRow.getCell(col).value || '').trim().toLowerCase();
    if (activeSubject && (label.startsWith('cls') || label.startsWith('exam'))) subjectColumns.push({ col, subject: activeSubject, type: label.startsWith('cls') ? 'class_score' : 'exam_score' });
  }
  const fixed = {};
  headerRow.eachCell((cell, col) => { fixed[String(cell.value || '').trim().toLowerCase()] = col; });
  const errors = [], validRows = [];
  for (let r = 6; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const indexNumber = String(row.getCell(2).value || '').trim();
    if (!indexNumber) continue;
    const student = studentsByIndex.get(indexNumber.toLowerCase());
    if (!student) { errors.push(`Row ${r}: student index number ${indexNumber} was not found in the selected class.`); continue; }
    const subjects = sheet.subjects.map(sub => ({ subject_id: sub.id, class_score: '', exam_score: '' }));
    for (const map of subjectColumns) {
      const item = subjects.find(s => s.subject_id === map.subject.id);
      if (item) item[map.type] = row.getCell(map.col).value ?? '';
    }
    const summary = {
      days_present: row.getCell(fixed['attendance present'] || 0).value ?? '',
      total_days: row.getCell(fixed['days opened'] || 0).value ?? '',
      conduct_traits: row.getCell(fixed['conduct'] || 0).value ?? '',
      learner_interests: row.getCell(fixed['interest'] || 0).value ?? '',
      learner_talents: row.getCell(fixed['talent'] || 0).value ?? '',
      teacher_remarks: row.getCell(fixed["teacher's remarks"] || 0).value ?? '',
    };
    validRows.push({ student_id: student.student_id, subjects, summary });
  }
  return { validRows, errors };
}


function validateAssessmentCompilationRows(rows, weights) {
  const errors = [];
  function checkNumber(value, label, min, max, rowNum) {
    if (value === '' || value == null) return;
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max) errors.push(`Row ${rowNum}: ${label} must be between ${min} and ${max}.`);
  }
  (rows || []).forEach((row, idx) => {
    const rowNum = idx + 6;
    for (const sub of (row.subjects || [])) {
      checkNumber(sub.class_score, 'Cls score', 0, weights.classWeight, rowNum);
      checkNumber(sub.exam_score, 'Exam score', 0, weights.examWeight, rowNum);
    }
    const present = row.summary?.days_present;
    const total = row.summary?.total_days;
    for (const [value, label] of [[present, 'Attendance Present'], [total, 'Days Opened']]) {
      if (value !== '' && value != null) {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0) errors.push(`Row ${rowNum}: ${label} must be a whole number of days.`);
      }
    }
    if (present !== '' && total !== '' && present != null && total != null && Number(present) > Number(total) && Number(total) > 0) {
      errors.push(`Row ${rowNum}: Attendance Present cannot exceed Days Opened.`);
    }
  });
  return errors;
}

function ensureOutputDir(savePath) {
  const dir = path.dirname(savePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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
