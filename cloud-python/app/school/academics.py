"""Marks and results — a translation of ``electron/ipc/scores.js`` and
``electron/ipc/academics.js``.

The weighting is the school's, not ours, and it is the reason this is one
module rather than three: a class score and an exam score are combined into a
subject total by weights kept in Settings (40/60 by default), and if the phone,
the desktop and the report card each did that arithmetic themselves a pupil
would have three different marks.

    class score  = raw continuous-assessment marks, scaled to the class weight
    exam total   = raw exam mark out of 100, scaled to the exam weight
    subject total = the two added, rounded to two decimals

Scope matters more here than anywhere else in the system. A score sheet IS the
class's whole subject grid, so scoping it by class alone hands a teacher who
takes one subject in it every column and lets them type in any of them. The
columns are filtered, not just the sheet — and the write is checked again by
resolving the pupil's class, because a save names a pupil and a subject and no
class at all.
"""
from decimal import Decimal, ROUND_HALF_UP

from . import scope as scope_lib, security


def _r2(n):
    return float(Decimal(str(n or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def weights(db):
    try:
        class_weight = float(db.get_setting("class_score_weight_pct", "40") or 40)
    except (TypeError, ValueError):
        class_weight = 40.0
    try:
        exam_weight = float(db.get_setting("exam_weight_pct", "60") or 60)
    except (TypeError, ValueError):
        exam_weight = 60.0
    return {"class": class_weight, "exam": exam_weight}


def grading_bands(db):
    """The school's own scale. A band carries the remark that goes on the
    report card — the offline schema keeps no separate grade letter, so the
    remark IS the grade a parent reads."""
    return db.all("""SELECT min_score, max_score, remark, display_order
                       FROM grading_bands ORDER BY min_score DESC""")


def _remark(bands, score):
    for b in bands:
        if b["min_score"] <= (score or 0) <= b["max_score"]:
            return b["remark"]
    return ""


def _may_write_mark(db, actor, student_id, subject_id):
    """May this account write this pupil's mark in this subject?

    A save names a pupil and a subject and no class, so the class is resolved
    from the pupil here — the only point that has it. Without this a teacher
    could save a mark in any subject by calling the endpoint directly, whatever
    the sheet showed them.
    """
    if actor["scope"]["unrestricted"]:
        return True
    row = db.one("SELECT current_class_id FROM students WHERE id = %s", (student_id,))
    if not row or not row["current_class_id"]:
        return False
    return scope_lib.can_access_subject(actor["scope"], row["current_class_id"], subject_id)


def subjects_for_class(db, actor, class_id):
    """The subjects in a class, narrowed to the ones this account may touch."""
    rows = db.all("""
      SELECT s.id, s.name, s.code FROM class_subjects cs
        JOIN subjects s ON s.id = cs.subject_id
       WHERE cs.class_group_id = %s AND s.is_active = 1
       ORDER BY s.name""", (class_id,))
    allowed = scope_lib.visible_subject_ids(db, actor["scope"], class_id)
    if allowed is not None:
        rows = [r for r in rows if r["id"] in allowed]
    return {"ok": True, "subjects": rows}


def score_sheet(db, actor, class_id, subject_id, term_id=None):
    if not scope_lib.can_access_subject(actor["scope"], class_id, subject_id):
        return {"ok": False, "status": 403, "error": "That subject is not one of yours in this class."}
    term = (db.one("SELECT * FROM terms WHERE id = %s", (term_id,)) if term_id
            else db.one("SELECT * FROM terms WHERE is_current = 1"))
    if not term:
        return {"ok": False, "status": 400, "error": "There is no current term."}

    rows = db.all("""
      SELECT s.id, s.index_number, s.surname, s.first_name,
             sc.class_score, sc.exam_score, sc.total_score, sc.grade_remark
        FROM students s
        LEFT JOIN scores sc ON sc.student_id = s.id AND sc.term_id = %s AND sc.subject_id = %s
       WHERE s.current_class_id = %s AND s.status = 'Active'
       ORDER BY s.surname, s.first_name""", (term["id"], subject_id, class_id))
    for r in rows:
        r["name"] = f"{r.get('surname') or ''} {r.get('first_name') or ''}".strip()
    return {
        "ok": True, "term": {"id": term["id"], "label": term["label"]},
        "weights": weights(db), "students": rows,
        "may_edit": security.can(actor, "academics", "edit"),
    }


def save_marks(db, actor, subject_id, marks, term_id=None):
    """Save raw exam marks (0–100) for a subject.

    Each mark is checked against the pupil's own class, so a batch containing
    one pupil outside this teacher's scope is refused WHOLE rather than partly
    applied — a half-saved sheet is worse than a refused one, because nobody
    can tell which half.
    """
    term = (db.one("SELECT id FROM terms WHERE id = %s", (term_id,)) if term_id
            else db.one("SELECT id FROM terms WHERE is_current = 1"))
    if not term:
        return {"ok": False, "status": 400, "error": "There is no current term."}
    marks = marks or []
    if not marks:
        return {"ok": False, "status": 400, "error": "Nothing to save."}

    for m in marks:
        sid = m.get("student_id") or m.get("id")
        if not _may_write_mark(db, actor, sid, subject_id):
            return {"ok": False, "status": 403,
                    "error": "That sheet contains a pupil in a class that is not yours."}
        score = m.get("exam_score", m.get("score"))
        if score is not None and not (0 <= float(score) <= 100):
            return {"ok": False, "status": 400, "error": "A mark is out of 100."}

    w = weights(db)
    bands = grading_bands(db)
    saved = 0
    with db.tx() as tx:
        for m in marks:
            sid = int(m.get("student_id") or m.get("id"))
            score = m.get("exam_score", m.get("score"))
            tx.run("""
              INSERT INTO scores (student_id, term_id, subject_id, exam_score)
                   VALUES (%s,%s,%s,%s)
              ON CONFLICT (student_id, term_id, subject_id)
              DO UPDATE SET exam_score = EXCLUDED.exam_score""",
                   (sid, term["id"], subject_id, float(score or 0)))
            _recompute_total(tx, sid, subject_id, term["id"], w, bands)
            saved += 1

    security.audit(db, actor, "scores", subject_id, "save_marks",
                   f'{saved} marks, subject {subject_id}, term {term["id"]}')
    return {"ok": True, "saved": saved}


def _recompute_total(tx, student_id, subject_id, term_id, w, bands):
    row = tx.one("""SELECT class_score, exam_score FROM scores
                     WHERE student_id = %s AND term_id = %s AND subject_id = %s""",
                 (student_id, term_id, subject_id))
    if not row:
        return
    exam_converted = _r2(((row["exam_score"] or 0) / 100) * w["exam"])
    total = _r2((row["class_score"] or 0) + exam_converted)
    tx.run("""UPDATE scores SET total_score = %s, grade_remark = %s
               WHERE student_id = %s AND term_id = %s AND subject_id = %s""",
           (total, _remark(bands, total), student_id, term_id, subject_id))


# ── continuous assessment ───────────────────────────────────────────────────

def assessment_sheet(db, actor, class_id, subject_id, term_id=None):
    if not scope_lib.can_access_subject(actor["scope"], class_id, subject_id):
        return {"ok": False, "status": 403, "error": "That subject is not one of yours in this class."}
    term = (db.one("SELECT * FROM terms WHERE id = %s", (term_id,)) if term_id
            else db.one("SELECT * FROM terms WHERE is_current = 1"))
    if not term:
        return {"ok": False, "status": 400, "error": "There is no current term."}

    columns = db.all("""
      SELECT id, assessment_type, max_marks, display_order FROM assessment_columns
       WHERE class_group_id = %s AND subject_id = %s AND term_id = %s
       ORDER BY display_order, id""", (class_id, subject_id, term["id"]))
    pupils = db.all("""
      SELECT id, index_number, surname, first_name FROM students
       WHERE current_class_id = %s AND status = 'Active' ORDER BY surname, first_name""",
                    (class_id,))
    scores = db.all("""
      SELECT a.assessment_column_id, a.student_id, a.marks
        FROM assessment_scores a
        JOIN assessment_columns c ON c.id = a.assessment_column_id
       WHERE c.class_group_id = %s AND c.subject_id = %s AND c.term_id = %s""",
                    (class_id, subject_id, term["id"]))
    by_student = {}
    for s in scores:
        by_student.setdefault(s["student_id"], {})[s["assessment_column_id"]] = s["marks"]

    for p in pupils:
        p["name"] = f"{p.get('surname') or ''} {p.get('first_name') or ''}".strip()
        p["marks"] = by_student.get(p["id"], {})
    return {
        "ok": True, "term": {"id": term["id"], "label": term["label"]},
        "columns": columns, "students": pupils,
        "may_edit": security.can(actor, "academics", "edit"),
    }


def add_assessment_column(db, actor, class_id, subject_id, assessment_type, max_marks, term_id=None):
    if not scope_lib.can_access_subject(actor["scope"], class_id, subject_id):
        return {"ok": False, "status": 403, "error": "That subject is not one of yours in this class."}
    term = (db.one("SELECT id FROM terms WHERE id = %s", (term_id,)) if term_id
            else db.one("SELECT id FROM terms WHERE is_current = 1"))
    if not term:
        return {"ok": False, "status": 400, "error": "There is no current term."}
    try:
        max_marks = float(max_marks)
    except (TypeError, ValueError):
        max_marks = 0
    if max_marks <= 0:
        return {"ok": False, "status": 400, "error": "A column needs a mark it is out of."}
    n = db.value("""SELECT COALESCE(MAX(display_order), 0) FROM assessment_columns
                     WHERE class_group_id = %s AND subject_id = %s AND term_id = %s""",
                 (class_id, subject_id, term["id"]), 0)
    col_id = db.insert("assessment_columns", {
        "class_group_id": class_id, "subject_id": subject_id, "term_id": term["id"],
        "assessment_type": str(assessment_type or "Assignment")[:60],
        "max_marks": max_marks, "display_order": (n or 0) + 1,
    })
    security.audit(db, actor, "assessment_column", col_id, "add_assessment_column",
                   f"{assessment_type} out of {max_marks}")
    return {"ok": True, "id": col_id}


def save_assessments(db, actor, class_id, subject_id, marks, term_id=None):
    """Save continuous-assessment marks and recompute the class score.

    The class score is the whole set of columns scaled to the class weight, so
    it is recomputed from all of them rather than adjusted — which is what
    keeps it right when a column is added or its maximum changes.
    """
    if not scope_lib.can_access_subject(actor["scope"], class_id, subject_id):
        return {"ok": False, "status": 403, "error": "That subject is not one of yours in this class."}
    term = (db.one("SELECT id FROM terms WHERE id = %s", (term_id,)) if term_id
            else db.one("SELECT id FROM terms WHERE is_current = 1"))
    if not term:
        return {"ok": False, "status": 400, "error": "There is no current term."}

    columns = {c["id"]: c for c in db.all("""
      SELECT id, max_marks FROM assessment_columns
       WHERE class_group_id = %s AND subject_id = %s AND term_id = %s""",
                                          (class_id, subject_id, term["id"]))}
    if not columns:
        return {"ok": False, "status": 400, "error": "Add a column before entering marks."}

    w = weights(db)
    bands = grading_bands(db)
    touched, saved = set(), 0
    with db.tx() as tx:
        for m in marks or []:
            col_id = m.get("column_id") or m.get("assessment_column_id")
            sid = m.get("student_id")
            if col_id not in columns or not sid:
                continue
            value = m.get("marks")
            if value is not None and float(value) > columns[col_id]["max_marks"]:
                return {"ok": False, "status": 400,
                        "error": f'A mark is above the {columns[col_id]["max_marks"]} the column is out of.'}
            tx.run("""
              INSERT INTO assessment_scores (assessment_column_id, student_id, marks)
                   VALUES (%s,%s,%s)
              ON CONFLICT (assessment_column_id, student_id)
              DO UPDATE SET marks = EXCLUDED.marks""",
                   (col_id, sid, None if value is None else float(value)))
            touched.add(sid)
            saved += 1

        total_max = sum(c["max_marks"] or 0 for c in columns.values())
        for sid in touched:
            raw = tx.one("""
              SELECT COALESCE(SUM(a.marks), 0) AS t FROM assessment_scores a
               WHERE a.student_id = %s AND a.assessment_column_id = ANY(%s)""",
                         (sid, list(columns.keys())))["t"]
            class_score = _r2((raw / total_max) * w["class"]) if total_max else 0
            tx.run("""
              INSERT INTO scores (student_id, term_id, subject_id, class_score)
                   VALUES (%s,%s,%s,%s)
              ON CONFLICT (student_id, term_id, subject_id)
              DO UPDATE SET class_score = EXCLUDED.class_score""",
                   (sid, term["id"], subject_id, class_score))
            _recompute_total(tx, sid, subject_id, term["id"], w, bands)

    security.audit(db, actor, "assessment_scores", subject_id, "save_assessments",
                   f"{saved} marks across {len(touched)} pupils")
    return {"ok": True, "saved": saved}


# ── results ─────────────────────────────────────────────────────────────────

def broadsheet(db, actor, class_id, term_id=None):
    """Every pupil in the class against every subject, with positions.

    Positions are computed here rather than stored, so adding a late mark
    reorders the class rather than leaving a stale position on a report card.
    """
    if not scope_lib.can_access_class(actor["scope"], class_id):
        return {"ok": False, "status": 403, "error": "That is not one of your classes."}
    term = (db.one("SELECT * FROM terms WHERE id = %s", (term_id,)) if term_id
            else db.one("SELECT * FROM terms WHERE is_current = 1"))
    if not term:
        return {"ok": False, "status": 400, "error": "There is no current term."}

    subjects = db.all("""
      SELECT s.id, s.name, s.code FROM class_subjects cs JOIN subjects s ON s.id = cs.subject_id
       WHERE cs.class_group_id = %s AND s.is_active = 1 ORDER BY s.name""", (class_id,))
    pupils = db.all("""
      SELECT id, index_number, surname, first_name FROM students
       WHERE current_class_id = %s AND status = 'Active' ORDER BY surname, first_name""",
                    (class_id,))
    scores = db.all("""
      SELECT sc.student_id, sc.subject_id, sc.class_score, sc.exam_score,
             sc.total_score, sc.grade_remark
        FROM scores sc JOIN students s ON s.id = sc.student_id
       WHERE s.current_class_id = %s AND sc.term_id = %s""", (class_id, term["id"]))
    by_student = {}
    for s in scores:
        by_student.setdefault(s["student_id"], {})[s["subject_id"]] = s

    rows = []
    for p in pupils:
        marks = by_student.get(p["id"], {})
        totals = [m["total_score"] for m in marks.values() if m["total_score"] is not None]
        rows.append({
            "student_id": p["id"], "index_number": p["index_number"],
            "name": f"{p.get('surname') or ''} {p.get('first_name') or ''}".strip(),
            "subjects": {str(k): v for k, v in marks.items()},
            "total": _r2(sum(totals)), "subjects_marked": len(totals),
            "average": _r2(sum(totals) / len(totals)) if totals else None,
        })

    ranked = sorted([r for r in rows if r["subjects_marked"]], key=lambda r: -r["total"])
    for i, r in enumerate(ranked, start=1):
        r["position"] = i
    return {
        "ok": True, "term": {"id": term["id"], "label": term["label"]},
        "subjects": subjects, "students": rows, "class_size": len(pupils),
        "bands": grading_bands(db),
    }


def student_report(db, actor, student_id, term_id=None):
    """One pupil's terminal report: every subject, the position, the remarks."""
    if not scope_lib.can_access_student(db, actor["scope"], student_id):
        return {"ok": False, "status": 404, "error": "That pupil is not on the roll."}
    student = db.one("""
      SELECT s.id, s.index_number, s.surname, s.first_name, s.other_names, s.current_class_id,
             c.name AS class_name
        FROM students s LEFT JOIN class_groups c ON c.id = s.current_class_id
       WHERE s.id = %s""", (student_id,))
    if not student:
        return {"ok": False, "status": 404, "error": "That pupil is not on the roll."}

    sheet = broadsheet(db, actor, student["current_class_id"], term_id)
    if not sheet.get("ok"):
        return sheet
    mine = next((r for r in sheet["students"] if r["student_id"] == student_id), None)

    summary = db.one("""
      SELECT * FROM student_term_summary WHERE student_id = %s AND term_id = %s""",
                     (student_id, sheet["term"]["id"]))
    attendance = db.one("""
      SELECT count(*) FILTER (WHERE status = 'present') AS present,
             count(*) FILTER (WHERE status = 'absent') AS absent, count(*) AS marked
        FROM student_attendance WHERE student_id = %s AND term_id = %s""",
                        (student_id, sheet["term"]["id"]))

    student["name"] = f"{student.get('surname') or ''} {student.get('first_name') or ''}".strip()
    return {
        "ok": True, "student": student, "term": sheet["term"],
        "subjects": sheet["subjects"], "result": mine,
        "class_size": sheet["class_size"], "bands": sheet["bands"],
        "summary": summary, "attendance": attendance,
        "school": {"name": db.get_setting("school_name", "School"),
                   "motto": db.get_setting("school_motto", "")},
    }


def save_remarks(db, actor, student_id, term_id, data):
    """The conduct, attitude and remarks a class teacher writes on a report.

    Deliberately the class teacher's: not everyone who teaches the class writes
    its report cards, and the offline system has always held the same line.
    """
    student = db.one("SELECT current_class_id FROM students WHERE id = %s", (student_id,))
    if not student:
        return {"ok": False, "status": 404, "error": "That pupil is not on the roll."}
    if not scope_lib.is_class_teacher_of(actor["scope"], student["current_class_id"]):
        return {"ok": False, "status": 403,
                "error": "The report card belongs to the class teacher."}

    # The column names are the offline schema's, and the API takes both those
    # and the plainer words a screen would use for them.
    aliases = {"conduct": "conduct_traits", "interests": "learner_interests",
               "talents": "learner_talents", "remark": "teacher_remarks"}
    allowed = {"conduct_traits", "learner_interests", "learner_talents",
               "teacher_remarks", "promoted_to", "days_present", "total_days"}
    fields = {}
    for key, value in (data or {}).items():
        column = aliases.get(key, key)
        if column in allowed:
            fields[column] = value
    if not fields:
        return {"ok": False, "status": 400, "error": "Nothing to save."}

    existing = db.one("SELECT id FROM student_term_summary WHERE student_id = %s AND term_id = %s",
                      (student_id, term_id))
    if existing:
        sets = ", ".join(f'"{k}" = %s' for k in fields)
        db.run(f"UPDATE student_term_summary SET {sets} WHERE id = %s",
               tuple(fields.values()) + (existing["id"],))
        row_id = existing["id"]
    else:
        row_id = db.insert("student_term_summary", {
            "student_id": student_id, "term_id": term_id,
            "class_group_id": student["current_class_id"], **fields,
        })
    security.audit(db, actor, "student_term_summary", row_id, "save_remarks",
                   f"Pupil {student_id}, term {term_id}")
    return {"ok": True, "id": row_id}
