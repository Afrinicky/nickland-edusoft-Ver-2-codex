"""The staff surface — what lets a teacher work with the school's PC switched off.

The Python twin of cloud/src/staff.js, endpoint for endpoint and shape for
shape, so the same mobile build works against either service.

The parent side of the cloud is a read model; this is a read model AND a write
queue, because a register has to go somewhere. Reads come from projections the
desktop pushes (staff_auth, class_roster, school_metrics, debtor_list,
staff_timetable — see electron/server/sync/staff_projection.js). Writes are
appended to the same cloud→desktop change queue parent profile edits already
use, and the desktop applies them through the very functions its own LAN API
calls.

Two things make that honest rather than a trick:

  * A teacher sees their own pending work. Marks that are queued but not yet
    applied are merged over the projected register before it is served, and
    flagged ``pending``. Without that, marking a register and reloading would
    show a blank sheet, and the teacher would mark it again.

  * The desktop has the last word. Permissions are checked here from the
    projection, and checked AGAIN on the desktop before anything is written,
    against the live account. A projection is a copy; a copy can be stale.
"""
import datetime
import uuid as _uuid

from . import portal_auth as pauth

WRITE_TYPES = [
    "attendance_mark", "score_entry", "assessment_entry", "term_remarks",
    "canteen_collect", "homework_create", "lesson_note_save",
    "leave_request", "staff_clock", "message_reply", "announcement_create",
]

_ACTION_KEY = {"view": "canView", "create": "canCreate", "edit": "canEdit", "delete": "canDelete"}


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


# ── passwords ───────────────────────────────────────────────────────────────
# Staff passwords are bcrypt on the desktop (electron/ipc/auth.js), unlike
# parents, which are scrypt. Rather than force every teacher to re-enrol so
# their password could be re-hashed, verify bcrypt directly.
def verify_staff_password(password, stored):
    if not stored or not str(stored).startswith("$2"):
        return False
    try:
        import bcrypt
    except ImportError as exc:                                  # pragma: no cover
        raise RuntimeError("The 'bcrypt' package is required for staff sign-in.") from exc
    try:
        return bcrypt.checkpw(str(password).encode(), str(stored).encode())
    except (ValueError, TypeError):
        return False


def sign_staff_token(school_id, user_id, ttl_seconds=7 * 24 * 3600):
    return pauth.sign_token({"school_id": school_id, "user_id": user_id, "role": "staff"}, ttl_seconds)


def staff_claims(token):
    """Claims for a staff token, or None.

    A parent token carries no ``role``, so it can never satisfy this — and the
    reverse is covered on the parent side, which looks a record up by
    ``parent_id`` that a staff token does not carry.
    """
    c = pauth.verify_token(token) if token else None
    if c and c.get("role") == "staff" and c.get("user_id"):
        return c
    return None


def load_staff(store, school_id, user_id):
    for row in store.list_snapshots(school_id, "staff_auth"):
        p = row.get("payload") or {}
        if p.get("user_id") == user_id:
            return p if p.get("is_active") else None
    return None


def find_staff_by_username(store, school_id, username):
    u = str(username or "").strip().lower()
    if not u:
        return None
    for row in store.list_snapshots(school_id, "staff_auth"):
        p = row.get("payload") or {}
        if p.get("is_active") and str(p.get("username") or "").lower() == u:
            return p
    return None


# ── teaching scope ──────────────────────────────────────────────────────────
# Permissions say whether a teacher may edit scores at all; this says whose.
# The desktop resolves it (electron/ipc/_scope.js) and projects the answer, so
# there is one implementation of "which classes are mine" rather than three
# that drift.
#
# This twin had none of it, so it served every class in the school to every
# teacher — the rule the desktop enforces and the Node service applies, absent
# here. Class rosters are the spine of every staff read, so filtering them
# covers the class list, the roll, registers, score sheets and homework at once.
def _scope_of(rec):
    s = (rec or {}).get("scope") or {}
    return {
        "unrestricted": bool(s.get("unrestricted") or (rec or {}).get("is_admin")),
        "whole_classes": {int(c) for c in (s.get("whole_classes") or [])},
        "class_subjects": {int(k): {int(v) for v in (vs or [])}
                           for k, vs in (s.get("class_subjects") or {}).items()},
        "any_class_subjects": {int(v) for v in (s.get("any_class_subjects") or [])},
        "class_teacher_of": {int(c) for c in (s.get("class_teacher_of") or [])},
    }


def in_scope_class(rec, class_id):
    sc = _scope_of(rec)
    if sc["unrestricted"]:
        return True
    cid = _int(class_id)
    if not cid:
        return False
    return (cid in sc["whole_classes"] or cid in sc["class_subjects"]
            or bool(sc["any_class_subjects"]))


def in_scope_subject(rec, class_id, subject_id):
    sc = _scope_of(rec)
    if sc["unrestricted"]:
        return True
    cid, sid = _int(class_id), _int(subject_id)
    if not cid or not sid:
        return False
    if cid in sc["whole_classes"]:
        return True
    if sid in sc["any_class_subjects"]:
        return True
    return sid in sc["class_subjects"].get(cid, set())


def is_class_teacher_of(rec, class_id):
    """The register and the canteen sheet belong to the one teacher answerable
    for the class, not to everyone who takes a subject in it."""
    sc = _scope_of(rec)
    return sc["unrestricted"] or _int(class_id) in sc["class_teacher_of"]


def can(rec, module, action):
    if not rec:
        return False
    if rec.get("is_admin"):
        return True
    p = (rec.get("permissions") or {}).get(module)
    return bool(p and p.get(_ACTION_KEY[action]))


def can_any(rec, pairs):
    return any(can(rec, m, a) for m, a in pairs)


# ── projection readers ──────────────────────────────────────────────────────

def _payload(store, school_id, entity_type, key=None):
    rows = store.list_snapshots(school_id, entity_type)
    for r in rows:
        if key is None or r.get("entity_key") == key:
            return r.get("payload")
    return None


def _all_rosters(store, school_id, rec=None):
    """`rec` filters the result to the teacher's own classes."""
    rows = [r.get("payload") for r in store.list_snapshots(school_id, "class_roster")]
    rows = [p for p in rows if p]
    if rec is not None:
        rows = [p for p in rows if in_scope_class(rec, p.get("class_id"))]
    return sorted(rows, key=lambda p: (p.get("level_order") or 0, str(p.get("name") or "")))


def _roster(store, school_id, class_id, rec=None):
    """`rec` given, a class outside the teacher's scope resolves to nothing at
    all — the same answer as a class that does not exist, which is the answer a
    teacher who may not see it should get."""
    if rec is not None and not in_scope_class(rec, class_id):
        return None
    return _payload(store, school_id, "class_roster", f"class:{class_id}")


def _pending(store, school_id, types):
    """Everything a teacher has submitted that the desktop has not taken yet.

    The store tracks how far the desktop has pulled, so this shrinks to nothing
    once the school's machine comes back and syncs.
    """
    fn = getattr(store, "pending_changes", None)
    if not fn:
        return []
    try:
        return fn(school_id, types=types)
    except Exception:                                            # pragma: no cover
        return []


# ── reads ───────────────────────────────────────────────────────────────────

def dashboard(store, school_id, rec):
    m = _payload(store, school_id, "school_metrics", "metrics:school")
    empty = {"students": 0, "staff": 0, "fees_collected": 0, "fees_outstanding": 0}
    if not m:
        return {"ok": True, "term": None, "metrics": empty, "stale": True}
    metrics = dict(empty, **(m.get("metrics") or {}))
    # The dashboard shows money; a teacher who cannot see fees does not get the
    # fee numbers, exactly as on the desktop.
    if not can(rec, "fees", "view"):
        metrics["fees_collected"] = 0
        metrics["fees_outstanding"] = 0
    return {"ok": True, "term": m.get("term"), "metrics": metrics, "updated_at": m.get("updated_at")}


def students(store, school_id, class_id=None, rec=None):
    out = []
    for r in _all_rosters(store, school_id, rec):
        if class_id and str(r.get("class_id")) != str(class_id):
            continue
        for s in r.get("students") or []:
            # Split back into the shape the LAN API returns, so the same screen
            # renders either way.
            parts = str(s.get("name") or "").split(" ")
            out.append({
                "id": s.get("id"), "index_number": s.get("index_number"),
                "surname": parts[0] if parts else "", "first_name": " ".join(parts[1:]),
                "gender": None, "class_name": r.get("name"),
            })
    return {"ok": True, "students": out}


def debtors(store, school_id):
    d = _payload(store, school_id, "debtor_list", "debtors:school") or {}
    return {"ok": True, "debtors": d.get("debtors") or [], "updated_at": d.get("updated_at")}


def classes(store, school_id, rec=None):
    return {"ok": True, "classes": [
        {"id": r.get("class_id"), "name": r.get("name"), "short_code": r.get("short_code"),
         "is_class_teacher": is_class_teacher_of(rec, r.get("class_id")) if rec is not None else False}
        for r in _all_rosters(store, school_id, rec)
    ]}


def attendance_sheet(store, school_id, class_id, date, rec=None):
    """The register for a class on a date: what the desktop last projected,
    with anything this school has queued since merged over the top."""
    r = _roster(store, school_id, class_id, rec)
    if not r:
        return {"ok": True, "students": []}

    marked = dict((r.get("attendance") or {}).get(date) or {})
    queued = set()
    for ch in _pending(store, school_id, ["attendance_mark"]):
        p = ch.get("payload") or {}
        if p.get("date") != date:
            continue
        for m in p.get("marks") or []:
            marked[str(m.get("student_id"))] = {"status": m.get("status"), "notes": m.get("notes")}
            queued.add(str(m.get("student_id")))

    out = []
    for s in r.get("students") or []:
        hit = marked.get(str(s.get("id"))) or {}
        row = {
            "id": s.get("id"), "index_number": s.get("index_number"), "name": s.get("name"),
            "status": hit.get("status"), "notes": hit.get("notes"),
        }
        if str(s.get("id")) in queued:
            row["pending"] = True
        out.append(row)
    return {"ok": True, "students": out}


def score_subjects(store, school_id, class_id, rec=None):
    r = _roster(store, school_id, class_id, rec) or {}
    subjects = r.get("subjects") or []
    # A teacher who visits a class for one subject is offered that subject and
    # no other — being shown the rest and refused on choosing one is exactly
    # what the school asked us to stop doing.
    if rec is not None:
        subjects = [sub for sub in subjects if in_scope_subject(rec, class_id, sub.get("id"))]
    return {"ok": True, "subjects": subjects}


def score_sheet(store, school_id, class_id, subject_id, rec=None):
    if rec is not None and not in_scope_subject(rec, class_id, subject_id):
        return {"ok": True, "term": None, "students": []}
    r = _roster(store, school_id, class_id, rec)
    if not r:
        return {"ok": True, "term": None, "students": []}

    marks = dict((r.get("scores") or {}).get(str(subject_id)) or {})
    queued = set()
    for ch in _pending(store, school_id, ["score_entry"]):
        p = ch.get("payload") or {}
        if str(p.get("subject_id")) != str(subject_id):
            continue
        for m in p.get("marks") or []:
            # A queued mark has no computed total yet — that is the desktop's
            # job, and a stale total beside a fresh exam score would be a lie.
            marks[str(m.get("student_id"))] = {"exam_score": m.get("exam_score"), "total_score": None}
            queued.add(str(m.get("student_id")))

    out = []
    for s in r.get("students") or []:
        hit = marks.get(str(s.get("id"))) or {}
        row = {
            "id": s.get("id"), "index_number": s.get("index_number"), "name": s.get("name"),
            "exam_score": hit.get("exam_score"), "total_score": hit.get("total_score"),
        }
        if str(s.get("id")) in queued:
            row["pending"] = True
        out.append(row)
    return {"ok": True, "term": r.get("term"), "students": out}


def canteen_student(store, school_id, student_id, rec=None):
    """Canteen reads come from the parent-side student snapshot, which already
    carries the unpaid-day count — there is no second projection to keep in step."""
    s = _payload(store, school_id, "student_snapshot", f"student:{student_id}")
    if not s:
        return {"ok": False, "status": 404, "error": "Student not found."}
    # Taking canteen money is the class teacher's job, so a pupil outside their
    # class is not theirs to collect from. Answered as not-found rather than
    # forbidden: which pupils exist in another class is not their business.
    if rec is not None and s.get("class_id") and not is_class_teacher_of(rec, s.get("class_id")):
        return {"ok": False, "status": 404, "error": "Student not found."}
    c = s.get("canteen") or {}
    unpaid = c.get("unpaid_days") or 0
    owed = c.get("amount_owed") or 0
    return {
        "ok": True,
        "student": {"id": s.get("student_id"), "index_number": s.get("index_number"),
                    "name": s.get("name"), "class_name": s.get("class_name")},
        "daily_rate": (owed / unpaid) if unpaid else None,
        "unpaid_days": unpaid, "amount_owed": owed,
        "term": {"label": s.get("term")} if s.get("term") else None,
    }


def timetable_mine(store, school_id, rec):
    t = _payload(store, school_id, "staff_timetable", f"timetable:user:{rec.get('user_id')}")
    if not t:
        return {"ok": True, "has_staff": False, "days": [], "today": None}
    iso = datetime.date.today().isoweekday()          # Mon=1 … Sun=7
    today = None
    if 1 <= iso <= 5:
        today = next((d for d in (t.get("days") or []) if d.get("value") == iso), None)
    return {"ok": True, "has_staff": bool(t.get("has_staff")), "days": t.get("days") or [], "today": today}


def homework_for_class(store, school_id, class_id, rec=None):
    r = _roster(store, school_id, class_id, rec) or {}
    out = list(r.get("homework") or [])
    for ch in _pending(store, school_id, ["homework_create"]):
        p = ch.get("payload") or {}
        if str(p.get("class_id")) != str(class_id):
            continue
        out.insert(0, {"id": None, "title": p.get("title"), "description": p.get("description"),
                       "due_date": p.get("due_date"), "max_marks": p.get("max_marks"), "pending": True})
    return {"ok": True, "homework": out}


# ── a pupil's record ────────────────────────────────────────────────────────
# Assembled from the two projections that already exist rather than a third:
# the class roster holds who is in the class and their guardians, and the
# parent-side student snapshot holds fees, canteen, attendance and the report.
def student_profile(store, school_id, student_id, rec=None):
    snap = _payload(store, school_id, "student_snapshot", f"student:{student_id}")
    if not snap:
        return {"ok": False, "status": 404, "error": "Student not found."}
    if rec is not None and not in_scope_class(rec, snap.get("class_id")):
        return {"ok": False, "status": 404, "error": "Student not found."}

    r = _roster(store, school_id, snap.get("class_id"), rec) if snap.get("class_id") else None
    in_roster = None
    if r:
        in_roster = next((x for x in (r.get("students") or [])
                          if str(x.get("id")) == str(student_id)), None)
    summary = (r.get("summaries") or {}).get(str(student_id)) if r else None
    rep = snap.get("report") or None

    if not summary and rep:
        summary = {"average_score": rep.get("average"), "class_rank": rep.get("rank"),
                   "number_on_roll": rep.get("number_on_roll"), "teacher_remarks": rep.get("remarks")}

    return {
        "ok": True,
        "term": {"label": snap.get("term")} if snap.get("term") else None,
        "student": {
            "id": snap.get("student_id"), "index_number": snap.get("index_number"),
            "name": snap.get("name"), "class_id": snap.get("class_id"),
            "class_name": snap.get("class_name") or (r.get("name") if r else None),
        },
        "guardians": (in_roster or {}).get("guardians") or [],
        "attendance": snap.get("attendance") or {"present": 0, "absent": 0, "total": 0},
        "recent_attendance": [],
        "fees": snap.get("fees") if can(rec, "fees", "view") else None,
        "canteen": snap.get("canteen") if can(rec, "canteen", "view") else None,
        "subjects": [{"subject": x.get("subject"), "total_score": x.get("total"),
                      "grade_remark": x.get("grade")} for x in ((rep or {}).get("subjects") or [])],
        "summary": summary,
        "homework": snap.get("homework") or [],
        "stale": True,
    }


# ── register history ────────────────────────────────────────────────────────
def attendance_history(store, school_id, class_id, days=30, rec=None):
    r = _roster(store, school_id, class_id, rec)
    if not r:
        return {"ok": True, "days": [], "students": [], "marked_days": 0}

    by_date = {d: dict(marks) for d, marks in (r.get("attendance") or {}).items()}
    for ch in _pending(store, school_id, ["attendance_mark"]):
        p = ch.get("payload") or {}
        if not p.get("date"):
            continue
        bucket = by_date.setdefault(p["date"], {})
        for m in p.get("marks") or []:
            bucket[str(m.get("student_id"))] = {"status": m.get("status"), "notes": m.get("notes")}

    per = {str(x.get("id")): {"present": 0, "absent": 0, "late": 0, "total": 0, "reasons": []}
           for x in (r.get("students") or [])}
    rows = []
    for date, marks in sorted(by_date.items(), reverse=True):
        row = {"date": date, "present": 0, "absent": 0, "late": 0, "total": 0}
        for sid, m in marks.items():
            row["total"] += 1
            key = "absent" if m.get("status") == "absent" else "late" if m.get("status") == "late" else "present"
            row[key] += 1
            hit = per.get(str(sid))
            if hit:
                hit["total"] += 1
                hit[key] += 1
                # The reason travels with the count, newest first and capped —
                # capturing why a child was away is only worth doing if
                # somebody can read it back afterwards.
                if m.get("notes") and len(hit["reasons"]) < 6:
                    hit["reasons"].append({"date": date, "status": m.get("status"),
                                           "reason": m.get("notes")})
        rows.append(row)
    limited = rows[:days] if days else rows

    return {
        "ok": True, "marked_days": len(limited),
        "window_days": r.get("attendance_days"),
        "days": limited,
        "students": [dict({"id": x.get("id"), "index_number": x.get("index_number"),
                           "name": x.get("name")}, **per[str(x.get("id"))])
                     for x in (r.get("students") or [])],
    }


# ── continuous assessment ───────────────────────────────────────────────────
def assessment_sheet(store, school_id, class_id, subject_id, rec=None):
    if rec is not None and not in_scope_subject(rec, class_id, subject_id):
        return {"ok": True, "term": None, "columns": [], "students": []}
    r = _roster(store, school_id, class_id, rec)
    if not r:
        return {"ok": True, "term": None, "columns": [], "students": []}
    bucket = (r.get("assessments") or {}).get(str(subject_id)) or {"columns": [], "marks": {}}

    marks = {sid: dict(cols) for sid, cols in (bucket.get("marks") or {}).items()}
    queued = set()
    for ch in _pending(store, school_id, ["assessment_entry"]):
        p = ch.get("payload") or {}
        if str(p.get("class_id")) != str(class_id) or str(p.get("subject_id")) != str(subject_id):
            continue
        for m in p.get("marks") or []:
            row = marks.setdefault(str(m.get("student_id")), {})
            if m.get("marks") in (None, ""):
                row.pop(str(m.get("column_id")), None)
            else:
                row[str(m.get("column_id"))] = m.get("marks")
            queued.add(str(m.get("student_id")))

    out = []
    for x in r.get("students") or []:
        row = {"id": x.get("id"), "index_number": x.get("index_number"), "name": x.get("name"),
               "marks": marks.get(str(x.get("id"))) or {}}
        if str(x.get("id")) in queued:
            row["pending"] = True
        out.append(row)

    return {
        "ok": True, "term": r.get("term"), "weights": r.get("weights"),
        # Columns are created on the desktop: a new one has to exist before
        # marks can hang off it, and inventing an id here would leave the
        # desktop with marks pointing at nothing.
        "can_add_columns": False,
        "columns": bucket.get("columns") or [], "students": out,
    }


# ── the broadsheet ──────────────────────────────────────────────────────────
def results_broadsheet(store, school_id, class_id, rec=None):
    r = _roster(store, school_id, class_id, rec)
    if not r:
        return {"ok": True, "term": None, "subjects": [], "students": []}
    subjects = r.get("subjects") or []
    if rec is not None:
        subjects = [sub for sub in subjects if in_scope_subject(rec, class_id, sub.get("id"))]
    summaries = r.get("summaries") or {}
    scores = r.get("scores") or {}

    out = []
    for x in r.get("students") or []:
        summary = summaries.get(str(x.get("id"))) or {}
        out.append({
            "id": x.get("id"), "index_number": x.get("index_number"), "name": x.get("name"),
            "scores": {str(sub.get("id")): (scores.get(str(sub.get("id"))) or {}).get(str(x.get("id")))
                       for sub in subjects},
            "total": summary.get("total_score_all"), "average": summary.get("average_score"),
            "rank": summary.get("class_rank"), "number_on_roll": summary.get("number_on_roll"),
        })
    return {"ok": True, "term": r.get("term"), "subjects": subjects, "students": out, "stale": True}


def student_report(store, school_id, student_id, rec=None):
    p = student_profile(store, school_id, student_id, rec)
    if not p.get("ok"):
        return p
    r = _roster(store, school_id, p["student"].get("class_id"), rec) if p["student"].get("class_id") else None
    return {
        "ok": True, "term": p.get("term"), "student": p.get("student"),
        "subjects": p.get("subjects"), "summary": p.get("summary"),
        "attendance": p.get("attendance"),
        "grading_bands": (r or {}).get("grading_bands") or [], "stale": True,
    }


# ── the canteen sheet ───────────────────────────────────────────────────────
def canteen_class(store, school_id, class_id, rec=None):
    if rec is not None and not is_class_teacher_of(rec, class_id):
        return {"ok": False, "status": 403, "error": "The canteen sheet belongs to the class teacher."}
    r = _roster(store, school_id, class_id, rec)
    if not r:
        return {"ok": True, "students": [], "totals": {"owing": 0, "amount": 0}}
    owed = r.get("canteen") or {}
    rows = []
    for x in r.get("students") or []:
        hit = owed.get(str(x.get("id"))) or {}
        rows.append({"id": x.get("id"), "index_number": x.get("index_number"), "name": x.get("name"),
                     "unpaid_days": hit.get("unpaid_days") or 0,
                     "amount_owed": hit.get("amount_owed") or 0, "today_status": None})
    return {
        "ok": True, "date": datetime.date.today().isoformat(),
        "daily_rate": r.get("daily_rate"), "term": r.get("term"), "students": rows,
        "totals": {"owing": len([x for x in rows if x["unpaid_days"] > 0]),
                   "amount": sum(x["amount_owed"] for x in rows)},
        "stale": True,
    }


def all_subjects(store, school_id, rec=None, class_id=None):
    if class_id:
        return score_subjects(store, school_id, class_id, rec)
    seen = {}
    for r in _all_rosters(store, school_id, rec):
        for sub in r.get("subjects") or []:
            seen.setdefault(sub.get("id"), sub)
    return {"ok": True, "subjects": sorted(seen.values(), key=lambda x: str(x.get("name") or ""))}


# ── the teacher's own employment ────────────────────────────────────────────
# One projection, keyed by user, so the cloud can only ever serve a teacher
# their own record. Queued work is merged in so a leave request filed on the bus
# shows as pending rather than vanishing until the school syncs.
def staff_profile(store, school_id, rec):
    p = _payload(store, school_id, "staff_profile", f"profile:user:{rec.get('user_id')}") or {}
    today = datetime.date.today().isoformat()

    attendance = [dict(a) for a in (p.get("attendance") or [])]
    for ch in _pending(store, school_id, ["staff_clock"]):
        q = ch.get("payload") or {}
        if q.get("user_id") != rec.get("user_id") or not q.get("date"):
            continue
        hit = next((a for a in attendance if a.get("date") == q["date"]), None)
        if hit:
            if q.get("direction") == "out":
                hit["clock_out"] = hit.get("clock_out") or q.get("at")
            else:
                hit["clock_in"] = hit.get("clock_in") or q.get("at")
            hit["pending"] = True
        else:
            attendance.insert(0, {
                "date": q["date"], "status": "present", "pending": True,
                "clock_in": None if q.get("direction") == "out" else q.get("at"),
                "clock_out": q.get("at") if q.get("direction") == "out" else None,
            })

    leave = [dict(x) for x in (p.get("leave") or [])]
    for ch in _pending(store, school_id, ["leave_request"]):
        q = ch.get("payload") or {}
        if q.get("user_id") != rec.get("user_id"):
            continue
        leave.insert(0, {"id": None, "leave_type": q.get("leave_type"),
                         "start_date": q.get("start_date"), "end_date": q.get("end_date"),
                         "days_requested": q.get("days_requested"),
                         "justification": q.get("justification"),
                         "status": "pending", "pending": True})

    return {
        "ok": True, "has_staff": bool(p.get("has_staff")), "staff": p.get("staff"),
        "designation": rec.get("designation"), "is_admin": bool(rec.get("is_admin")),
        "assignments": p.get("assignments") or [],
        "today": {"date": today,
                  "attendance": next((a for a in attendance if a.get("date") == today), None)},
        "attendance": attendance,
        "leave": {"pending": len([x for x in leave if x.get("status") == "pending"]),
                  "approved": len([x for x in leave if x.get("status") == "approved"])},
        "leave_requests": leave,
        "payslips": p.get("payslips") or [],
        "updated_at": p.get("updated_at"),
    }


def lesson_notes(store, school_id, rec):
    p = _payload(store, school_id, "staff_profile", f"profile:user:{rec.get('user_id')}") or {}
    notes = [dict(n) for n in (p.get("lesson_notes") or [])]
    for ch in _pending(store, school_id, ["lesson_note_save"]):
        q = ch.get("payload") or {}
        if q.get("user_id") != rec.get("user_id"):
            continue
        note = dict(q.get("note") or {}, id=q.get("local_id"), pending=True, queue_ref=q.get("uuid"))
        at = next((i for i, n in enumerate(notes)
                   if q.get("local_id") and str(n.get("id")) == str(q["local_id"])), None)
        # An edit queued for a note already projected replaces it in the list,
        # rather than showing the teacher two copies of the same lesson.
        if at is not None:
            notes[at] = dict(notes[at], **note)
        else:
            notes.insert(0, note)
    return {"ok": True, "has_staff": bool(p.get("has_staff")), "notes": notes}


def lesson_note(store, school_id, rec, note_id):
    notes = lesson_notes(store, school_id, rec)["notes"]
    hit = next((n for n in notes if str(n.get("id")) == str(note_id)), None)
    return {"ok": True, "note": hit} if hit else {"ok": False, "status": 404, "error": "Lesson note not found."}


# ── messages and notices ────────────────────────────────────────────────────
def staff_threads(store, school_id, rec):
    if not can(rec, "notifications", "view"):
        return {"ok": False, "status": 403, "error": "Access denied."}
    threads = []
    for row in store.list_snapshots(school_id, "message_thread"):
        t = row.get("payload") or {}
        if not t:
            continue
        msgs = t.get("messages") or []
        threads.append({
            "id": t.get("uuid"), "uuid": t.get("uuid"), "parent_id": t.get("parent_id"),
            "student_id": t.get("student_id"), "student_name": t.get("student_name"),
            "subject": t.get("subject"), "last_message_at": t.get("last_message_at"),
            "last_sender": t.get("last_sender"), "staff_unread": 0,
            "preview": str(msgs[-1].get("body"))[:120] if msgs else "",
        })
    threads.sort(key=lambda t: str(t.get("last_message_at") or ""), reverse=True)
    return {"ok": True, "threads": threads, "unread": 0, "stale": True}


def staff_thread(store, school_id, rec, uuid):
    if not can(rec, "notifications", "view"):
        return {"ok": False, "status": 403, "error": "Access denied."}
    t = _payload(store, school_id, "message_thread", f"thread:{uuid}")
    if not t:
        return {"ok": False, "status": 404, "error": "Conversation not found."}
    messages = list(t.get("messages") or [])
    for ch in _pending(store, school_id, ["message_reply"]):
        q = ch.get("payload") or {}
        if q.get("thread_uuid") != uuid:
            continue
        messages.append({"sender_type": "staff", "sender_name": q.get("sender_name") or "You",
                         "body": q.get("body"), "created_at": None, "pending": True})
    return {
        "ok": True,
        "thread": {"id": t.get("uuid"), "uuid": t.get("uuid"), "subject": t.get("subject"),
                   "student_name": t.get("student_name"), "parent_id": t.get("parent_id")},
        "messages": messages,
    }


def announcements(store, school_id, rec):
    if not can(rec, "notifications", "view"):
        return {"ok": False, "status": 403, "error": "Access denied."}
    rows = [r.get("payload") for r in store.list_snapshots(school_id, "announcement")]
    out = [a for a in rows if a and a.get("is_active") != 0]
    for ch in _pending(store, school_id, ["announcement_create"]):
        q = ch.get("payload") or {}
        out.insert(0, {"id": None, "title": q.get("title"), "body": q.get("body"),
                       "audience": q.get("audience"), "created_at": None, "pending": True})
    out.sort(key=lambda a: (0 if a.get("pending") else 1, str(a.get("created_at") or "")), reverse=False)
    return {"ok": True, "announcements": out}


# ── writes ──────────────────────────────────────────────────────────────────
# Each one appends to the change queue and returns immediately. Nothing here
# touches a read model: the desktop applies the change and re-projects, which
# is what keeps one implementation of "what marking a register means".

def _ref():
    return str(_uuid.uuid4())


def submit_attendance(store, school_id, rec, body):
    # The register belongs to the class teacher. Queueing a write the desktop
    # will drop tells the teacher their work is safe when it is not.
    class_id = body.get("classId")
    if class_id and not is_class_teacher_of(rec, class_id):
        return {"ok": False, "status": 403, "error": "That register belongs to another class teacher."}
    date = body.get("date")
    marks = body.get("marks")
    if not date or not isinstance(marks, list) or not marks:
        return {"ok": False, "status": 400, "error": "date and marks[] are required."}
    clean = []
    for m in marks:
        sid = _int(m.get("student_id"))
        if sid:
            clean.append({"student_id": sid, "status": m.get("status") or "present", "notes": m.get("notes")})
    if not clean:
        return {"ok": False, "status": 400, "error": "No valid marks."}
    store.enqueue_change(school_id, {"type": "attendance_mark", "payload": {
        "uuid": _ref(), "user_id": rec["user_id"], "date": date, "marks": clean}})
    return {"ok": True, "saved": len(clean), "queued": True}


def submit_scores(store, school_id, rec, body):
    subject_id = _int(body.get("subjectId"))
    class_id = body.get("classId")
    if class_id and not in_scope_subject(rec, class_id, subject_id):
        return {"ok": False, "status": 403, "error": "That subject is not one of yours in that class."}
    marks = body.get("marks")
    if not subject_id or not isinstance(marks, list):
        return {"ok": False, "status": 400, "error": "subjectId and marks[] are required."}
    clean = []
    for m in marks:
        sid = _int(m.get("student_id"))
        raw = m.get("exam_score")
        if not sid or raw is None or raw == "":
            continue
        try:
            v = float(raw)
        except (TypeError, ValueError):
            return {"ok": False, "status": 400, "error": "Exam scores must be between 0 and 100."}
        # Rejected here rather than silently dropped on the desktop, so the
        # teacher finds out while they are still looking at the sheet.
        if v < 0 or v > 100:
            return {"ok": False, "status": 400, "error": "Exam scores must be between 0 and 100."}
        clean.append({"student_id": sid, "exam_score": v})
    if not clean:
        return {"ok": False, "status": 400, "error": "No marks to save."}
    store.enqueue_change(school_id, {"type": "score_entry", "payload": {
        "uuid": _ref(), "user_id": rec["user_id"], "subject_id": subject_id, "marks": clean}})
    return {"ok": True, "saved": len(clean), "queued": True}


def submit_canteen(store, school_id, rec, body):
    sid = _int(body.get("student_id"))
    if not sid:
        return {"ok": False, "status": 400, "error": "student_id is required."}
    try:
        amount = float(body.get("amount"))
    except (TypeError, ValueError):
        amount = 0
    if amount <= 0:
        return {"ok": False, "status": 400, "error": "A positive amount is required."}
    # The uuid is what stops a redelivered change taking the money twice; the
    # desktop keeps a ledger of the ones it has applied.
    store.enqueue_change(school_id, {"type": "canteen_collect", "payload": {
        "uuid": _ref(), "user_id": rec["user_id"], "student_id": sid, "amount": amount,
        "payment_method": body.get("payment_method") or "Cash", "notes": body.get("notes") or ""}})
    # No receipt number: the desktop issues those, and inventing one here would
    # put a number on a parent's phone that the school's books do not have.
    return {"ok": True, "queued": True, "receipt_number": None}


def submit_homework(store, school_id, rec, body):
    class_id = _int(body.get("classId"))
    if class_id and not in_scope_class(rec, class_id):
        return {"ok": False, "status": 403, "error": "That class is not one of yours."}
    title = str(body.get("title") or "").strip()
    if not class_id or not title:
        return {"ok": False, "status": 400, "error": "Class and title are required."}
    max_marks = body.get("maxMarks")
    try:
        max_marks = None if max_marks in (None, "") else float(max_marks)
    except (TypeError, ValueError):
        max_marks = None
    store.enqueue_change(school_id, {"type": "homework_create", "payload": {
        "uuid": _ref(), "user_id": rec["user_id"], "class_id": class_id,
        "subject_id": body.get("subjectId"), "title": title,
        "description": body.get("description") or "", "due_date": body.get("dueDate"),
        "max_marks": max_marks}})
    return {"ok": True, "queued": True}


def submit_assessments(store, school_id, rec, body):
    cid = _int(body.get("classId"))
    sid = _int(body.get("subjectId"))
    if not cid or not sid:
        return {"ok": False, "status": 400, "error": "classId and subjectId are required."}
    if not in_scope_subject(rec, cid, sid):
        return {"ok": False, "status": 403, "error": "That subject is not one of yours in that class."}
    marks = body.get("marks")
    if not isinstance(marks, list) or not marks:
        return {"ok": False, "status": 400, "error": "No marks to save."}

    # The column's total is on the roster, so an impossible mark is caught while
    # the teacher is still looking at the sheet rather than dropped in silence a
    # day later when the desktop applies the change.
    r = _roster(store, school_id, cid, rec) or {}
    cols = {str(c.get("id")): c
            for c in (((r.get("assessments") or {}).get(str(sid)) or {}).get("columns") or [])}
    clean = []
    for m in marks:
        student = _int(m.get("student_id"))
        col = cols.get(str(m.get("column_id")))
        if not student or not col:
            continue
        raw = m.get("marks")
        if raw in (None, ""):
            clean.append({"student_id": student, "column_id": col.get("id"), "marks": None})
            continue
        try:
            v = float(raw)
        except (TypeError, ValueError):
            return {"ok": False, "status": 400, "error": "Marks must be a number."}
        if v < 0:
            return {"ok": False, "status": 400, "error": "Marks cannot be negative."}
        if v > (col.get("max_marks") or 0):
            return {"ok": False, "status": 400,
                    "error": f"A mark of {v} is above the {col.get('max_marks')} this assessment is out of."}
        clean.append({"student_id": student, "column_id": col.get("id"), "marks": v})
    if not clean:
        return {"ok": False, "status": 400, "error": "No marks to save."}

    store.enqueue_change(school_id, {"type": "assessment_entry", "payload": {
        "uuid": _ref(), "user_id": rec["user_id"], "class_id": cid, "subject_id": sid, "marks": clean}})
    return {"ok": True, "saved": len(clean), "queued": True}


def submit_remarks(store, school_id, rec, body):
    sid = _int(body.get("studentId"))
    if not sid:
        return {"ok": False, "status": 400, "error": "studentId is required."}
    snap = _payload(store, school_id, "student_snapshot", f"student:{sid}")
    if not snap:
        return {"ok": False, "status": 404, "error": "Student not found."}
    if not is_class_teacher_of(rec, snap.get("class_id")):
        return {"ok": False, "status": 403,
                "error": "Only the class teacher can write end-of-term remarks for this class."}
    trim = lambda v, n: None if v is None else str(v)[:n]
    store.enqueue_change(school_id, {"type": "term_remarks", "payload": {
        "uuid": _ref(), "user_id": rec["user_id"], "student_id": sid,
        "conduct": trim(body.get("conduct"), 500), "interests": trim(body.get("interests"), 500),
        "talents": trim(body.get("talents"), 500), "remarks": trim(body.get("remarks"), 1000)}})
    return {"ok": True, "queued": True}


_LESSON_FIELDS = [
    ("class_group_id", "classId"), ("subject_id", "subjectId"), ("week_number", "weekNumber"),
    ("lesson_date", "lessonDate"), ("duration_minutes", "durationMinutes"),
    ("topic", "topic"), ("sub_topic", "subTopic"), ("references_text", "references"),
    ("tlms", "tlms"), ("objectives", "objectives"), ("rpk", "rpk"),
    ("introduction", "introduction"), ("presentation", "presentation"), ("activity", "activity"),
    ("evaluation", "evaluation"), ("closure", "closure"), ("assignment", "assignment"),
    ("remarks", "remarks"),
]


def submit_lesson_note(store, school_id, rec, body):
    """A lesson note written on the way home.

    ``local_id`` is the desktop's own id when the note already exists there — an
    edit updates it rather than filing a second copy of the same lesson.
    """
    topic = str(body.get("topic") or "").strip()
    if not topic:
        return {"ok": False, "status": 400, "error": "A topic is required."}
    class_id = _int(body.get("classId")) or None
    if class_id and not in_scope_class(rec, class_id):
        return {"ok": False, "status": 403, "error": "That class is not one of yours."}

    note = {}
    for col, key in _LESSON_FIELDS:
        v = body.get(key)
        if col in ("class_group_id", "subject_id", "week_number", "duration_minutes"):
            note[col] = _int(v) or None
        else:
            note[col] = v or None
    note["topic"] = topic[:300]
    note["status"] = "submitted" if body.get("status") == "submitted" else "draft"

    store.enqueue_change(school_id, {"type": "lesson_note_save", "payload": {
        "uuid": _ref(), "user_id": rec["user_id"],
        "local_id": _int(body.get("id")) or None, "note": note}})
    return {"ok": True, "queued": True}


def submit_leave(store, school_id, rec, body):
    leave_type = body.get("leaveType")
    start, end = body.get("startDate"), body.get("endDate")
    justification = str(body.get("justification") or "").strip()
    if not leave_type or not start or not end:
        return {"ok": False, "status": 400, "error": "Leave type and both dates are required."}
    if not justification:
        return {"ok": False, "status": 400, "error": "A reason is required."}
    try:
        d1 = datetime.date.fromisoformat(str(start))
        d2 = datetime.date.fromisoformat(str(end))
    except ValueError:
        return {"ok": False, "status": 400, "error": "Those dates could not be read. Use YYYY-MM-DD."}
    if d2 < d1:
        return {"ok": False, "status": 400, "error": "The end date cannot be before the start date."}
    days = (d2 - d1).days + 1
    if days > 365:
        return {"ok": False, "status": 400, "error": "A single request cannot cover more than a year."}
    store.enqueue_change(school_id, {"type": "leave_request", "payload": {
        "uuid": _ref(), "user_id": rec["user_id"], "leave_type": str(leave_type)[:60],
        "start_date": start, "end_date": end, "days_requested": days,
        "justification": justification[:1000]}})
    return {"ok": True, "queued": True, "days_requested": days}


def submit_clock(store, school_id, rec, body):
    direction = "out" if body.get("direction") == "out" else "in"
    now = datetime.datetime.now()
    store.enqueue_change(school_id, {"type": "staff_clock", "payload": {
        "uuid": _ref(), "user_id": rec["user_id"], "direction": direction,
        "date": now.date().isoformat(), "at": now.strftime("%H:%M:%S")}})
    return {"ok": True, "queued": True}


def submit_message(store, school_id, rec, body):
    if not can(rec, "notifications", "create"):
        return {"ok": False, "status": 403, "error": "Access denied."}
    text = str(body.get("body") or "").strip()
    if not text:
        return {"ok": False, "status": 400, "error": "Type a message first."}
    # Starting a brand-new conversation needs a parent record the cloud does not
    # hold, so replying is what works off-LAN and the app says so.
    if not body.get("threadUuid") and not body.get("parentId"):
        return {"ok": False, "status": 400,
                "error": "Starting a new conversation needs the school's own system. "
                         "You can reply to any existing conversation from here."}
    store.enqueue_change(school_id, {"type": "message_reply", "payload": {
        "uuid": _ref(), "user_id": rec["user_id"], "sender_name": rec.get("full_name"),
        "thread_uuid": body.get("threadUuid"), "parent_id": body.get("parentId"),
        "student_id": body.get("studentId"), "subject": body.get("subject"), "body": text}})
    return {"ok": True, "queued": True}


def submit_announcement(store, school_id, rec, body):
    if not can(rec, "notifications", "edit"):
        return {"ok": False, "status": 403, "error": "You cannot post announcements."}
    if not body.get("title") or not body.get("body"):
        return {"ok": False, "status": 400, "error": "A title and a message are required."}
    store.enqueue_change(school_id, {"type": "announcement_create", "payload": {
        "uuid": _ref(), "user_id": rec["user_id"],
        "title": str(body["title"])[:200], "body": str(body["body"])[:4000],
        "audience": "student" if body.get("audience") == "student" else "all",
        "student_id": body.get("studentId")}})
    return {"ok": True, "queued": True}


def pending_summary(store, school_id, rec):
    """How much of a teacher's work is still waiting for the school's desktop.

    Shown on their account screen: "3 changes waiting to reach the school" is
    the difference between trusting the app and wondering whether it saved.
    """
    mine = [i for i in _pending(store, school_id, WRITE_TYPES)
            if (i.get("payload") or {}).get("user_id") == rec.get("user_id")]
    by_type = {}
    for i in mine:
        by_type[i["type"]] = by_type.get(i["type"], 0) + 1
    return {"ok": True, "pending": len(mine), "by_type": by_type}
