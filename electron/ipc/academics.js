// Nickland Edusoft — Academics IPC (Cumulative profile, exam papers, question bank)
// Copyright © 2026 Nickland Sales. All rights reserved.

module.exports = function registerAcademicsHandlers(ipcMain, db) {

  // ── Cumulative Academic Profile ──────────────────────
  // Returns one row per (term, subject) since admission
  ipcMain.handle('scores:student-cumulative', (_e, studentId) => {
    const student = db.prepare(`
      SELECT s.*, c.name AS class_name, c.short_code AS class_short
      FROM students s
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      WHERE s.id = ?
    `).get(studentId);
    if (!student) return null;

    // Per-term performance summary
    const terms = db.prepare(`
      SELECT
        t.id AS term_id, t.label AS term_label, t.term_number,
        y.id AS year_id, y.label AS year_label,
        sts.average_score, sts.class_rank, sts.number_on_roll,
        sts.total_score_all, sts.days_present, sts.total_days,
        sts.teacher_remarks, sts.learner_interests, sts.learner_talents,
        cg.name AS class_name, cg.short_code AS class_short,
        cg.id AS class_id
      FROM terms t
      LEFT JOIN academic_years y ON y.id = t.academic_year_id
      LEFT JOIN student_term_summary sts ON sts.student_id = ? AND sts.term_id = t.id
      LEFT JOIN class_groups cg ON cg.id = sts.class_group_id
      ORDER BY y.start_date, t.term_number
    `).all(studentId);

    // Per-term per-subject scores
    const subjectsByTerm = db.prepare(`
      SELECT
        s.term_id, t.label AS term_label, t.term_number,
        y.label AS year_label,
        sub.name AS subject_name, sub.code AS subject_code,
        s.class_score, s.exam_score, s.total_score, s.grade_remark
      FROM scores s
      JOIN terms t ON t.id = s.term_id
      JOIN academic_years y ON y.id = t.academic_year_id
      JOIN subjects sub ON sub.id = s.subject_id
      WHERE s.student_id = ?
      ORDER BY y.start_date, t.term_number, sub.name
    `).all(studentId);

    // Group subjects by term
    const subjectsByTermMap = {};
    for (const r of subjectsByTerm) {
      if (!subjectsByTermMap[r.term_id]) subjectsByTermMap[r.term_id] = [];
      subjectsByTermMap[r.term_id].push(r);
    }

    // Filter to only terms with data
    const termsWithData = terms.filter(t => subjectsByTermMap[t.term_id] || t.average_score != null);
    for (const t of termsWithData) {
      t.subjects = subjectsByTermMap[t.term_id] || [];
    }

    // Overall stats
    const overall = db.prepare(`
      SELECT
        COUNT(DISTINCT term_id) AS terms_recorded,
        ROUND(AVG(average_score), 2) AS lifetime_average,
        MIN(class_rank) AS best_rank,
        SUM(days_present) AS total_days_present,
        SUM(total_days) AS total_school_days
      FROM student_term_summary
      WHERE student_id = ? AND average_score IS NOT NULL
    `).get(studentId);

    return {
      student,
      overall,
      terms: termsWithData,
    };
  });

  // ── EXAMINATIONS: Papers ─────────────────────────────
  ipcMain.handle('exams:list-papers', (_e, filters = {}) => {
    let sql = `
      SELECT ep.*, cg.name AS class_name, cg.short_code AS class_short,
             s.name AS subject_name, t.label AS term_label,
             y.label AS year_label,
             u.full_name AS created_by_name,
             (SELECT COUNT(*) FROM exam_questions WHERE exam_paper_id = ep.id) AS question_count
      FROM exam_papers ep
      LEFT JOIN class_groups cg ON cg.id = ep.class_group_id
      LEFT JOIN subjects s ON s.id = ep.subject_id
      LEFT JOIN terms t ON t.id = ep.term_id
      LEFT JOIN academic_years y ON y.id = t.academic_year_id
      LEFT JOIN users u ON u.id = ep.created_by
      WHERE 1=1
    `;
    const params = [];
    if (filters.classId)   { sql += ' AND ep.class_group_id = ?'; params.push(filters.classId); }
    if (filters.subjectId) { sql += ' AND ep.subject_id = ?';     params.push(filters.subjectId); }
    if (filters.termId)    { sql += ' AND ep.term_id = ?';        params.push(filters.termId); }
    if (filters.status)    { sql += ' AND ep.status = ?';         params.push(filters.status); }
    sql += ' ORDER BY ep.created_at DESC';
    return db.prepare(sql).all(...params);
  });

  ipcMain.handle('exams:get-paper', (_e, id) => {
    const paper = db.prepare(`
      SELECT ep.*, cg.name AS class_name, s.name AS subject_name, t.label AS term_label
      FROM exam_papers ep
      LEFT JOIN class_groups cg ON cg.id = ep.class_group_id
      LEFT JOIN subjects s ON s.id = ep.subject_id
      LEFT JOIN terms t ON t.id = ep.term_id
      WHERE ep.id = ?
    `).get(id);
    if (!paper) return null;
    paper.sections = db.prepare(`
      SELECT * FROM exam_sections WHERE exam_paper_id = ? ORDER BY display_order, id
    `).all(id);
    paper.questions = db.prepare(`
      SELECT * FROM exam_questions WHERE exam_paper_id = ? ORDER BY display_order, id
    `).all(id);
    return paper;
  });

  ipcMain.handle('exams:save-paper', (_e, data) => {
    if (data.id) {
      db.prepare(`
        UPDATE exam_papers SET
          title = ?, class_group_id = ?, subject_id = ?, term_id = ?,
          exam_type = ?, total_marks = ?, duration_minutes = ?,
          instructions = ?, status = ?
        WHERE id = ?
      `).run(
        data.title, data.class_group_id || null, data.subject_id || null,
        data.term_id || null, data.exam_type || 'end_of_term',
        data.total_marks || null, data.duration_minutes || null,
        data.instructions || null, data.status || 'draft', data.id
      );
      return { ok: true, id: data.id };
    } else {
      const r = db.prepare(`
        INSERT INTO exam_papers
          (title, class_group_id, subject_id, term_id, exam_type,
           total_marks, duration_minutes, instructions, status, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.title, data.class_group_id || null, data.subject_id || null,
        data.term_id || null, data.exam_type || 'end_of_term',
        data.total_marks || null, data.duration_minutes || null,
        data.instructions || null, data.status || 'draft',
        data.created_by || null
      );
      return { ok: true, id: r.lastInsertRowid };
    }
  });

  ipcMain.handle('exams:delete-paper', (_e, id) => {
    db.prepare('DELETE FROM exam_papers WHERE id = ?').run(id);
    return { ok: true };
  });

  // ── EXAMINATIONS: Sections ───────────────────────────
  ipcMain.handle('exams:list-sections', (_e, paperId) => {
    return db.prepare(`
      SELECT * FROM exam_sections WHERE exam_paper_id = ? ORDER BY display_order, id
    `).all(paperId);
  });

  ipcMain.handle('exams:save-section', (_e, data) => {
    if (data.id) {
      db.prepare(`
        UPDATE exam_sections SET
          section_label = ?, instructions = ?, marks_allocation = ?, display_order = ?
        WHERE id = ?
      `).run(
        data.section_label, data.instructions || null,
        data.marks_allocation || null, data.display_order || 0, data.id
      );
      return { ok: true, id: data.id };
    } else {
      const r = db.prepare(`
        INSERT INTO exam_sections
          (exam_paper_id, section_label, instructions, marks_allocation, display_order)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        data.exam_paper_id, data.section_label, data.instructions || null,
        data.marks_allocation || null, data.display_order || 0
      );
      return { ok: true, id: r.lastInsertRowid };
    }
  });

  ipcMain.handle('exams:delete-section', (_e, id) => {
    db.prepare('DELETE FROM exam_sections WHERE id = ?').run(id);
    return { ok: true };
  });

  // ── EXAMINATIONS: Questions / Question Bank ──────────
  ipcMain.handle('exams:list-questions', (_e, filters = {}) => {
    let sql = `
      SELECT eq.*, cg.name AS class_name, s.name AS subject_name,
             ep.title AS exam_paper_title,
             u.full_name AS created_by_name
      FROM exam_questions eq
      LEFT JOIN class_groups cg ON cg.id = eq.class_group_id
      LEFT JOIN subjects s ON s.id = eq.subject_id
      LEFT JOIN exam_papers ep ON ep.id = eq.exam_paper_id
      LEFT JOIN users u ON u.id = eq.created_by
      WHERE 1=1
    `;
    const params = [];
    if (filters.paperId)     { sql += ' AND eq.exam_paper_id = ?'; params.push(filters.paperId); }
    if (filters.sectionId)   { sql += ' AND eq.section_id = ?';     params.push(filters.sectionId); }
    if (filters.classId)     { sql += ' AND eq.class_group_id = ?'; params.push(filters.classId); }
    if (filters.subjectId)   { sql += ' AND eq.subject_id = ?';     params.push(filters.subjectId); }
    if (filters.questionType){ sql += ' AND eq.question_type = ?';  params.push(filters.questionType); }
    if (filters.difficulty)  { sql += ' AND eq.difficulty = ?';     params.push(filters.difficulty); }
    if (filters.inBank)      { sql += ' AND eq.in_question_bank = 1'; }
    if (filters.search)      {
      sql += ' AND eq.question_text LIKE ?';
      params.push(`%${filters.search}%`);
    }
    sql += ' ORDER BY eq.display_order, eq.id';
    return db.prepare(sql).all(...params);
  });

  ipcMain.handle('exams:save-question', (_e, data) => {
    if (data.id) {
      db.prepare(`
        UPDATE exam_questions SET
          exam_paper_id = ?, section_id = ?, class_group_id = ?, subject_id = ?,
          question_type = ?, question_text = ?, question_image_path = ?,
          marks = ?, difficulty = ?,
          option_a = ?, option_b = ?, option_c = ?, option_d = ?,
          correct_option = ?, model_answer = ?,
          display_order = ?, in_question_bank = ?
        WHERE id = ?
      `).run(
        data.exam_paper_id || null, data.section_id || null,
        data.class_group_id || null, data.subject_id || null,
        data.question_type || 'essay', data.question_text,
        data.question_image_path || null,
        data.marks || 1, data.difficulty || 'medium',
        data.option_a || null, data.option_b || null,
        data.option_c || null, data.option_d || null,
        data.correct_option || null, data.model_answer || null,
        data.display_order || 0, data.in_question_bank ? 1 : 0, data.id
      );
      return { ok: true, id: data.id };
    } else {
      const r = db.prepare(`
        INSERT INTO exam_questions
          (exam_paper_id, section_id, class_group_id, subject_id,
           question_type, question_text, question_image_path, marks, difficulty,
           option_a, option_b, option_c, option_d, correct_option, model_answer,
           display_order, in_question_bank, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.exam_paper_id || null, data.section_id || null,
        data.class_group_id || null, data.subject_id || null,
        data.question_type || 'essay', data.question_text,
        data.question_image_path || null,
        data.marks || 1, data.difficulty || 'medium',
        data.option_a || null, data.option_b || null,
        data.option_c || null, data.option_d || null,
        data.correct_option || null, data.model_answer || null,
        data.display_order || 0, data.in_question_bank ? 1 : 0,
        data.created_by || null
      );
      return { ok: true, id: r.lastInsertRowid };
    }
  });

  ipcMain.handle('exams:delete-question', (_e, id) => {
    db.prepare('DELETE FROM exam_questions WHERE id = ?').run(id);
    return { ok: true };
  });

  ipcMain.handle('exams:reorder-questions', (_e, { paperId, orderedIds }) => {
    const tx = db.transaction(() => {
      const stmt = db.prepare('UPDATE exam_questions SET display_order = ? WHERE id = ?');
      orderedIds.forEach((id, i) => stmt.run(i + 1, id));
    });
    tx();
    return { ok: true };
  });

  // Copy one or more question-bank questions into a paper (snapshot, not reference)
  // The bank original is preserved; a duplicate is created bound to the paper.
  ipcMain.handle('exams:copy-from-bank', (_e, { paperId, sectionId, questionIds }) => {
    if (!paperId || !questionIds || questionIds.length === 0) {
      return { ok: false, error: 'paperId and questionIds required' };
    }
    // Find the current max display_order on this paper to append at the end
    const maxOrder = db.prepare(`
      SELECT COALESCE(MAX(display_order), 0) AS m FROM exam_questions WHERE exam_paper_id = ?
    `).get(paperId).m;

    const tx = db.transaction(() => {
      let order = maxOrder;
      for (const qid of questionIds) {
        order += 1;
        const src = db.prepare('SELECT * FROM exam_questions WHERE id = ?').get(qid);
        if (!src) continue;
        db.prepare(`
          INSERT INTO exam_questions
            (exam_paper_id, section_id, class_group_id, subject_id,
             question_type, question_text, question_image_path, marks, difficulty,
             option_a, option_b, option_c, option_d, correct_option, model_answer,
             display_order, in_question_bank, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
        `).run(
          paperId, sectionId || null,
          src.class_group_id, src.subject_id,
          src.question_type, src.question_text, src.question_image_path,
          src.marks, src.difficulty,
          src.option_a, src.option_b, src.option_c, src.option_d,
          src.correct_option, src.model_answer,
          order, src.created_by
        );
      }
    });
    try { tx(); } catch (e) { return { ok: false, error: e.message }; }
    return { ok: true, copied: questionIds.length };
  });

  // Stats for one paper: total questions, total marks, by type
  ipcMain.handle('exams:paper-stats', (_e, paperId) => {
    const rows = db.prepare(`
      SELECT question_type, COUNT(*) AS count, COALESCE(SUM(marks), 0) AS marks
      FROM exam_questions WHERE exam_paper_id = ?
      GROUP BY question_type
    `).all(paperId);
    const total = db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(marks), 0) AS marks
      FROM exam_questions WHERE exam_paper_id = ?
    `).get(paperId);
    return { by_type: rows, total };
  });

  // ── Academic Dashboard ───────────────────────────────
  ipcMain.handle('academics:dashboard', (_e, termId) => {
    const term = termId
      ? db.prepare('SELECT * FROM terms WHERE id = ?').get(termId)
      : db.prepare("SELECT * FROM terms WHERE is_current = 1").get();
    if (!term) {
      return { metrics: {}, class_performance: [], top_students: [] };
    }

    // Total scores entered
    const scoresEntered = db.prepare(`
      SELECT COUNT(*) AS c FROM scores WHERE term_id = ?
    `).get(term.id).c;

    // Students with at least one score
    const studentsWithScores = db.prepare(`
      SELECT COUNT(DISTINCT student_id) AS c FROM scores WHERE term_id = ?
    `).get(term.id).c;

    // Class averages
    const classPerformance = db.prepare(`
      SELECT
        cg.id, cg.name AS class_name, cg.short_code,
        COUNT(DISTINCT sts.student_id) AS students_assessed,
        ROUND(AVG(sts.average_score), 1) AS class_average
      FROM student_term_summary sts
      JOIN class_groups cg ON cg.id = sts.class_group_id
      WHERE sts.term_id = ? AND sts.average_score IS NOT NULL
      GROUP BY cg.id
      ORDER BY cg.level_order
    `).all(term.id);

    // Top 10 students this term
    const topStudents = db.prepare(`
      SELECT
        sts.average_score, sts.class_rank,
        s.id AS student_id, s.surname, s.first_name, s.index_number,
        cg.name AS class_name, cg.short_code
      FROM student_term_summary sts
      JOIN students s ON s.id = sts.student_id
      LEFT JOIN class_groups cg ON cg.id = sts.class_group_id
      WHERE sts.term_id = ? AND sts.average_score IS NOT NULL
      ORDER BY sts.average_score DESC
      LIMIT 10
    `).all(term.id);

    // Exam papers
    const examPapers = db.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published,
             SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft
      FROM exam_papers WHERE term_id = ?
    `).get(term.id);

    // Question bank size
    const questionBank = db.prepare(`
      SELECT COUNT(*) AS c FROM exam_questions WHERE in_question_bank = 1
    `).get().c;

    return {
      term: { id: term.id, label: term.label, start_date: term.start_date, end_date: term.end_date },
      metrics: {
        scores_entered: scoresEntered,
        students_with_scores: studentsWithScores,
        exam_papers_total: examPapers.total || 0,
        exam_papers_published: examPapers.published || 0,
        exam_papers_draft: examPapers.draft || 0,
        question_bank_size: questionBank,
      },
      class_performance: classPerformance,
      top_students: topStudents,
    };
  });
};
