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

WRITE_TYPES = ["attendance_mark", "score_entry", "canteen_collect", "homework_create"]

_ACTION_KEY = {"view": "canView", "create": "canCreate", "edit": "canEdit", "delete": "canDelete"}


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


def _all_rosters(store, school_id):
    rows = [r.get("payload") for r in store.list_snapshots(school_id, "class_roster")]
    rows = [p for p in rows if p]
    return sorted(rows, key=lambda p: (p.get("level_order") or 0, str(p.get("name") or "")))


def _roster(store, school_id, class_id):
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


def students(store, school_id, class_id=None):
    out = []
    for r in _all_rosters(store, school_id):
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


def classes(store, school_id):
    return {"ok": True, "classes": [
        {"id": r.get("class_id"), "name": r.get("name"), "short_code": r.get("short_code")}
        for r in _all_rosters(store, school_id)
    ]}


def attendance_sheet(store, school_id, class_id, date):
    """The register for a class on a date: what the desktop last projected,
    with anything this school has queued since merged over the top."""
    r = _roster(store, school_id, class_id)
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


def score_subjects(store, school_id, class_id):
    r = _roster(store, school_id, class_id) or {}
    return {"ok": True, "subjects": r.get("subjects") or []}


def score_sheet(store, school_id, class_id, subject_id):
    r = _roster(store, school_id, class_id)
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


def canteen_student(store, school_id, student_id):
    """Canteen reads come from the parent-side student snapshot, which already
    carries the unpaid-day count — there is no second projection to keep in step."""
    s = _payload(store, school_id, "student_snapshot", f"student:{student_id}")
    if not s:
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


def homework_for_class(store, school_id, class_id):
    r = _roster(store, school_id, class_id) or {}
    out = list(r.get("homework") or [])
    for ch in _pending(store, school_id, ["homework_create"]):
        p = ch.get("payload") or {}
        if str(p.get("class_id")) != str(class_id):
            continue
        out.insert(0, {"id": None, "title": p.get("title"), "description": p.get("description"),
                       "due_date": p.get("due_date"), "max_marks": p.get("max_marks"), "pending": True})
    return {"ok": True, "homework": out}


# ── writes ──────────────────────────────────────────────────────────────────
# Each one appends to the change queue and returns immediately. Nothing here
# touches a read model: the desktop applies the change and re-projects, which
# is what keeps one implementation of "what marking a register means".

def _ref():
    return str(_uuid.uuid4())


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def submit_attendance(store, school_id, rec, body):
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
