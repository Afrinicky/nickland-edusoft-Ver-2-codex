// Nickland Edusoft — what a member of staff may touch.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Permissions answer "may this person edit scores at all". This answers the
// question that comes straight after: "whose scores". A Subject Teacher with
// academics.edit is not thereby entitled to every class in the school.
//
// The model, from staff_assignments:
//
//   class only    (class_group_id, subject_id NULL)
//       The whole class. Every subject taught in it.
//
//   class+subject (class_group_id, subject_id)
//       That subject, in that class, and nothing else in it.
//
//   subject only  (class_group_id NULL, subject_id)
//       That subject wherever it is taught. For a specialist — the French
//       teacher who takes French in all six classes.
//
// The forms combine. A teacher may hold Basic 5 outright AND take Mathematics
// in Basic 4 and Basic 6; they see all of Basic 5, plus Mathematics in the
// other two, and nothing else. That is the case the school actually described,
// so it is the case the model is built around rather than an afterthought.
//
// `is_class_teacher` marks the one member of staff answerable for a class —
// the register and the canteen sheet. A class has one.
//
// UNRESTRICTED covers the people who run the school. A Head Teacher who could
// only see their own class could not check anybody else's marks, which is most
// of the job.

const UNRESTRICTED_DESIGNATIONS = ['Proprietor', 'Administrator', 'Head Teacher'];

// Two sources, and both matter. The database is the truth, but an account
// whose designation_id was never set — a database restored from an old
// version, or a bootstrap that ran before the designations existed — reads
// back as null there. Falling back to the designation captured at sign-in
// stops that turning an administrator into somebody with access to nothing.
function designationOf(db, userId) {
  let fromDb = null;
  try {
    const row = db.prepare(`
      SELECT d.name AS designation FROM users u
      LEFT JOIN designations d ON d.id = u.designation_id
      WHERE u.id = ?
    `).get(userId);
    fromDb = (row && row.designation) || null;
  } catch (_) { fromDb = null; }
  if (fromDb) return fromDb;

  try {
    const security = require('./_security');
    if (security.getCurrentUserId() === userId) return security.getCurrentDesignation() || null;
  } catch (_) { /* the session is a fallback, never a requirement */ }
  return null;
}

// Build the scope for a user. Cheap enough to call per request: a handful of
// rows, and staff_assignments is small by construction (one row per class or
// subject a teacher takes).
function scopeFor(db, userId) {
  const empty = {
    unrestricted: false, staffId: null,
    wholeClasses: new Set(),      // class ids held outright
    classSubjects: new Map(),     // classId -> Set(subjectId)
    anyClassSubjects: new Set(),  // subject ids taught wherever they occur
    classTeacherOf: new Set(),
    hasAssignments: false,
  };
  if (!userId) return empty;

  if (UNRESTRICTED_DESIGNATIONS.includes(designationOf(db, userId))) {
    return { ...empty, unrestricted: true };
  }

  let staffId = null;
  try { staffId = db.prepare('SELECT staff_id FROM users WHERE id = ?').get(userId)?.staff_id || null; }
  catch (_) { staffId = null; }
  if (!staffId) return empty;

  let rows = [];
  try {
    rows = db.prepare(`
      SELECT class_group_id, subject_id, is_class_teacher
      FROM staff_assignments WHERE staff_id = ?
    `).all(staffId);
  } catch (_) { rows = []; }

  const scope = { ...empty, staffId, hasAssignments: rows.length > 0 };
  for (const r of rows) {
    const cid = r.class_group_id == null ? null : Number(r.class_group_id);
    const sid = r.subject_id == null ? null : Number(r.subject_id);
    if (cid && !sid) scope.wholeClasses.add(cid);
    else if (cid && sid) {
      if (!scope.classSubjects.has(cid)) scope.classSubjects.set(cid, new Set());
      scope.classSubjects.get(cid).add(sid);
    } else if (!cid && sid) scope.anyClassSubjects.add(sid);
    if (cid && r.is_class_teacher) scope.classTeacherOf.add(cid);
  }
  return scope;
}

// May they see this class at all — as its teacher, or because they take a
// subject in it?
function canAccessClass(scope, classId) {
  if (scope.unrestricted) return true;
  const cid = Number(classId);
  if (!cid) return false;
  if (scope.wholeClasses.has(cid)) return true;
  if (scope.classSubjects.has(cid)) return true;
  // A subject taught across the school reaches a class only if the class
  // actually teaches it; that needs the database, so it is resolved by
  // canAccessSubject. Seeing the class shell is harmless and keeps the
  // class picker usable for a specialist.
  return scope.anyClassSubjects.size > 0;
}

// May they touch this subject in this class?
function canAccessSubject(scope, classId, subjectId) {
  if (scope.unrestricted) return true;
  const cid = Number(classId);
  const sid = Number(subjectId);
  if (!cid || !sid) return false;
  if (scope.wholeClasses.has(cid)) return true;              // the class is theirs
  if (scope.anyClassSubjects.has(sid)) return true;          // the subject is theirs everywhere
  const set = scope.classSubjects.get(cid);
  return !!(set && set.has(sid));
}

// The register, the canteen sheet, the end-of-term report: things one person
// is answerable for, not everyone who teaches the class.
function isClassTeacherOf(scope, classId) {
  if (scope.unrestricted) return true;
  return scope.classTeacherOf.has(Number(classId));
}

// The class ids to show in a picker or filter a list by. `null` means "no
// restriction" — the caller should not filter at all.
function visibleClassIds(db, scope) {
  if (scope.unrestricted) return null;
  const ids = new Set([...scope.wholeClasses, ...scope.classSubjects.keys()]);
  if (scope.anyClassSubjects.size) {
    // Classes that actually teach one of their subjects.
    try {
      const ph = [...scope.anyClassSubjects].map(() => '?').join(',');
      for (const r of db.prepare(
        `SELECT DISTINCT class_group_id AS id FROM class_subjects WHERE subject_id IN (${ph})`
      ).all(...scope.anyClassSubjects)) {
        if (r.id) ids.add(Number(r.id));
      }
    } catch (_) {
      // No class_subjects mapping: a subject with no mapping is taught
      // everywhere, which is how the reports module already reads it.
      try {
        for (const r of db.prepare('SELECT id FROM class_groups').all()) ids.add(Number(r.id));
      } catch (_) {}
    }
  }
  return ids;
}

// The subject ids they may touch in a given class, or null for no restriction.
function visibleSubjectIds(db, scope, classId) {
  if (scope.unrestricted) return null;
  const cid = Number(classId);
  if (scope.wholeClasses.has(cid)) return null;              // all of them
  const ids = new Set(scope.anyClassSubjects);
  const set = scope.classSubjects.get(cid);
  if (set) for (const s of set) ids.add(s);
  return ids;
}

function classOfStudent(db, studentId) {
  try { return db.prepare('SELECT current_class_id AS id FROM students WHERE id = ?').get(studentId)?.id ?? null; }
  catch (_) { return null; }
}

function canAccessStudent(db, scope, studentId) {
  if (scope.unrestricted) return true;
  const cid = classOfStudent(db, studentId);
  return cid ? canAccessClass(scope, cid) : false;
}

// Narrow a class's subject list to the ones the signed-in user may touch.
//
// A score sheet is a grid of every subject in the class, so scoping the SHEET
// by class is not enough: a teacher who takes only Mathematics in Basic 4 was
// handed the whole Basic 4 grid — English, Science, everything — and could
// type in any of it. The columns have to be filtered, not just the sheet.
//
// Returns the list unchanged for anyone unrestricted, and for a teacher who
// holds the class outright.
function filterSubjectsForCurrentUser(db, classId, subjects) {
  if (!Array.isArray(subjects) || !subjects.length) return subjects;
  let userId = null;
  try { userId = require('./_security').getCurrentUserId(); } catch (_) { userId = null; }
  // No session: this is a background or start-up read, not somebody browsing.
  if (!userId) return subjects;

  const scope = scopeFor(db, userId);
  if (scope.unrestricted) return subjects;
  if (scope.wholeClasses.has(Number(classId))) return subjects;

  const allowed = visibleSubjectIds(db, scope, classId);
  if (!allowed) return subjects;
  return subjects.filter(sub => allowed.has(Number(sub.id)));
}

module.exports = {
  UNRESTRICTED_DESIGNATIONS,
  scopeFor, canAccessClass, canAccessSubject, isClassTeacherOf,
  visibleClassIds, visibleSubjectIds, canAccessStudent, classOfStudent,
  filterSubjectsForCurrentUser,
};
