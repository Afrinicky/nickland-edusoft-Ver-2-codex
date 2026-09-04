// Nickland Edusoft — examinations, as queries rather than as IPC handlers.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The exam paper and question-bank logic lived inside `ipcMain.handle` closures
// in ipc/academics.js, which meant it could be reached from the desktop window
// and from nowhere else. The web app needs the same three tables over HTTP.
//
// So the queries are here, taking `db` and returning plain objects, and both
// callers use them: the IPC handlers the desktop's own screens invoke, and the
// routes in server/api.js. One implementation, so a paper saved from a browser
// on the school Wi-Fi and one saved at the office PC cannot drift.
//
// Mirrors cloud-python/app/school/exams.py, which is the same thing again for
// the online school. If one changes, all three change.

const PAPER_FIELDS = ['title', 'class_group_id', 'subject_id', 'term_id', 'exam_type',
  'total_marks', 'duration_minutes', 'instructions', 'status'];

const QUESTION_FIELDS = ['exam_paper_id', 'section_id', 'class_group_id', 'subject_id',
  'question_type', 'question_text', 'question_image_path', 'marks', 'difficulty',
  'option_a', 'option_b', 'option_c', 'option_d', 'correct_option', 'model_answer',
  'display_order', 'in_question_bank'];

const SECTION_FIELDS = ['exam_paper_id', 'section_label', 'instructions',
  'marks_allocation', 'display_order'];

const clean = (data, fields) => {
  const out = {};
  for (const k of fields) {
    if (Object.prototype.hasOwnProperty.call(data || {}, k)) {
      out[k] = data[k] === '' ? null : data[k];
    }
  }
  return out;
};

const int = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

// ── papers ──────────────────────────────────────────────────────────────────

function listPapers(db, filters = {}) {
  let sql = `
    SELECT ep.*, cg.name AS class_name, cg.short_code AS class_short,
           s.name AS subject_name, t.label AS term_label, y.label AS year_label,
           u.full_name AS created_by_name,
           (SELECT COUNT(*) FROM exam_questions WHERE exam_paper_id = ep.id) AS question_count
    FROM exam_papers ep
    LEFT JOIN class_groups cg ON cg.id = ep.class_group_id
    LEFT JOIN subjects s ON s.id = ep.subject_id
    LEFT JOIN terms t ON t.id = ep.term_id
    LEFT JOIN academic_years y ON y.id = t.academic_year_id
    LEFT JOIN users u ON u.id = ep.created_by
    WHERE 1=1`;
  const p = [];
  const classId = int(filters.classId); if (classId) { sql += ' AND ep.class_group_id = ?'; p.push(classId); }
  const subjectId = int(filters.subjectId); if (subjectId) { sql += ' AND ep.subject_id = ?'; p.push(subjectId); }
  const termId = int(filters.termId); if (termId) { sql += ' AND ep.term_id = ?'; p.push(termId); }
  if (filters.status) { sql += ' AND ep.status = ?'; p.push(String(filters.status)); }
  sql += ' ORDER BY ep.id DESC LIMIT 500';
  return db.prepare(sql).all(...p);
}

function getPaper(db, id) {
  const paper = db.prepare(`
    SELECT ep.*, cg.name AS class_name, s.name AS subject_name, t.label AS term_label
    FROM exam_papers ep
    LEFT JOIN class_groups cg ON cg.id = ep.class_group_id
    LEFT JOIN subjects s ON s.id = ep.subject_id
    LEFT JOIN terms t ON t.id = ep.term_id
    WHERE ep.id = ?`).get(id);
  if (!paper) return null;
  paper.sections = db.prepare(
    'SELECT * FROM exam_sections WHERE exam_paper_id = ? ORDER BY display_order, id').all(id);
  paper.questions = db.prepare(
    'SELECT * FROM exam_questions WHERE exam_paper_id = ? ORDER BY display_order, id').all(id);
  return paper;
}

function savePaper(db, data, userId) {
  const row = clean(data, PAPER_FIELDS);
  if (!String(row.title || '').trim()) return { ok: false, error: 'Give the paper a title.' };
  if (data && data.id) {
    const cols = Object.keys(row);
    db.prepare(`UPDATE exam_papers SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`)
      .run(...cols.map(c => row[c]), data.id);
    return { ok: true, id: data.id };
  }
  if (row.status == null) row.status = 'draft';
  row.created_by = userId || null;
  const cols = Object.keys(row);
  const r = db.prepare(
    `INSERT INTO exam_papers (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  ).run(...cols.map(c => row[c]));
  return { ok: true, id: r.lastInsertRowid };
}

function deletePaper(db, id) {
  const paper = db.prepare('SELECT id, title FROM exam_papers WHERE id = ?').get(id);
  if (!paper) return { ok: false, error: 'No such paper.' };
  const tx = db.transaction(() => {
    // A question written INTO the bank outlives the paper it was written for —
    // that is what a bank is. The rest go with the paper.
    db.prepare(`UPDATE exam_questions SET exam_paper_id = NULL, section_id = NULL
                 WHERE exam_paper_id = ? AND in_question_bank = 1`).run(id);
    db.prepare('DELETE FROM exam_questions WHERE exam_paper_id = ?').run(id);
    db.prepare('DELETE FROM exam_sections WHERE exam_paper_id = ?').run(id);
    db.prepare('DELETE FROM exam_papers WHERE id = ?').run(id);
  });
  tx();
  return { ok: true, title: paper.title };
}

// ── sections ────────────────────────────────────────────────────────────────

function saveSection(db, data) {
  const row = clean(data, SECTION_FIELDS);
  if (!row.exam_paper_id || !String(row.section_label || '').trim()) {
    return { ok: false, error: 'A section needs a paper and a label.' };
  }
  if (data.id) {
    const cols = Object.keys(row);
    db.prepare(`UPDATE exam_sections SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`)
      .run(...cols.map(c => row[c]), data.id);
    return { ok: true, id: data.id };
  }
  const cols = Object.keys(row);
  const r = db.prepare(
    `INSERT INTO exam_sections (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  ).run(...cols.map(c => row[c]));
  return { ok: true, id: r.lastInsertRowid };
}

function deleteSection(db, id) {
  const tx = db.transaction(() => {
    db.prepare('UPDATE exam_questions SET section_id = NULL WHERE section_id = ?').run(id);
    db.prepare('DELETE FROM exam_sections WHERE id = ?').run(id);
  });
  tx();
  return { ok: true };
}

// ── questions and the bank ──────────────────────────────────────────────────

function listQuestions(db, filters = {}) {
  let sql = `
    SELECT eq.*, cg.name AS class_name, s.name AS subject_name,
           ep.title AS paper_title, u.full_name AS created_by_name
    FROM exam_questions eq
    LEFT JOIN class_groups cg ON cg.id = eq.class_group_id
    LEFT JOIN subjects s ON s.id = eq.subject_id
    LEFT JOIN exam_papers ep ON ep.id = eq.exam_paper_id
    LEFT JOIN users u ON u.id = eq.created_by
    WHERE 1=1`;
  const p = [];
  const paperId = int(filters.paperId); if (paperId) { sql += ' AND eq.exam_paper_id = ?'; p.push(paperId); }
  const sectionId = int(filters.sectionId); if (sectionId) { sql += ' AND eq.section_id = ?'; p.push(sectionId); }
  const classId = int(filters.classId); if (classId) { sql += ' AND eq.class_group_id = ?'; p.push(classId); }
  const subjectId = int(filters.subjectId); if (subjectId) { sql += ' AND eq.subject_id = ?'; p.push(subjectId); }
  if (filters.questionType) { sql += ' AND eq.question_type = ?'; p.push(String(filters.questionType)); }
  if (filters.difficulty) { sql += ' AND eq.difficulty = ?'; p.push(String(filters.difficulty)); }
  if (filters.inBank && String(filters.inBank) !== '0') sql += ' AND eq.in_question_bank = 1';
  if (filters.search) { sql += ' AND eq.question_text LIKE ?'; p.push(`%${String(filters.search).slice(0, 80)}%`); }
  sql += ' ORDER BY eq.display_order, eq.id LIMIT 500';
  return db.prepare(sql).all(...p);
}

function saveQuestion(db, data, userId) {
  const row = clean(data, QUESTION_FIELDS);
  if (!String(row.question_text || '').trim()) return { ok: false, error: 'A question needs its text.' };
  if (data.id) {
    const cols = Object.keys(row);
    db.prepare(`UPDATE exam_questions SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`)
      .run(...cols.map(c => row[c]), data.id);
    return { ok: true, id: data.id };
  }
  row.created_by = userId || null;
  const cols = Object.keys(row);
  const r = db.prepare(
    `INSERT INTO exam_questions (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  ).run(...cols.map(c => row[c]));
  return { ok: true, id: r.lastInsertRowid };
}

function deleteQuestion(db, id) {
  db.prepare('DELETE FROM exam_questions WHERE id = ?').run(id);
  return { ok: true };
}

/**
 * Put bank questions onto a paper — copied, not moved.
 *
 * A question used on this term's paper has to still be in the bank for next
 * term's, so each is duplicated. The copy has `in_question_bank = 0`, or the
 * bank would fill with one entry per time a question was ever used.
 */
function copyFromBank(db, { paperId, sectionId, questionIds }, userId) {
  if (!paperId || !questionIds || !questionIds.length) {
    return { ok: false, error: 'Choose a paper and at least one question.' };
  }
  let order = db.prepare(
    'SELECT COALESCE(MAX(display_order), 0) n FROM exam_questions WHERE exam_paper_id = ?'
  ).get(paperId).n;
  let copied = 0;
  const tx = db.transaction(() => {
    for (const qid of questionIds) {
      const q = db.prepare('SELECT * FROM exam_questions WHERE id = ?').get(qid);
      if (!q) continue;
      order += 1;
      db.prepare(`
        INSERT INTO exam_questions
          (exam_paper_id, section_id, class_group_id, subject_id, question_type,
           question_text, question_image_path, marks, difficulty,
           option_a, option_b, option_c, option_d, correct_option, model_answer,
           display_order, in_question_bank, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)
      `).run(paperId, sectionId || null, q.class_group_id, q.subject_id, q.question_type,
        q.question_text, q.question_image_path, q.marks, q.difficulty,
        q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option, q.model_answer,
        order, userId || null);
      copied += 1;
    }
  });
  tx();
  return { ok: true, copied };
}

module.exports = {
  listPapers, getPaper, savePaper, deletePaper,
  saveSection, deleteSection,
  listQuestions, saveQuestion, deleteQuestion, copyFromBank,
  PAPER_FIELDS, QUESTION_FIELDS, SECTION_FIELDS,
};
