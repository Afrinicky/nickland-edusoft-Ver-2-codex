"""Which days are school days — a translation of the offline calendar handlers.

Every canteen figure in the system rests on this table. What a pupil owes is
the number of SCHOOL DAYS they have not paid for times the daily rate, so a
term with no calendar has no arrears at all, and a term with the wrong one has
the wrong arrears — quietly, and in the school's favour or the parent's,
depending on which way it is wrong.

It used to be reachable only from the installed application. A school could
therefore read the consequences of the calendar online and not set it: the
Canteen module's Calendar tab could change the daily rate and nothing else.

Two ways in, because a term is laid out once and then corrected all the time:

  * ``set_term`` writes the whole term — weekdays are school days, weekends are
    not, and the holidays the office names are taken out.
  * ``set_day`` changes one day. A public holiday declared on Tuesday afternoon
    is the ordinary case, and it must not cost anybody the whole term.

Read is allowed to Canteen or Settings, write to either at edit — the same pair
the offline routes check, because the calendar belongs to both: the canteen
counts against it and the office owns the term dates.
"""
import datetime
import re

from . import security

DAY_TYPES = ("school_day", "holiday", "weekend", "vacation")
_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _may_read(actor):
    return security.can(actor, "canteen", "view") or security.can(actor, "settings", "view")


def _may_write(actor):
    return security.can(actor, "canteen", "edit") or security.can(actor, "settings", "edit")


def _denied():
    return {"ok": False, "status": 403, "error": "Access denied."}


def _current_term(db):
    return db.one("SELECT * FROM terms WHERE is_current = 1")


def listing(db, actor, term_id=None):
    if not _may_read(actor):
        return _denied()
    if not term_id:
        term_id = (_current_term(db) or {}).get("id")
    if term_id:
        days = db.all("SELECT * FROM school_calendar WHERE term_id = %s ORDER BY date",
                      (int(term_id),))
    else:
        days = db.all("SELECT * FROM school_calendar ORDER BY date LIMIT 500")
    counts = {}
    for d in days:
        counts[d["day_type"]] = counts.get(d["day_type"], 0) + 1
    return {"ok": True, "term_id": term_id, "days": days, "counts": counts,
            "school_days": counts.get("school_day", 0), "may_edit": _may_write(actor)}


def set_day(db, actor, date=None, day_type="school_day", label="", term_id=None):
    if not _may_write(actor):
        return _denied()
    date = str(date or "")[:10]
    if not _ISO.match(date):
        return {"ok": False, "status": 400, "error": "Which day? Use YYYY-MM-DD."}
    day_type = day_type if day_type in DAY_TYPES else "school_day"
    if not term_id:
        term_id = (_current_term(db) or {}).get("id")
    label = str(label or "")[:120]

    existing = db.one("SELECT id FROM school_calendar WHERE date = %s", (date,))
    if existing:
        db.run("UPDATE school_calendar SET day_type = %s, label = %s, term_id = %s WHERE date = %s",
               (day_type, label, term_id, date))
    else:
        db.run("""INSERT INTO school_calendar (date, day_type, label, term_id)
                  VALUES (%s, %s, %s, %s)""", (date, day_type, label, term_id))
    security.audit(db, actor, "school_calendar", None, "set_calendar_day",
                   f"{date} -> {day_type}", "normal")
    return {"ok": True, "date": date, "day_type": day_type, "label": label}


def set_term(db, actor, term_id=None, start_date=None, end_date=None,
             exclude_weekends=True, holidays=None):
    """Lay out a whole term.

    The same generator the desktop runs, so a term set up in a browser and one
    set up at the office PC produce the same calendar and therefore the same
    arrears. Written in one transaction: a half-written term is a term whose
    canteen figures are wrong in a way nobody would think to look for.
    """
    if not _may_write(actor):
        return _denied()
    term = (db.one("SELECT * FROM terms WHERE id = %s", (int(term_id),)) if term_id
            else _current_term(db))
    if not term:
        return {"ok": False, "status": 400,
                "error": "No term is running, so there is nothing to lay out."}
    start = str(start_date or term.get("start_date") or "")[:10]
    end = str(end_date or term.get("end_date") or "")[:10]
    if not start or not end or start > end:
        return {"ok": False, "status": 400,
                "error": "That term has no dates. Set them in Settings → Terms first."}

    named = {}
    for h in (holidays or []):
        if isinstance(h, dict) and h.get("date"):
            named[str(h["date"])[:10]] = str(h.get("label") or "Holiday")[:120]

    school = off = 0
    try:
        d = datetime.date.fromisoformat(start)
        last = datetime.date.fromisoformat(end)
    except ValueError:
        return {"ok": False, "status": 400, "error": "Those dates are not dates. Use YYYY-MM-DD."}

    with db.tx() as tx:
        while d <= last:
            iso = d.isoformat()
            day_type, label = "school_day", ""
            if exclude_weekends and d.weekday() >= 5:
                day_type = "holiday"
                label = "Saturday" if d.weekday() == 5 else "Sunday"
            if iso in named:
                day_type, label = "holiday", named[iso]
            # `date` is UNIQUE, so the term can be laid out again after the
            # office corrects a date without first clearing what is there.
            tx.run("""INSERT INTO school_calendar (date, day_type, label, term_id)
                      VALUES (%s, %s, %s, %s)
                      ON CONFLICT (date) DO UPDATE
                         SET day_type = EXCLUDED.day_type, label = EXCLUDED.label,
                             term_id = EXCLUDED.term_id""",
                   (iso, day_type, label, term["id"]))
            if day_type == "school_day":
                school += 1
            else:
                off += 1
            d += datetime.timedelta(days=1)

    security.audit(db, actor, "school_calendar", term["id"], "setup_term_calendar",
                   f"{term['label']}: {school} school days, {off} off", "high")
    return {"ok": True, "term": term["label"], "school_days": school, "off_days": off}
