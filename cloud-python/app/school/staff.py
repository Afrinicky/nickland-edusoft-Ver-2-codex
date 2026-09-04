"""Staff and HR — a translation of ``electron/ipc/staff.js``, ``staff_hr.js``
and ``staff_activities.js``.

Records, the staff register, leave, lesson notes and a person's own employment.

One line runs through all of it: a salary is PAYROLL, not staff. Somebody who
may see the staff register — a head teacher, a secretary — is not thereby
entitled to know what everybody earns, so the pay columns are stripped from
every read unless the account also holds ``payroll: view``. The offline system
draws the line in the same place.

And a person always sees their OWN record: their clock-ins, their leave, their
payslips. That is not a permission, it is whose life it is.
"""
import datetime

from . import security
from .billing import round2

PAY_COLUMNS = ["base_salary", "bank_account", "bank_name", "ssnit_number", "ssnit_enrolled"]
LEAVE_TYPES = ["Casual", "Sick", "Maternity", "Paternity", "Study", "Compassionate", "Unpaid"]


def _today():
    return datetime.date.today().isoformat()


def _now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _strip_pay(row, may_see_pay):
    if may_see_pay:
        return row
    for c in PAY_COLUMNS:
        row.pop(c, None)
    return row


def listing(db, actor, status="Active"):
    rows = db.all("""
      SELECT st.id, st.staff_number, st.surname, st.first_name, st.other_names, st.gender,
             st.phone, st.email, st.role, st.status, st.hire_date, st.qualification,
             d.name AS designation,
             (SELECT count(*) FROM staff_assignments sa WHERE sa.staff_id = st.id) AS assignments,
             (SELECT status FROM staff_attendance a WHERE a.staff_id = st.id AND a.date = %s) AS today
        FROM staff st LEFT JOIN designations d ON d.id = st.designation_id
       WHERE st.status = %s ORDER BY st.surname, st.first_name""", (_today(), status))
    for r in rows:
        r["name"] = f"{r.get('surname') or ''} {r.get('first_name') or ''}".strip()
    return {"ok": True, "status": status, "staff": rows,
            "may_edit": security.can(actor, "staff", "edit"),
            "may_add": security.can(actor, "staff", "create"),
            # The designations, with the roll: a form that asks what somebody's
            # job is needs the school's own list of jobs.
            "designations": db.all("SELECT id, name FROM designations ORDER BY name")}


def get(db, actor, staff_id):
    row = db.one("""
      SELECT st.*, d.name AS designation FROM staff st
        LEFT JOIN designations d ON d.id = st.designation_id WHERE st.id = %s""", (staff_id,))
    if not row:
        return {"ok": False, "status": 404, "error": "No such member of staff."}

    may_see_pay = security.can(actor, "payroll", "view") or row["id"] == actor.get("staff_id")
    row.pop("photo_path", None)
    row["name"] = f"{row.get('surname') or ''} {row.get('first_name') or ''}".strip()
    _strip_pay(row, may_see_pay)

    month = datetime.date.today().strftime("%Y-%m")
    return {
        "ok": True, "staff": row, "may_see_pay": may_see_pay,
        "assignments": db.all("""
          SELECT sa.class_group_id, c.name AS class_name, sa.subject_id, s.name AS subject_name,
                 sa.is_class_teacher
            FROM staff_assignments sa
            LEFT JOIN class_groups c ON c.id = sa.class_group_id
            LEFT JOIN subjects s ON s.id = sa.subject_id
           WHERE sa.staff_id = %s""", (staff_id,)),
        "attendance": db.all("""
          SELECT date, status, clock_in, clock_out, notes FROM staff_attendance
           WHERE staff_id = %s AND date LIKE %s ORDER BY date DESC""", (staff_id, f"{month}%")),
        "leave": db.all("""
          SELECT id, leave_type, start_date, end_date, days_requested, status, created_at
            FROM leave_requests WHERE staff_id = %s ORDER BY id DESC LIMIT 20""", (staff_id,)),
    }


def save(db, actor, data):
    """Create or amend a staff record.

    The pay columns are only written by an account that may see them. Without
    that check an account with `staff: edit` and no payroll could set anybody's
    salary — including their own — without ever being able to read it back,
    which is worse than being able to read it.
    """
    fields = ["surname", "first_name", "other_names", "gender", "date_of_birth", "phone",
              "email", "address", "role", "designation_id", "status", "qualification",
              "specialization", "hire_date", "stop_date", "notes", "staff_number"]
    if security.can(actor, "payroll", "edit"):
        fields += PAY_COLUMNS

    patch = {k: data[k] for k in fields if k in data}
    staff_id = data.get("id")

    if not staff_id:
        if not str(patch.get("surname") or "").strip() or not str(patch.get("first_name") or "").strip():
            return {"ok": False, "status": 400, "error": "A surname and a first name are required."}
        patch.setdefault("role", "Teaching")
        patch.setdefault("status", "Active")
        if not patch.get("staff_number"):
            n = db.value("SELECT count(*) FROM staff", (), 0) or 0
            patch["staff_number"] = f"STAFF/{str(n + 1).zfill(4)}"
        if db.one("SELECT id FROM staff WHERE staff_number = %s", (patch["staff_number"],)):
            return {"ok": False, "status": 400, "error": "That staff number is already in use."}
        staff_id = db.insert("staff", patch)
        security.audit(db, actor, "staff", staff_id, "create_staff",
                       f'{patch.get("surname")} {patch.get("first_name")}')
        return {"ok": True, "id": staff_id, "staff_number": patch["staff_number"]}

    if not patch:
        return {"ok": False, "status": 400, "error": "Nothing to change."}
    sets = ", ".join(f'"{k}" = %s' for k in patch)
    db.run(f"UPDATE staff SET {sets} WHERE id = %s", tuple(patch.values()) + (staff_id,))
    security.audit(db, actor, "staff", staff_id, "update_staff", ", ".join(patch.keys()))
    return {"ok": True, "id": staff_id}


def set_assignments(db, actor, staff_id, assignments):
    """Which classes and subjects somebody teaches.

    This is what the teaching scope is built from, so it is the single most
    consequential write in the staff module: it decides whose marks a teacher
    can touch. Replaced wholesale rather than patched, so the stored set always
    matches what the screen showed.
    """
    if not db.one("SELECT id FROM staff WHERE id = %s", (staff_id,)):
        return {"ok": False, "status": 404, "error": "No such member of staff."}
    rows = []
    for a in assignments or []:
        class_id = a.get("class_group_id") or a.get("classId")
        subject_id = a.get("subject_id") or a.get("subjectId")
        if not class_id and not subject_id:
            continue
        rows.append((class_id, subject_id, 1 if a.get("is_class_teacher") else 0))

    with db.tx() as tx:
        tx.run("DELETE FROM staff_assignments WHERE staff_id = %s", (staff_id,))
        for class_id, subject_id, is_ct in rows:
            # One class has one class teacher. Setting a second silently would
            # give two people the register and the report cards.
            if is_ct:
                tx.run("""UPDATE staff_assignments SET is_class_teacher = 0
                           WHERE class_group_id = %s AND is_class_teacher = 1""", (class_id,))
            tx.run("""INSERT INTO staff_assignments (staff_id, class_group_id, subject_id, is_class_teacher)
                        VALUES (%s,%s,%s,%s)""", (staff_id, class_id, subject_id, is_ct))

    security.audit(db, actor, "staff", staff_id, "set_assignments",
                   f"{len(rows)} assignment(s)", "high")
    # Every session that member of staff holds is now resolving a scope that
    # has changed; the next request re-reads it, so nothing needs revoking.
    return {"ok": True, "assignments": len(rows)}


# ── the staff register ──────────────────────────────────────────────────────

def clock(db, actor, direction="in", staff_id=None, date=None):
    """Clock in or out. Your own record unless you may edit staff."""
    target = staff_id or actor.get("staff_id")
    if not target:
        return {"ok": False, "status": 400, "error": "This account has no staff record."}
    if staff_id and staff_id != actor.get("staff_id") and not security.can(actor, "staff", "edit"):
        return {"ok": False, "status": 403, "error": "You may only clock yourself in."}

    date = str(date or _today())[:10]
    now = datetime.datetime.now().strftime("%H:%M")
    if direction == "out":
        db.run("""INSERT INTO staff_attendance (staff_id, date, status, clock_out)
                       VALUES (%s,%s,'present',%s)
                  ON CONFLICT (staff_id, date) DO UPDATE SET clock_out = EXCLUDED.clock_out""",
               (target, date, now))
    else:
        db.run("""INSERT INTO staff_attendance (staff_id, date, status, clock_in)
                       VALUES (%s,%s,'present',%s)
                  ON CONFLICT (staff_id, date)
                  DO UPDATE SET clock_in = COALESCE(staff_attendance.clock_in, EXCLUDED.clock_in),
                                status = 'present'""",
               (target, date, now))
    return {"ok": True, "date": date, "time": now, "direction": direction}


def register(db, actor, date=None):
    date = str(date or _today())[:10]
    rows = db.all("""
      SELECT st.id, st.staff_number, st.surname, st.first_name, st.role,
             a.status, a.clock_in, a.clock_out, a.notes
        FROM staff st LEFT JOIN staff_attendance a ON a.staff_id = st.id AND a.date = %s
       WHERE st.status = 'Active' ORDER BY st.surname, st.first_name""", (date,))
    for r in rows:
        r["name"] = f"{r.get('surname') or ''} {r.get('first_name') or ''}".strip()
    return {"ok": True, "date": date, "staff": rows,
            "present": sum(1 for r in rows if r["status"] == "present"),
            "may_edit": security.can(actor, "staff", "edit")}


# ── leave ───────────────────────────────────────────────────────────────────

def request_leave(db, actor, data):
    """Ask for leave. Yours, so no permission is needed to raise one."""
    staff_id = actor.get("staff_id")
    if not staff_id:
        return {"ok": False, "status": 400, "error": "This account has no staff record."}
    start, end = str(data.get("start_date") or "")[:10], str(data.get("end_date") or "")[:10]
    reason = str(data.get("justification") or data.get("reason") or "").strip()
    if not start or not end:
        return {"ok": False, "status": 400, "error": "Give the dates."}
    if end < start:
        return {"ok": False, "status": 400, "error": "The end date is before the start date."}
    if len(reason) < 3:
        return {"ok": False, "status": 400, "error": "Say why."}
    days = (datetime.date.fromisoformat(end) - datetime.date.fromisoformat(start)).days + 1

    row_id = db.insert("leave_requests", {
        "staff_id": staff_id,
        "leave_type": data.get("leave_type") if data.get("leave_type") in LEAVE_TYPES else "Casual",
        "start_date": start, "end_date": end, "days_requested": days,
        "justification": reason[:1000], "status": "pending",
    })
    security.audit(db, actor, "leave_request", row_id, "request_leave", f"{days} day(s) from {start}")
    return {"ok": True, "id": row_id, "days": days}


def leave_list(db, actor, status="pending"):
    rows = db.all("""
      SELECT lr.*, st.surname, st.first_name, st.staff_number, st.role,
             u.full_name AS reviewed_by_name
        FROM leave_requests lr JOIN staff st ON st.id = lr.staff_id
        LEFT JOIN users u ON u.id = lr.reviewed_by
       WHERE lr.status = %s ORDER BY lr.id DESC LIMIT 200""", (status,))
    for r in rows:
        r["staff_name"] = f"{r.get('surname') or ''} {r.get('first_name') or ''}".strip()
    return {"ok": True, "status": status, "requests": rows,
            "may_decide": security.can(actor, "staff", "edit")}


def decide_leave(db, actor, request_id, decision, notes=None):
    if decision not in ("approved", "rejected"):
        return {"ok": False, "status": 400, "error": "Approve it or reject it."}
    row = db.one("SELECT id, status, staff_id FROM leave_requests WHERE id = %s", (request_id,))
    if not row:
        return {"ok": False, "status": 404, "error": "No such request."}
    if row["status"] != "pending":
        return {"ok": False, "status": 400, "error": f'That request was already {row["status"]}.'}
    # Approving your own leave is not a decision, it is a holiday.
    if row["staff_id"] and row["staff_id"] == actor.get("staff_id"):
        return {"ok": False, "status": 400, "error": "Somebody else has to decide your own leave."}

    db.run("""UPDATE leave_requests SET status = %s, reviewed_by = %s, reviewed_at = %s,
                     reviewer_notes = %s WHERE id = %s""",
           (decision, actor["user_id"], _now(), str(notes or "")[:500] or None, request_id))
    security.audit(db, actor, "leave_request", request_id, f"leave_{decision}", str(notes or ""))
    return {"ok": True}


# ── lesson notes ────────────────────────────────────────────────────────────

def lesson_notes(db, actor, status=None, class_id=None, mine=False):
    sql = """
      SELECT ln.id, ln.topic, ln.sub_topic, ln.week_number, ln.lesson_date, ln.status,
             ln.created_at, ln.updated_at, ln.class_group_id, ln.subject_id,
             c.name AS class_name, s.name AS subject_name,
             TRIM(COALESCE(st.surname,'') || ' ' || COALESCE(st.first_name,'')) AS teacher_name
        FROM lesson_notes ln
        LEFT JOIN class_groups c ON c.id = ln.class_group_id
        LEFT JOIN subjects s ON s.id = ln.subject_id
        LEFT JOIN staff st ON st.id = ln.staff_id
       WHERE 1=1
    """
    params = []
    if status:
        sql += " AND COALESCE(ln.status,'draft') = %s"
        params.append(status)
    if class_id:
        sql += " AND ln.class_group_id = %s"
        params.append(class_id)
    # A teacher sees their own notes; somebody reviewing sees everybody's.
    if mine or not security.can(actor, "academics", "edit"):
        sql += " AND ln.staff_id = %s"
        params.append(actor.get("staff_id"))
    sql += " ORDER BY ln.id DESC LIMIT 200"
    return {"ok": True, "notes": db.all(sql, tuple(params)),
            "may_review": security.can(actor, "academics", "edit")}


def get_lesson_note(db, actor, note_id):
    row = db.one("""
      SELECT ln.*, c.name AS class_name, s.name AS subject_name,
             TRIM(COALESCE(st.surname,'') || ' ' || COALESCE(st.first_name,'')) AS teacher_name
        FROM lesson_notes ln
        LEFT JOIN class_groups c ON c.id = ln.class_group_id
        LEFT JOIN subjects s ON s.id = ln.subject_id
        LEFT JOIN staff st ON st.id = ln.staff_id
       WHERE ln.id = %s""", (note_id,))
    if not row:
        return {"ok": False, "status": 404, "error": "No such lesson note."}
    if row["staff_id"] != actor.get("staff_id") and not security.can(actor, "academics", "edit"):
        return {"ok": False, "status": 404, "error": "No such lesson note."}
    return {"ok": True, "note": row}


def save_lesson_note(db, actor, data):
    staff_id = actor.get("staff_id")
    if not staff_id:
        return {"ok": False, "status": 400, "error": "This account has no staff record."}
    topic = str(data.get("topic") or "").strip()
    if not topic:
        return {"ok": False, "status": 400, "error": "A lesson note needs a topic."}

    fields = {k: data.get(k) for k in (
        "class_group_id", "subject_id", "term_id", "week_number", "lesson_date",
        "duration_minutes", "sub_topic", "references_text", "tlms", "objectives", "rpk",
        "introduction", "presentation", "activity", "evaluation", "closure", "assignment",
        "remarks") if k in data}
    fields["topic"] = topic
    # Submitting is a state change, not a field: a note that has been approved
    # cannot be edited back into a draft by a save.
    wanted_status = data.get("status")
    note_id = data.get("id")

    if note_id:
        existing = db.one("SELECT id, staff_id, status FROM lesson_notes WHERE id = %s", (note_id,))
        if not existing or existing["staff_id"] != staff_id:
            return {"ok": False, "status": 404, "error": "No such lesson note."}
        if existing["status"] == "approved":
            return {"ok": False, "status": 400,
                    "error": "That note has been approved. Write a new one rather than changing it."}
        if wanted_status in ("draft", "submitted"):
            fields["status"] = wanted_status
        fields["updated_at"] = _now()
        sets = ", ".join(f'"{k}" = %s' for k in fields)
        db.run(f"UPDATE lesson_notes SET {sets} WHERE id = %s", tuple(fields.values()) + (note_id,))
    else:
        fields["staff_id"] = staff_id
        fields["status"] = wanted_status if wanted_status in ("draft", "submitted") else "draft"
        note_id = db.insert("lesson_notes", fields)

    security.audit(db, actor, "lesson_note", note_id, "save_lesson_note", topic)
    return {"ok": True, "id": note_id, "status": fields.get("status")}


def decide_lesson_note(db, actor, note_id, decision, comments=None):
    if not security.can(actor, "academics", "edit"):
        return {"ok": False, "status": 403, "error": "You may not review lesson notes."}
    if decision not in ("approved", "rejected"):
        return {"ok": False, "status": 400, "error": "Approve it or reject it."}
    row = db.one("SELECT id, staff_id, COALESCE(status,'draft') AS status FROM lesson_notes WHERE id = %s",
                 (note_id,))
    if not row:
        return {"ok": False, "status": 404, "error": "No such lesson note."}
    if row["status"] != "submitted":
        return {"ok": False, "status": 400, "error": "That note has not been submitted for review."}
    if row["staff_id"] and row["staff_id"] == actor.get("staff_id"):
        return {"ok": False, "status": 400, "error": "Somebody else has to sign off your own note."}

    db.run("""UPDATE lesson_notes SET status = %s, reviewed_by = %s, reviewed_at = %s,
                     review_comments = %s WHERE id = %s""",
           (decision, actor["user_id"], _now(), str(comments or "")[:1000] or None, note_id))
    security.audit(db, actor, "lesson_note", note_id, f"lesson_note_{decision}", str(comments or ""))
    return {"ok": True}


# ── a person's own employment ───────────────────────────────────────────────

def me(db, actor, year=None):
    """Your own record: your register, your leave, your payslips.

    No permission is checked, and none should be. It is your life.
    """
    staff_id = actor.get("staff_id")
    if not staff_id:
        return {"ok": True, "has_staff": False,
                "message": "This account is not linked to a staff record."}
    year = int(year or datetime.date.today().year)
    month = datetime.date.today().strftime("%Y-%m")
    row = db.one("""
      SELECT st.id, st.staff_number, st.surname, st.first_name, st.other_names, st.role,
             st.phone, st.email, st.hire_date, st.qualification, st.status,
             d.name AS designation
        FROM staff st LEFT JOIN designations d ON d.id = st.designation_id WHERE st.id = %s""",
                 (staff_id,))
    return {
        "ok": True, "has_staff": True,
        "staff": {**row, "name": f"{row.get('surname') or ''} {row.get('first_name') or ''}".strip()},
        "attendance": db.all("""
          SELECT date, status, clock_in, clock_out FROM staff_attendance
           WHERE staff_id = %s AND date LIKE %s ORDER BY date DESC""", (staff_id, f"{month}%")),
        "leave_requests": db.all("""
          SELECT id, leave_type, start_date, end_date, days_requested, status,
                 reviewer_notes, created_at
            FROM leave_requests WHERE staff_id = %s ORDER BY id DESC LIMIT 20""", (staff_id,)),
        "payslips": db.all("""
          SELECT month, year, gross_salary, ssnit_worker, paye_tax, other_deductions,
                 net_salary, actual_amount_paid, is_paid, payment_date
            FROM staff_salaries WHERE staff_id = %s AND year = %s ORDER BY month DESC""",
                           (staff_id, year)),
        "assignments": db.all("""
          SELECT sa.class_group_id, c.name AS class_name, sa.subject_id, s.name AS subject_name,
                 sa.is_class_teacher
            FROM staff_assignments sa
            LEFT JOIN class_groups c ON c.id = sa.class_group_id
            LEFT JOIN subjects s ON s.id = sa.subject_id
           WHERE sa.staff_id = %s""", (staff_id,)),
    }
