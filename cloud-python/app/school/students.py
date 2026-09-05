"""Pupils — a translation of ``electron/ipc/students.js``.

The roll, a pupil's record, admitting one, moving one, and the register.

Two things travel with every read and are the reason this is not a thin CRUD
layer over a table:

  * SCOPE. A teacher sees the classes they are assigned to and no others
    (app/school/scope.py). The filter goes into the SQL, not into a list
    comprehension after the LIMIT, so a teacher of one class is not handed the
    first five hundred pupils in the school and then shown four.
  * AGE is computed from the date of birth rather than read from the stored
    column, because a stored age is wrong within a year of being written.

Writes are audited. On the desktop the guard does that for every channel; here
each write says so itself, because there is no guard between an HTTP request
and this module — the router calls it directly and the permission is checked
before it does.
"""
import datetime

from . import idgen, media, scope as scope_lib, security

STATUSES = ["Active", "Withdrawn", "Graduated", "Suspended", "Transferred"]

# The columns an update may touch. A whitelist, not "everything the client
# sent": `id`, `index_number`, `roll_number` and `admission_year` identify the
# pupil across every document the school has printed, and are not editable by
# an ordinary update.
EDITABLE = [
    "surname", "first_name", "other_names", "gender", "denomination", "date_of_birth",
    "age", "place_of_birth", "place_of_residence", "street_address", "house_number",
    "digital_address", "nhis_number", "father_name", "father_contact", "father_email",
    "mother_name", "mother_contact", "mother_email", "guardian_name", "guardian_contact",
    "guardian_email", "current_class_id", "status", "inactive_reason", "admission_date", "notes",
]

# The live age, computed. Postgres has no julianday, so the arithmetic is
# written the Postgres way and gives the same answer.
_AGE_SQL = """
  CASE WHEN s.date_of_birth IS NOT NULL AND s.date_of_birth <> ''
       THEN EXTRACT(YEAR FROM age(to_date(s.date_of_birth, 'YYYY-MM-DD')))::int
       ELSE s.age END AS computed_age
"""


def _today():
    return datetime.date.today().isoformat()


def _scoped_class_ids(db, actor):
    """The classes this account may see, or None for no restriction.

    The office is not narrowed by the teaching scope: a bursar has no
    assignments, and filtering the roll by them left them with nobody to bill.
    See ``scope.office_scope`` — the register and the mark sheet keep the
    strict scope, and this is the roll.
    """
    return scope_lib.visible_class_ids(
        db, scope_lib.office_scope(actor["scope"], actor, security.can))


def listing(db, actor, class_id=None, status="Active", gender=None, search=None, limit=500):
    sql = f"""
      SELECT s.id, s.index_number, s.surname, s.first_name, s.other_names, s.gender,
             s.date_of_birth, s.status, s.admission_date, s.current_class_id,
             s.photo_path IS NOT NULL AND s.photo_path <> '' AS has_photo,
             c.name AS class_name, c.short_code AS class_short, c.level_order,
             {_AGE_SQL}
        FROM students s LEFT JOIN class_groups c ON c.id = s.current_class_id
       WHERE 1=1
    """
    params = []
    if class_id:
        sql += " AND s.current_class_id = %s"
        params.append(class_id)
    if status:
        sql += " AND s.status = %s"
        params.append(status)
    if gender:
        sql += " AND s.gender = %s"
        params.append(gender)
    if search:
        sql += (" AND (s.surname ILIKE %s OR s.first_name ILIKE %s"
                " OR s.other_names ILIKE %s OR s.index_number ILIKE %s)")
        like = f"%{str(search)[:60]}%"
        params += [like, like, like, like]

    only = _scoped_class_ids(db, actor)
    if only is not None:
        if not only:
            return {"ok": True, "students": []}
        sql += " AND s.current_class_id = ANY(%s)"
        params.append(list(only))

    sql += " ORDER BY c.level_order, s.surname, s.first_name LIMIT %s"
    params.append(min(int(limit or 500), 2000))

    rows = db.all(sql, tuple(params))
    for r in rows:
        r["age"] = r.pop("computed_age")
        r["name"] = f"{r.get('surname') or ''} {r.get('first_name') or ''}".strip()
    return {"ok": True, "students": rows}


def get(db, actor, student_id):
    student = db.one(f"""
      SELECT s.*, c.name AS class_name, c.short_code AS class_short, {_AGE_SQL}
        FROM students s LEFT JOIN class_groups c ON c.id = s.current_class_id
       WHERE s.id = %s""", (student_id,))
    if not student:
        return {"ok": False, "status": 404, "error": "That pupil is not on the roll."}
    if not scope_lib.can_access_student(db, actor["scope"], student_id):
        # The same answer as a pupil who does not exist. Telling somebody a
        # record exists but is not theirs is telling them something.
        return {"ok": False, "status": 404, "error": "That pupil is not on the roll."}

    student["age"] = student.pop("computed_age")
    student["name"] = f"{student.get('surname') or ''} {student.get('first_name') or ''}".strip()
    # Offline this column holds a path on the office PC, which is no use to a
    # browser; online it holds the picture. Either way the row never leaves
    # here carrying a place on somebody's disk.
    student["photo"] = media.as_data_uri(student.pop("photo_path", None))
    student["history"] = db.all("""
      SELECT h.*, c.name AS class_name, ay.label AS year_label
        FROM student_class_history h
        JOIN class_groups c ON c.id = h.class_group_id
        JOIN academic_years ay ON ay.id = h.academic_year_id
       WHERE h.student_id = %s ORDER BY h.enrolled_date DESC""", (student_id,))
    student["events"] = db.all("""
      SELECT id, event_type, title, description, date, recorded_by
        FROM student_events WHERE student_id = %s ORDER BY date DESC, id DESC LIMIT 50""",
                              (student_id,))
    return {"ok": True, "student": student}


def create(db, actor, data):
    """Admit a pupil.

    The index number policy is the offline system's, unchanged: an index number
    supplied by the caller is honoured EXACTLY and the roll counter is left
    alone, because a number that came off an import sheet or a paper register
    is the school's and not ours to renumber. Only when none is supplied is one
    allocated, and then the counter advances.
    """
    surname = str(data.get("surname") or "").strip()
    first_name = str(data.get("first_name") or data.get("firstName") or "").strip()
    if not surname or not first_name:
        return {"ok": False, "status": 400, "error": "A surname and a first name are required."}

    class_id = data.get("current_class_id") or data.get("classId")
    class_row = db.one("SELECT id, short_code FROM class_groups WHERE id = %s", (class_id,)) if class_id else None
    if class_id and not class_row:
        return {"ok": False, "status": 400, "error": "That class does not exist."}

    supplied = str(data.get("index_number") or data.get("indexNumber") or "").strip()
    if supplied and db.one("SELECT id FROM students WHERE index_number = %s", (supplied,)):
        return {"ok": False, "status": 400,
                "error": f'Index number "{supplied}" is already used by another pupil.'}

    year_row = db.one("SELECT label FROM academic_years WHERE is_current = 1 ORDER BY id DESC LIMIT 1")
    current_year = datetime.date.today().year
    if year_row and year_row["label"]:
        import re
        m = re.search(r"(\d{4})", str(year_row["label"]))
        if m:
            # The LATER year of "2025/2026" is this year for a new admission.
            current_year = int(m.group(1)) + 1

    admission_year = data.get("admission_year") or idgen.admission_year(
        (class_row or {}).get("short_code"), current_year)
    roll_number = data.get("roll_number")
    index_number = supplied or None

    if index_number:
        parsed = idgen.parse_index_number(index_number)
        if parsed:
            admission_year = parsed["year"]
    else:
        roll_number = idgen.next_roll_number(db)
        index_number = idgen.format_index_number(idgen.school_abbreviation(db), admission_year, roll_number)
        idgen.set_next_roll_number(db, roll_number + 1)

    row = {
        "index_number": index_number, "admission_year": admission_year, "roll_number": roll_number,
        "surname": surname, "first_name": first_name,
        "other_names": data.get("other_names") or "", "gender": data.get("gender") or "",
        "denomination": data.get("denomination") or "", "age": data.get("age"),
        "date_of_birth": data.get("date_of_birth"),
        "place_of_birth": data.get("place_of_birth") or "",
        "place_of_residence": data.get("place_of_residence") or "",
        "street_address": data.get("street_address") or "",
        "house_number": data.get("house_number") or "",
        "digital_address": data.get("digital_address") or "",
        "nhis_number": data.get("nhis_number") or "",
        "father_name": data.get("father_name") or "", "father_contact": data.get("father_contact") or "",
        "mother_name": data.get("mother_name") or "", "mother_contact": data.get("mother_contact") or "",
        "guardian_name": data.get("guardian_name") or "", "guardian_contact": data.get("guardian_contact") or "",
        "current_class_id": class_id, "status": data.get("status") or "Active",
        "admission_date": data.get("admission_date") or _today(),
        "notes": data.get("notes") or "",
    }
    try:
        student_id = db.insert("students", row)
    except Exception as e:
        return {"ok": False, "status": 400, "error": f"That pupil could not be admitted: {e}"}

    # The class history is what a leaving certificate is built from years later.
    if class_id:
        year = db.one("SELECT id FROM academic_years WHERE is_current = 1 ORDER BY id DESC LIMIT 1")
        if year:
            db.run("""INSERT INTO student_class_history (student_id, class_group_id, academic_year_id, enrolled_date)
                        VALUES (%s, %s, %s, %s)""",
                   (student_id, class_id, year["id"], row["admission_date"]))

    security.audit(db, actor, "student", student_id, "admit_student",
                   f'{surname} {first_name} ({index_number})')
    return {"ok": True, "id": student_id, "index_number": index_number}


def update(db, actor, student_id, data):
    existing = db.one("SELECT id, surname, first_name, current_class_id FROM students WHERE id = %s",
                      (student_id,))
    if not existing:
        return {"ok": False, "status": 404, "error": "That pupil is not on the roll."}
    if not scope_lib.can_access_student(db, actor["scope"], student_id):
        return {"ok": False, "status": 404, "error": "That pupil is not on the roll."}

    patch = {k: data[k] for k in EDITABLE if k in data}
    if not patch:
        return {"ok": False, "status": 400, "error": "Nothing to change."}

    if "current_class_id" in patch and patch["current_class_id"] != existing["current_class_id"]:
        if not db.one("SELECT id FROM class_groups WHERE id = %s", (patch["current_class_id"],)):
            return {"ok": False, "status": 400, "error": "That class does not exist."}

    sets = ", ".join(f'"{k}" = %s' for k in patch)
    db.run(f"UPDATE students SET {sets}, updated_at = %s WHERE id = %s",
           tuple(patch.values()) + (datetime.datetime.now(datetime.timezone.utc)
                                    .strftime("%Y-%m-%d %H:%M:%S"), student_id))
    security.audit(db, actor, "student", student_id, "update_student",
                   f'{existing["surname"]} {existing["first_name"]}: ' + ", ".join(patch.keys()))
    return {"ok": True}


def set_status(db, actor, student_id, status, reason=""):
    """Withdrawing, graduating, suspending or readmitting.

    A status change is what a parent notices first — the app stops showing
    their child — so anything but a return to Active needs a reason, and the
    audit row is written at high severity.
    """
    if status not in STATUSES:
        return {"ok": False, "status": 400, "error": "That is not a status a pupil can be put into."}
    reason = str(reason or "").strip()
    if status != "Active" and len(reason) < 3:
        return {"ok": False, "status": 400, "error": "Give the reason."}
    student = db.one("SELECT id, surname, first_name, status FROM students WHERE id = %s", (student_id,))
    if not student:
        return {"ok": False, "status": 404, "error": "That pupil is not on the roll."}

    db.run("UPDATE students SET status = %s, inactive_reason = %s WHERE id = %s",
           (status, reason or None, student_id))
    security.audit(db, actor, "student", student_id, "student_status",
                   f'{student["surname"]} {student["first_name"]}: {student["status"]} → {status}'
                   + (f" ({reason})" if reason else ""),
                   "normal" if status == "Active" else "high")
    return {"ok": True}


# ── the register ────────────────────────────────────────────────────────────
# A translation of electron/ipc/students_attendance.js. One row per pupil per
# day, upserted — which is what makes marking a register twice harmless.

def attendance_sheet(db, actor, class_id, date):
    if not scope_lib.can_access_class(actor["scope"], class_id):
        return {"ok": False, "status": 403, "error": "That is not one of your classes."}
    date = str(date or _today())[:10]
    rows = db.all("""
      SELECT s.id, s.index_number, s.surname, s.first_name, s.other_names,
             a.status, a.notes
        FROM students s
        LEFT JOIN student_attendance a ON a.student_id = s.id AND a.date = %s
       WHERE s.current_class_id = %s AND s.status = 'Active'
       ORDER BY s.surname, s.first_name""", (date, class_id))
    for r in rows:
        r["name"] = f"{r.get('surname') or ''} {r.get('first_name') or ''}".strip()
    return {
        "ok": True, "date": date, "class_id": class_id,
        "students": rows,
        "marked": sum(1 for r in rows if r["status"]),
    }


# The marks that carry a written reason. Late is one of them: a child who
# arrives at nine has a story, and it used to be thrown away because they
# eventually turned up. Mirrors electron/ipc/_attendance.js.
_REASON_MARKS = {"absent", "late", "excused"}


def _reason_for(status, notes):
    if status not in _REASON_MARKS:
        return None
    given = (notes or "").strip()
    return given or None


def mark_attendance(db, actor, class_id, date, marks):
    """Mark a register.

    Naturally idempotent — one row per (student, date), upserted — so a phone
    that submitted and lost the reply can submit again without doubling
    anything. The class is checked against the teacher's scope, and every pupil
    named is checked against the class, so a mark cannot be posted against a
    child in somebody else's room.
    """
    if not scope_lib.can_access_class(actor["scope"], class_id):
        return {"ok": False, "status": 403, "error": "That is not one of your classes."}
    date = str(date or _today())[:10]
    marks = marks or []
    if not marks:
        return {"ok": False, "status": 400, "error": "Nothing to mark."}

    term = db.one("SELECT id FROM terms WHERE is_current = 1")
    term_id = term["id"] if term else None
    in_class = {r["id"] for r in db.all(
        "SELECT id FROM students WHERE current_class_id = %s AND status = 'Active'", (class_id,))}

    written = 0
    with db.tx() as tx:
        for m in marks:
            sid = m.get("student_id") or m.get("id")
            try:
                sid = int(sid)
            except (TypeError, ValueError):
                continue
            if sid not in in_class:
                continue
            status = m.get("status") or "present"
            tx.run("""
              INSERT INTO student_attendance (student_id, date, status, marked_by, term_id, notes)
                   VALUES (%s, %s, %s, %s, %s, %s)
              ON CONFLICT (student_id, date) DO UPDATE
                 SET status = EXCLUDED.status, marked_by = EXCLUDED.marked_by,
                     notes = EXCLUDED.notes""",
                   (sid, date, status, actor["user_id"], term_id,
                    _reason_for(status, m.get("notes"))))
            written += 1

    security.audit(db, actor, "attendance", class_id, "mark_attendance",
                   f"{written} pupils on {date}")
    return {"ok": True, "marked": written, "date": date}


def attendance_history(db, actor, class_id, days=30):
    if not scope_lib.can_access_class(actor["scope"], class_id):
        return {"ok": False, "status": 403, "error": "That is not one of your classes."}
    days = max(1, min(int(days or 30), 90))
    rows = db.all("""
      SELECT a.date,
             count(*) FILTER (WHERE a.status = 'present') AS present,
             count(*) FILTER (WHERE a.status = 'absent') AS absent,
             count(*) AS marked
        FROM student_attendance a JOIN students s ON s.id = a.student_id
       WHERE s.current_class_id = %s
         AND to_date(a.date, 'YYYY-MM-DD') >= current_date - %s
       GROUP BY a.date ORDER BY a.date DESC""", (class_id, days))
    return {"ok": True, "days": rows}


def add_event(db, actor, student_id, event_type, title, description=None, date=None):
    """A commendation or an incident. The desktop has kept this per pupil since
    the first release; a teacher records it and a parent sees the same list."""
    if not scope_lib.can_access_student(db, actor["scope"], student_id):
        return {"ok": False, "status": 403, "error": "That pupil is not in one of your classes."}
    title = str(title or "").strip()
    if not title:
        return {"ok": False, "status": 400, "error": "Say what happened."}
    event_id = db.insert("student_events", {
        "student_id": student_id,
        "event_type": event_type if event_type in ("commendation", "incident") else "incident",
        "title": title[:200], "description": str(description or "")[:2000],
        "date": str(date or _today())[:10], "recorded_by": actor["user_id"],
    })
    security.audit(db, actor, "student_event", event_id, "record_event", title)
    return {"ok": True, "id": event_id}
