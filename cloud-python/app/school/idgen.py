"""Admission numbers, roll numbers and receipt numbers.

A translation of ``electron/utils/idgen.js``. The numbers a school hands out
are not incidental: an admission number identifies a child on every document
they will ever be given, and a receipt number is what an audit of the books
counts. Both are generated the same way online as offline, so a school that
uses both systems issues one sequence rather than two.
"""
import re

# How many years ago a pupil in this class would have entered N1. Add or remove
# entries here if a school adds a class level.
CLASS_YEARS_BACK = {
    "PRE": 0, "N1": 0, "N2": 1,
    "KG1": 2, "KG2": 3,
    "BS1": 4, "BS2": 5, "BS3": 6, "BS4": 7, "BS5": 8, "BS6": 9,
    "JHS1": 10, "JHS2": 11, "JHS3": 12,
}

_INDEX = re.compile(r"^([A-Z]+)/(\d{2})/(\d+)$")


def admission_year(class_short_code, current_year):
    # Strip any " A/B/C" section suffix to look up the base class.
    base = re.sub(r"\s+", "", re.sub(r"[A-Z]$", "", str(class_short_code or ""))).upper()
    back = CLASS_YEARS_BACK.get(base)
    return current_year if back is None else current_year - back


def format_index_number(prefix, year, roll):
    return f"{prefix}/{str(year)[-2:]}/{str(roll).zfill(5)}"


def parse_index_number(index_number):
    m = _INDEX.match(str(index_number or ""))
    if not m:
        return None
    return {"prefix": m.group(1), "yy": int(m.group(2)),
            "year": 2000 + int(m.group(2)), "roll": int(m.group(3))}


def school_abbreviation(db):
    return db.get_setting("school_abbreviation", "AVE") or "AVE"


def next_roll_number(db):
    try:
        return int(db.get_setting("next_roll_number", "1") or 1)
    except (TypeError, ValueError):
        return 1


def set_next_roll_number(db, nxt):
    db.set_setting("next_roll_number", str(nxt))


def next_receipt_number(tx):
    """Consume one receipt number, INSIDE the caller's transaction.

    Taken outside it, a payment that failed to record still burns a number and
    leaves a gap in the sequence — which is exactly what an audit of a school's
    books treats as a missing receipt. So this takes the transaction handle,
    not the database.
    """
    row = tx.one("SELECT value FROM settings WHERE key = 'receipt_counter' FOR UPDATE")
    current = 1
    if row and row["value"]:
        try:
            current = int(row["value"])
        except (TypeError, ValueError):
            current = 1
    tx.run("""INSERT INTO settings (key, value, category)
                   VALUES ('receipt_counter', %s, 'system')
              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value""",
           (str(current + 1),))
    return current
