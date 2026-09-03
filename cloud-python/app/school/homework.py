"""Homework — a translation of ``electron/ipc/homework.js``.

Set, seen and marked. Marking is the part that matters: a graded assignment
does not sit in its own corner, it pushes its marks through the SAME
continuous-assessment pipeline the class-work sheet uses, so a mark a teacher
gives for homework counts towards the term exactly like every other mark and
does not have to be typed twice.
"""
import datetime

from . import academics, scope as scope_lib, security


def _today():
    return datetime.date.today().isoformat()


def for_class(db, actor, class_id, include_past=False):
    if not scope_lib.can_access_class(actor["scope"], class_id):
        return {"ok": False, "status": 403, "error": "That is not one of your classes."}
    sql = """
      SELECT h.id, h.title, h.description, h.due_date, h.assigned_date, h.max_marks,
             h.status, h.subject_id, s.name AS subject_name,
             TRIM(COALESCE(st.surname,'') || ' ' || COALESCE(st.first_name,'')) AS teacher_name,
             (SELECT count(*) FROM homework_submissions hs WHERE hs.homework_id = h.id) AS submissions
        FROM homework h
        LEFT JOIN subjects s ON s.id = h.subject_id
        LEFT JOIN staff st ON st.id = h.teacher_id
       WHERE h.class_group_id = %s
    """
    params = [class_id]
    if not include_past:
        sql += " AND (h.due_date IS NULL OR h.due_date >= %s)"
        params.append(_today())
    sql += " ORDER BY h.due_date DESC NULLS LAST, h.id DESC LIMIT 100"
    return {"ok": True, "homework": db.all(sql, tuple(params)),
            "may_set": security.can(actor, "academics", "edit")}


def set_homework(db, actor, data):
    class_id = data.get("class_group_id") or data.get("classId")
    subject_id = data.get("subject_id") or data.get("subjectId")
    if not scope_lib.can_access_subject(actor["scope"], class_id, subject_id):
        return {"ok": False, "status": 403, "error": "That subject is not one of yours in this class."}
    title = str(data.get("title") or "").strip()
    if not title:
        return {"ok": False, "status": 400, "error": "Give the homework a title."}

    term = db.one("SELECT id FROM terms WHERE is_current = 1")
    max_marks = data.get("max_marks") or data.get("maxMarks")
    homework_id = db.insert("homework", {
        "class_group_id": class_id, "subject_id": subject_id,
        "teacher_id": actor.get("staff_id"), "title": title[:200],
        "description": str(data.get("description") or "")[:4000],
        "due_date": data.get("due_date") or data.get("dueDate"),
        "assigned_date": data.get("assigned_date") or _today(),
        "term_id": term["id"] if term else None,
        "max_marks": float(max_marks) if max_marks else None,
        "status": "active",
    })
    security.audit(db, actor, "homework", homework_id, "set_homework", title)
    return {"ok": True, "id": homework_id}


def sheet(db, actor, homework_id):
    hw = db.one("""SELECT h.*, c.name AS class_name, s.name AS subject_name
                     FROM homework h
                     LEFT JOIN class_groups c ON c.id = h.class_group_id
                     LEFT JOIN subjects s ON s.id = h.subject_id
                    WHERE h.id = %s""", (homework_id,))
    if not hw:
        return {"ok": False, "status": 404, "error": "No such homework."}
    if not scope_lib.can_access_class(actor["scope"], hw["class_group_id"]):
        return {"ok": False, "status": 404, "error": "No such homework."}
    rows = db.all("""
      SELECT s.id AS student_id, s.index_number, s.surname, s.first_name,
             hs.status, hs.marks, hs.remarks, hs.submitted_at
        FROM students s
        LEFT JOIN homework_submissions hs ON hs.student_id = s.id AND hs.homework_id = %s
       WHERE s.current_class_id = %s AND s.status = 'Active'
       ORDER BY s.surname, s.first_name""", (homework_id, hw["class_group_id"]))
    for r in rows:
        r["name"] = f"{r.get('surname') or ''} {r.get('first_name') or ''}".strip()
    return {"ok": True, "homework": hw, "students": rows,
            "may_mark": security.can(actor, "academics", "edit")}


def mark(db, actor, homework_id, entries):
    """Record who did it and what they got.

    When the homework carries a maximum mark it becomes an assessment column,
    once, and the marks flow into the class score through the same code the
    class-work sheet uses. A teacher marks in one place and it counts.
    """
    hw = db.one("SELECT * FROM homework WHERE id = %s", (homework_id,))
    if not hw:
        return {"ok": False, "status": 404, "error": "No such homework."}
    if not scope_lib.can_access_subject(actor["scope"], hw["class_group_id"], hw["subject_id"]):
        return {"ok": False, "status": 403, "error": "That is not one of your classes."}

    column_id = hw.get("assessment_column_id")
    if hw.get("max_marks") and not column_id:
        made = academics.add_assessment_column(
            db, actor, hw["class_group_id"], hw["subject_id"], "Homework",
            hw["max_marks"], hw.get("term_id"))
        if made.get("ok"):
            column_id = made["id"]
            db.run("UPDATE homework SET assessment_column_id = %s WHERE id = %s",
                   (column_id, homework_id))

    saved = 0
    with db.tx() as tx:
        for e in entries or []:
            sid = e.get("student_id")
            if not sid:
                continue
            tx.run("""
              INSERT INTO homework_submissions (homework_id, student_id, status, marks, remarks, marked_at)
                   VALUES (%s,%s,%s,%s,%s,
                           to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
              ON CONFLICT (homework_id, student_id) DO UPDATE
                 SET status = EXCLUDED.status, marks = EXCLUDED.marks,
                     remarks = EXCLUDED.remarks, marked_at = EXCLUDED.marked_at""",
                   (homework_id, sid, e.get("status") or "submitted",
                    e.get("marks"), e.get("remarks")))
            saved += 1

    if column_id:
        academics.save_assessments(
            db, actor, hw["class_group_id"], hw["subject_id"],
            [{"column_id": column_id, "student_id": e.get("student_id"), "marks": e.get("marks")}
             for e in entries or [] if e.get("student_id")],
            hw.get("term_id"))

    security.audit(db, actor, "homework", homework_id, "mark_homework", f"{saved} pupil(s)")
    return {"ok": True, "marked": saved, "counted_towards_class_score": bool(column_id)}
