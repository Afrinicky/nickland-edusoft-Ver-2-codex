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


def periods(db):
    return db.all("""SELECT id, label, start_time, end_time, display_order, is_break
                       FROM timetable_periods ORDER BY display_order, start_time""")


def save_period(db, actor, data):
    period_id = data.get("id")
    row = {
        "label": str(data.get("label") or "")[:60],
        "start_time": data.get("start_time"), "end_time": data.get("end_time"),
        "display_order": data.get("display_order") or 0,
        "is_break": 1 if data.get("is_break") else 0,
    }
    if not row["label"]:
        return {"ok": False, "status": 400, "error": "Give the period a name."}
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
