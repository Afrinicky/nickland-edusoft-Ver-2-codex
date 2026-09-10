// Nickland Edusoft — when the school and a phone disagree.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
//   node test/sync_conflicts.js       (requires Node >= 22.5)
//
// The scenario this exists for, written down in ARCHITECTURE-OFFLINE.md long
// before it was fixed:
//
//   Monday 8pm    a teacher enters 62 from home.
//   Tuesday 9am   the head teacher spots a marking error on the desktop and
//                 corrects it to 68.
//   Tuesday 9.05  the sync timer drains Monday's queue.
//
// The mark used to go back to 62, and nobody was told. The desktop is the
// source of truth, so it must now keep 68 — and say that a teacher believed
// otherwise, rather than swallowing it.
//
// What must NOT break while fixing that: a redelivered batch is still a no-op,
// and an ordinary entry with nothing underneath it still applies.

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`These tests need Node >= 22.5 (running ${process.versions.node}).`);
  process.exit(1);
}

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { SCHEMA, runMigrations, seedDefaults } = require(path.join(ROOT, 'electron/db/database.js'));
const apply = require(path.join(ROOT, 'electron/server/sync/apply_staff.js'));

let pass = 0, fail = 0;
const ck = (name, cond, extra) => {
  cond ? pass++ : fail++;
  console.log((cond ? '✓' : '✗') + ' ' + name);
  if (!cond && extra !== undefined) console.log('    ' + JSON.stringify(extra));
};

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.transaction = (fn) => (...a) => {
    db.exec('BEGIN');
    try { const r = fn(...a); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  db.exec(SCHEMA);
  runMigrations(db);
  seedDefaults(db);
  return db;
}

// One class, one subject, one pupil, and a teacher who may mark them.
function seed(db) {
  const designation = db.prepare("SELECT id FROM designations WHERE name = 'Super Admin'").get();
  db.prepare(`INSERT INTO users (id, username, password_hash, full_name, designation_id, is_active)
              VALUES (7, 'akua', 'x', 'Akua Mensah', ?, 1)`).run(designation.id);
  // A freshly provisioned school already has the standard ladder and the usual
  // subjects, so this uses them rather than inventing a second Basic 5.
  const cls = db.prepare("SELECT id FROM class_groups ORDER BY level_order LIMIT 1").get();
  const subject = db.prepare("SELECT id FROM subjects ORDER BY id LIMIT 1").get();
  db.prepare(`INSERT INTO students (id, index_number, surname, first_name, current_class_id, status)
              VALUES (500,'AMS/2025/001','Owusu','Kofi',?,'Active')`).run(cls.id);
  const term = db.prepare('SELECT id FROM terms WHERE is_current = 1').get();
  return { termId: term.id, userId: 7, subjectId: subject.id, studentId: 500, classId: cls.id };
}

const scoreOf = (db, s) =>
  (db.prepare('SELECT exam_score FROM scores WHERE student_id = ? AND subject_id = ? AND term_id = ?')
     .get(s.studentId, s.subjectId, s.termId) || {}).exam_score ?? null;

const conflicts = (db) => db.prepare('SELECT * FROM sync_conflicts ORDER BY id').all();

const scoreChange = (s, examScore, base) => ({
  type: 'score_entry',
  payload: {
    uuid: `u-${examScore}-${base}`, user_id: s.userId, subject_id: s.subjectId, term_id: s.termId,
    marks: [base === undefined
      ? { student_id: s.studentId, exam_score: examScore }
      : { student_id: s.studentId, exam_score: examScore, base_exam_score: base }],
  },
});

// ── 1. The scenario from the architecture note ─────────────────────────
console.log('\nThe head teacher corrects a mark while the queue is still holding one');
{
  const db = makeDb();
  const s = seed(db);

  // Monday: the teacher is looking at an empty cell and enters 62.
  apply.applyStaffChange(db, scoreChange(s, 62, null));
  ck('the teacher\'s mark reaches the school', scoreOf(db, s) === 62);
  ck('and that is not a conflict', conflicts(db).length === 0);

  // Tuesday morning: the head teacher corrects it on the desktop.
  const { saveExamMark } = require(path.join(ROOT, 'electron/ipc/scores.js'));
  saveExamMark(db, { studentId: s.studentId, subjectId: s.subjectId, termId: s.termId, examScore: 68 });
  ck('the head teacher\'s correction is in', scoreOf(db, s) === 68);

  // Tuesday 9.05: a second change queued Monday night, based on the empty cell.
  const handled = apply.applyStaffChange(db, scoreChange(s, 55, null));
  ck('the queued change is accepted rather than redelivered forever', handled === true);
  ck('THE CORRECTION SURVIVES — the mark is still 68, not 55', scoreOf(db, s) === 68,
    { now: scoreOf(db, s) });

  const c = conflicts(db);
  ck('and the teacher\'s mark was not simply thrown away', c.length === 1, c);
  ck('the record says what the school held', c[0] && Number(c[0].local_value) === 68);
  ck('...what the phone wanted to write', c[0] && Number(c[0].cloud_value) === 55);
  ck('...and who was set aside', c[0] && c[0].user_id === s.userId);
  ck('it names the pupil and the subject',
    c[0] && c[0].student_id === s.studentId && c[0].subject_id === s.subjectId);
}

// ── 2. What must not break ─────────────────────────────────────────────
console.log('\nThe three rules the sync engine already kept');
{
  const db = makeDb();
  const s = seed(db);

  // Rule 2: a redelivered batch is a no-op, not a conflict.
  apply.applyStaffChange(db, scoreChange(s, 71, null));
  ck('a mark applies', scoreOf(db, s) === 71);
  apply.applyStaffChange(db, scoreChange(s, 71, null));
  ck('the same batch delivered twice changes nothing', scoreOf(db, s) === 71);
  ck('and is NOT recorded as a clash with itself', conflicts(db).length === 0, conflicts(db));

  // The ordinary case: the teacher saw 71 and is correcting their own entry.
  apply.applyStaffChange(db, scoreChange(s, 74, 71));
  ck('a teacher correcting the mark they can see is applied', scoreOf(db, s) === 74);
  ck('and is not a conflict', conflicts(db).length === 0);

  // Two teachers in sequence, each seeing the other's work.
  apply.applyStaffChange(db, scoreChange(s, 80, 74));
  ck('a second teacher working from the current value is applied', scoreOf(db, s) === 80);
  ck('still no conflict', conflicts(db).length === 0);
}

// ── 3. An older cloud, which stamps no base at all ─────────────────────
console.log('\nA change from a cloud that has not been upgraded');
{
  const db = makeDb();
  const s = seed(db);
  apply.applyStaffChange(db, scoreChange(s, 60, undefined));
  ck('applies, because refusing it would be worse than the risk', scoreOf(db, s) === 60);
  ck('and nothing is recorded, because nothing could be checked', conflicts(db).length === 0);

  const { saveExamMark } = require(path.join(ROOT, 'electron/ipc/scores.js'));
  saveExamMark(db, { studentId: s.studentId, subjectId: s.subjectId, termId: s.termId, examScore: 90 });
  apply.applyStaffChange(db, scoreChange(s, 61, undefined));
  ck('an un-stamped change still overwrites, exactly as it always did', scoreOf(db, s) === 61,
    { now: scoreOf(db, s) });
}

// ── 4. Term remarks, which two people genuinely both write ─────────────
// The class teacher fills them in; the head teacher rewords them before the
// report goes out. Settled field by field, so a teacher who wrote the conduct
// while the head reworded the remark loses neither.
console.log('\nEnd-of-term remarks, where the head teacher and the class teacher both write');
{
  const db = makeDb();
  const s = seed(db);
  const summary = () => db.prepare(
    'SELECT conduct_traits, learner_interests, learner_talents, teacher_remarks FROM student_term_summary WHERE student_id = ? AND term_id = ?'
  ).get(s.studentId, s.termId) || {};

  const remarksChange = (fields, base) => ({
    type: 'term_remarks',
    payload: {
      uuid: `r-${JSON.stringify(fields)}`, user_id: s.userId,
      student_id: s.studentId, term_id: s.termId,
      ...fields, ...(base === undefined ? {} : { base }),
    },
  });

  // The class teacher writes all four from home.
  apply.applyStaffChange(db, remarksChange(
    { conduct: 'Polite', interests: 'Reading', talents: 'Football', remarks: 'A good term.' },
    { conduct: null, interests: null, talents: null, remarks: null }));
  ck('the class teacher\'s remarks reach the school', summary().teacher_remarks === 'A good term.');
  ck('all four of them', summary().conduct_traits === 'Polite' && summary().learner_talents === 'Football');

  // The head teacher rewords ONE of them on the desktop.
  db.prepare('UPDATE student_term_summary SET teacher_remarks = ? WHERE student_id = ? AND term_id = ?')
    .run('An excellent term. Keep it up.', s.studentId, s.termId);

  // A change queued before that, based on what the teacher had seen.
  apply.applyStaffChange(db, remarksChange(
    { conduct: 'Very polite', interests: 'Reading', talents: 'Football', remarks: 'A good term.' },
    { conduct: 'Polite', interests: 'Reading', talents: 'Football', remarks: 'A good term.' }));

  ck('THE HEAD TEACHER\'S WORDING SURVIVES',
    summary().teacher_remarks === 'An excellent term. Keep it up.', summary());
  ck('but the teacher\'s conduct edit, which nobody touched, still lands',
    summary().conduct_traits === 'Very polite', summary());
  ck('the fields nobody changed are left exactly as they were',
    summary().learner_interests === 'Reading' && summary().learner_talents === 'Football');

  const c = conflicts(db).filter(x => x.entity_type === 'term_remark');
  ck('one field disagreed, and only one is recorded', c.length === 1, c);
  ck('and it names which one', c[0] && c[0].field === 'teacher_remarks', c[0]);
  ck('with both sides of it', c[0] &&
    c[0].local_value === 'An excellent term. Keep it up.' && c[0].cloud_value === 'A good term.');
}

// ── 5. The conflict record is a note, not an error ─────────────────────
console.log('\nWhat the school can see afterwards');
{
  const db = makeDb();
  const s = seed(db);
  const { saveExamMark } = require(path.join(ROOT, 'electron/ipc/scores.js'));

  apply.applyStaffChange(db, scoreChange(s, 40, null));
  saveExamMark(db, { studentId: s.studentId, subjectId: s.subjectId, termId: s.termId, examScore: 75 });
  apply.applyStaffChange(db, scoreChange(s, 41, 40));

  const open = db.prepare("SELECT COUNT(*) AS n FROM sync_conflicts WHERE reviewed_at IS NULL").get().n;
  ck('an unreviewed conflict is countable, so a screen can raise it', open === 1, { open });
  ck('it is kept local and never pushed as a change',
    db.prepare("SELECT COUNT(*) AS n FROM sync_outbox WHERE entity_type LIKE '%conflict%'").get().n === 0);
  ck('the mark itself is the school\'s', scoreOf(db, s) === 75);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
