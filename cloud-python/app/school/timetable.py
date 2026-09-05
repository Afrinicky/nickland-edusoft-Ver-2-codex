"""The timetable — a translation of ``electron/ipc/timetable.js``.

Periods are the school's, shared by every class; entries are one class's week.
A teacher's own timetable is the same table read the other way round, which is
why both live here rather than in two modules that would disagree about what a
free period is.
"""
from . import scope as scope_lib, security

# Numbered, as the offline schema stores them, with the label alongside so a
# screen does not have to know that Monday is 1.
DAYS = [
    {"value": 1, "label": "Monday"},
    {"value": 2, "label": "Tuesday"},
    {"value": 3, "label": "Wednesday"},
    {"value": 4, "label": "Thursday"},
    {"value": 5, "label": "Friday"},
]
DAY_VALUES = {d["label"].lower(): d["value"] for d in DAYS}


def _day(value):
    """Accept a number or a name; store a number."""
    if isinstance(value, str):
        if value.isdigit():
            return int(value)
        return DAY_VALUES.get(value.strip().lower())
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def periods(db):
    return db.all("""SELECT id, label, start_time, end_time, display_order, is_break
                       FROM timetable_periods ORDER BY display_order, start_time""")


def save_periods(db, actor, rows_in):
    """The whole bell schedule, replaced in one act.

    Wholesale rather than row by row, because that is what the editor sends and
    what the desktop does (``electron/ipc/timetable.js``): the screen holds the
    school's day as a list, and a half-applied list is a school with two
    fourth periods. A period the new list keeps its id for is updated; one it
    no longer names is removed, along with the timetable entries against it —
    otherwise a cell would point at a bell that no longer rings.

    This is what the online route actually receives. It used to read ONE period
    out of a body that carried a list, find no label in it, and answer "Give
    the period a name" — so the bell schedule could not be edited online at
    all, and the message blamed the person for the shape of their own request.
    """
    if not (actor.get("is_admin") or security.can(actor, "settings", "edit")):
        return {"ok": False, "status": 403,
                "error": "The school's periods belong to the office. "
                         "You can lay out your own week against them."}

    rows = []
    for i, p in enumerate(rows_in or []):
        row = {
            "id": _int(p.get("id")),
            "label": str(p.get("label") or "").strip()[:60],
            "start_time": str(p.get("start_time") or "")[:5],
            "end_time": str(p.get("end_time") or "")[:5],
            "display_order": _int(p.get("display_order")) if p.get("display_order") is not None else i,
            "is_break": 1 if p.get("is_break") else 0,
        }
        if row["label"] and row["start_time"] and row["end_time"]:
            rows.append(row)

    if not rows:
        return {"ok": False, "status": 400,
                "error": "A timetable needs at least one period, and each one needs "
                         "a name and both times."}

    keep = [r["id"] for r in rows if r["id"]]
    with db.tx() as tx:
        for existing in tx.all("SELECT id FROM timetable_periods"):
            if existing["id"] in keep:
                continue
            tx.run("DELETE FROM timetable_entries WHERE period_id = %s", (existing["id"],))
            tx.run("DELETE FROM timetable_periods WHERE id = %s", (existing["id"],))
        for r in rows:
            if r["id"]:
                tx.run("""UPDATE timetable_periods
                             SET label = %s, start_time = %s, end_time = %s,
                                 display_order = %s, is_break = %s
                           WHERE id = %s""",
                       (r["label"], r["start_time"], r["end_time"],
                        r["display_order"], r["is_break"], r["id"]))
            else:
                tx.run("""INSERT INTO timetable_periods
                            (label, start_time, end_time, display_order, is_break)
                          VALUES (%s, %s, %s, %s, %s)""",
                       (r["label"], r["start_time"], r["end_time"],
                        r["display_order"], r["is_break"]))

    security.audit(db, actor, "timetable_period", None, "save_periods",
                   f"{len(rows)} period(s)", "normal")
    return {"ok": True, "written": len(rows), "periods": periods(db)}


def save_period(db, actor, data):
    """One line of the school's bell schedule.

    Two things it did not check, and now does.

    It is the SCHOOL's day, not one class's: every class in the building is
    laid out against these periods, so a class teacher who may fill in their
    own week may not move the bell for everybody. Online is deliberately
    stricter than the desktop here, which is the rule this service is built on
    — the desktop sits in a locked office and this does not.

    And a period with no times is not a period. The columns are NOT NULL, so
    what used to happen was a 500 and a stack trace in the log; what happens
    now is the same sentence the installed application says.
    """
    if not (actor.get("is_admin") or security.can(actor, "settings", "edit")):
        return {"ok": False, "status": 403,
                "error": "The school's periods belong to the office. "
                         "You can lay out your own week against them."}
    period_id = data.get("id")
    row = {
        "label": str(data.get("label") or "")[:60],
        "start_time": str(data.get("start_time") or "")[:5],
        "end_time": str(data.get("end_time") or "")[:5],
        "display_order": data.get("display_order") or 0,
        "is_break": 1 if data.get("is_break") else 0,
    }
    if not row["label"]:
        return {"ok": False, "status": 400, "error": "Give the period a name."}
    if not row["start_time"] or not row["end_time"]:
        return {"ok": False, "status": 400,
                "error": "When does it start and end? A period needs both times."}
    if period_id:
        sets = ", ".join(f'"{k}" = %s' for k in row)
        db.run(f"UPDATE timetable_periods SET {sets} WHERE id = %s",
               tuple(row.values()) + (period_id,))
    else:
        period_id = db.insert("timetable_periods", row)
    security.audit(db, actor, "timetable_period", period_id, "save_period", row["label"])
    return {"ok": True, "id": period_id}


def class_week(db, actor, class_id):
    if not scope_lib.can_access_class(actor["scope"], class_id):
        return {"ok": False, "status": 403, "error": "That is not one of your classes."}
    entries = db.all("""
      SELECT te.id, te.day_of_week, te.period_id, te.subject_id, te.teacher_id, te.notes,
             s.name AS subject_name,
             TRIM(COALESCE(st.surname,'') || ' ' || COALESCE(st.first_name,'')) AS teacher_name
        FROM timetable_entries te
        LEFT JOIN subjects s ON s.id = te.subject_id
        LEFT JOIN staff st ON st.id = te.teacher_id
       WHERE te.class_group_id = %s""", (class_id,))
    grid = {}
    for e in entries:
        grid.setdefault(str(e["day_of_week"]), {})[str(e["period_id"])] = e
    return {"ok": True, "class_id": class_id, "days": DAYS,
            "periods": periods(db), "entries": grid,
            "may_edit": security.can(actor, "academics", "edit")}


def save_class_week(db, actor, class_id, entries):
    """Replace one class's week.

    Wholesale rather than patched, so what is stored always matches what the
    screen showed — a half-applied timetable is a class in two rooms at once.
    """
    if not scope_lib.can_access_class(actor["scope"], class_id):
        return {"ok": False, "status": 403, "error": "That is not one of your classes."}
    written = 0
    with db.tx() as tx:
        tx.run("DELETE FROM timetable_entries WHERE class_group_id = %s", (class_id,))
        for e in entries or []:
            if not e.get("subject_id") or not e.get("period_id"):
                continue
            day = _day(e.get("day_of_week") or e.get("day"))
            if not day:
                continue
            tx.run("""INSERT INTO timetable_entries
                        (class_group_id, day_of_week, period_id, subject_id, teacher_id, notes)
                      VALUES (%s,%s,%s,%s,%s,%s)""",
                   (class_id, day, e["period_id"], e["subject_id"],
                    e.get("teacher_id"), e.get("notes")))
            written += 1
    security.audit(db, actor, "timetable", class_id, "save_timetable", f"{written} period(s)")
    return {"ok": True, "entries": written}


def mine(db, actor):
    """One teacher's week, wherever it takes them."""
    staff_id = actor.get("staff_id")
    if not staff_id:
        return {"ok": True, "has_staff": False, "days": DAYS, "periods": periods(db), "entries": {}}
    rows = db.all("""
      SELECT te.day_of_week, te.period_id, te.subject_id, te.class_group_id, te.notes,
             s.name AS subject_name, c.name AS class_name
        FROM timetable_entries te
        LEFT JOIN subjects s ON s.id = te.subject_id
        LEFT JOIN class_groups c ON c.id = te.class_group_id
       WHERE te.teacher_id = %s""", (staff_id,))
    grid = {}
    for r in rows:
        grid.setdefault(str(r["day_of_week"]), {})[str(r["period_id"])] = r
    return {"ok": True, "has_staff": True, "days": DAYS,
            "periods": periods(db), "entries": grid}
