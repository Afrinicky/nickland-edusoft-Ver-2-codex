"""The finance office and the administration, off-LAN.

The Python twin of ``cloud/src/office.js``, endpoint for endpoint and shape for
shape, so the same app build works against either service.

Reads come from two projections the desktop pushes — ``finance_summary`` and
``admin_summary`` (see electron/server/sync/office_projection.js). They are
summaries, not the ledger.

Writes are only the two that move no money: approving leave and signing off a
lesson note. Both are queued for the desktop and applied there.

Taking money is not here. Recording a fee payment posts to the ledger, consumes
a receipt number and prints a receipt — none of which can happen with the
school's machine off, and a "payment" that sits in a queue until Monday is not
a receipt a parent can be shown.

The system portal is not here either. Accounts, access levels and the audit
trail are administered where the system is.
"""
import datetime

_ACTION_KEY = {"view": "canView", "create": "canCreate", "edit": "canEdit", "delete": "canDelete"}

# The two writes this surface accepts, and the only ones the desktop takes from it.
OFFICE_WRITE_TYPES = ["leave_decision", "lesson_note_decision"]


def can(rec, module, action):
    if not rec:
        return False
    if rec.get("is_admin"):
        return True
    p = (rec.get("permissions") or {}).get(module)
    return bool(p and p.get(_ACTION_KEY[action]))


def _payload(store, sid, entity_type, key):
    for row in store.list_snapshots(sid, entity_type):
        if row.get("entity_key") == key:
            return row.get("payload")
    return None


def _pending(store, sid, types):
    if not hasattr(store, "pending_changes"):
        return []
    try:
        return store.pending_changes(sid, types=types)
    except Exception:                                   # pragma: no cover
        return []


# ── Finance ─────────────────────────────────────────────────────────────────

def finance_overview(store, sid, rec):
    if not (can(rec, "fees", "view") or can(rec, "finance", "view") or can(rec, "payroll", "view")):
        return {"ok": False, "status": 403, "error": "Access denied."}
    s = _payload(store, sid, "finance_summary", "finance:school")
    out = {
        "ok": True, "mode": "cloud",
        "term": s.get("term") if s else None,
        "currency": (s or {}).get("currency") or "GHS",
        "updated_at": (s or {}).get("updated_at"),
        # Everything here was true when the school last synchronised. Saying so
        # is the difference between a stale figure and a wrong one.
        "stale": s is None,
        "may": {
            "fees": can(rec, "fees", "view"),
            "finance": can(rec, "finance", "view"),
            "payroll": can(rec, "payroll", "view"),
            # Off-LAN nobody may take money, however the school granted fees.
            "record_payment": False,
        },
        "record_payment_is_host_only": True,
    }
    if not s:
        return out
    # Each section is dropped, not zeroed. A head teacher without `finance` is
    # shown a school with no expenditure section, not one that spent nothing.
    if can(rec, "fees", "view"):
        out["fees"] = s.get("fees")
        out["recent"] = s.get("recent") or []
        out["top_debtors"] = s.get("top_debtors") or []
    if can(rec, "finance", "view"):
        out["ledger"] = s.get("ledger")
        out["expense_categories"] = s.get("expense_categories") or []
    if can(rec, "payroll", "view"):
        out["payroll"] = s.get("payroll")
    return out


def finance_debtors(store, sid, rec):
    if not can(rec, "fees", "view"):
        return {"ok": False, "status": 403, "error": "Access denied."}
    d = _payload(store, sid, "debtor_list", "debtors:school")
    s = _payload(store, sid, "finance_summary", "finance:school")
    rows = (d or {}).get("debtors") or []
    return {
        "ok": True,
        "term": (s or {}).get("term"),
        "debtors": rows,
        "by_class": (s or {}).get("debtors_by_class") or [],
        "total": sum(float(r.get("balance") or 0) for r in rows),
        "updated_at": (d or {}).get("updated_at"),
    }


# ── Administration ──────────────────────────────────────────────────────────

def admin_overview(store, sid, rec):
    s = _payload(store, sid, "admin_summary", "admin:school")
    out = {
        "ok": True, "mode": "cloud",
        "term": (s or {}).get("term"),
        "date": (s or {}).get("date"),
        "updated_at": (s or {}).get("updated_at"),
        "stale": s is None,
        "may": {
            "students": can(rec, "students", "view"), "staff": can(rec, "staff", "view"),
            "academics": can(rec, "academics", "view"), "fees": can(rec, "fees", "view"),
            "notifications": can(rec, "notifications", "view"),
        },
        # Admitting a pupil writes an admission number the desktop issues, so it
        # is not something to queue from a phone: two offices admitting at once
        # off-LAN would both be handed the same number.
        "admissions_are_host_only": True,
    }
    if not s:
        return out
    if can(rec, "students", "view"):
        out["enrolment"] = s.get("enrolment")
        out["by_class"] = s.get("by_class") or []
        out["attendance"] = s.get("attendance")
    if can(rec, "staff", "view"):
        out["staff"] = s.get("staff")
        out["approvals"] = {**out.get("approvals", {}), "leave": (s.get("approvals") or {}).get("leave", 0)}
    if can(rec, "academics", "view"):
        out["classes"] = s.get("classes") or []
        out["approvals"] = {**out.get("approvals", {}),
                            "lesson_notes": (s.get("approvals") or {}).get("lesson_notes", 0)}
    if can(rec, "fees", "view"):
        out["fees"] = s.get("fees")
    return out


def approvals(store, sid, rec):
    """What is waiting for a decision, with anything already decided off-LAN
    removed — otherwise a head teacher approving leave on the bus would watch
    the same request sit in the list until the school opened on Monday."""
    s = _payload(store, sid, "admin_summary", "admin:school")
    decided = set()
    for ch in _pending(store, sid, OFFICE_WRITE_TYPES):
        decided.add(f"{ch.get('type')}:{(ch.get('payload') or {}).get('id')}")
    out = {"ok": True, "leave": [], "lesson_notes": [], "updated_at": (s or {}).get("updated_at")}
    if not s:
        return out
    if can(rec, "staff", "view"):
        out["leave"] = [r for r in (s.get("pending_leave") or [])
                        if f"leave_decision:{r.get('id')}" not in decided]
    if can(rec, "academics", "view"):
        out["lesson_notes"] = [r for r in (s.get("pending_lesson_notes") or [])
                               if f"lesson_note_decision:{r.get('id')}" not in decided]
    out["may_decide"] = {
        "leave": can(rec, "staff", "edit"),
        "lesson_notes": can(rec, "academics", "edit"),
    }
    return out


def submit_decision(store, sid, rec, kind, body):
    module = "staff" if kind == "leave" else "academics"
    if not can(rec, module, "edit"):
        return {"ok": False, "status": 403, "error": "Access denied."}
    try:
        row_id = int(body.get("id"))
    except (TypeError, ValueError):
        return {"ok": False, "status": 400, "error": "Which one?"}
    decision = str(body.get("decision") or "")
    if decision not in ("approved", "rejected"):
        return {"ok": False, "status": 400, "error": "Approve it or reject it."}
    store.enqueue_change(sid, {
        "type": "leave_decision" if kind == "leave" else "lesson_note_decision",
        "payload": {
            "id": row_id, "decision": decision,
            "notes": str(body.get("notes") or "")[:500],
            # The desktop re-checks this account's live permissions before it
            # applies anything; the id travels so it knows whose decision it was.
            "user_id": rec.get("user_id"),
            "decided_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        },
    })
    return {"ok": True, "queued": True}
