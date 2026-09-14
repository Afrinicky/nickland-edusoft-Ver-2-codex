"""Discounts and exemptions — two different things, kept apart on purpose.

A **discount** is a price. The school is a paying customer that pays less than
the list price, because it was negotiated, because it is a group, because it
paid a year up front. It belongs in revenue reporting as a discount against
gross.

An **exemption** is a decision not to charge at all. A pilot school, a mission
school, a partner, the founder's old school. It is not a 100% discount, and it
is emphatically not "set their price to zero" — that would make an exempt
school indistinguishable from a school on a free plan, and at the end of the
quarter it would sit in the same column as a school that simply has not paid
(§10, §27).

So they are separate tables, separate figures on every invoice, separate lines
in the revenue report, and the invoice of a fully exempt school is marked
EXEMPT rather than PAID — because nobody paid it, and pretending otherwise
makes the books wrong.

Both are audited on grant and on revocation, both can be made to expire, and a
discount can additionally be limited to a number of billing cycles.
"""
from . import audit as billing_audit
from .repo import now_iso, parse_iso


# ── Discounts ───────────────────────────────────────────────────────────────
def list_discounts(repo, school_id=None, active_only=False):
    where = {"school_id": school_id} if school_id else {}
    if active_only:
        where["is_active"] = True
    rows = repo.find("school_discounts", where, order_by="id", desc=True)
    return [with_state(row) for row in rows]


def grant_discount(store, repo, school_id, data, actor="platform"):
    kind = str(data.get("kind") or "percent").strip().lower()
    if kind not in ("percent", "fixed"):
        return {"ok": False, "status": 400, "error": "A discount is either a percentage or a fixed amount."}
    try:
        value = round(float(data.get("value")), 2)
    except (TypeError, ValueError):
        return {"ok": False, "status": 400, "error": "Enter the discount."}
    if value <= 0:
        return {"ok": False, "status": 400, "error": "A discount has to be more than nothing."}
    if kind == "percent" and value > 100:
        return {"ok": False, "status": 400, "error": "A percentage discount cannot be more than 100%."}

    cycles = data.get("cycles")
    cycles = None if cycles in (None, "", 0, "0") else int(cycles)
    if cycles is not None and cycles < 1:
        return {"ok": False, "status": 400, "error": "A discount runs for at least one billing cycle."}
    ends_at = _optional_date(data.get("ends_at"))
    starts_at = _optional_date(data.get("starts_at")) or now_iso()
    if ends_at and parse_iso(ends_at) <= parse_iso(starts_at):
        return {"ok": False, "status": 400, "error": "A discount cannot end before it starts."}

    row = repo.insert("school_discounts", {
        "school_id": school_id, "kind": kind, "value": value,
        "label": str(data.get("label") or "")[:120],
        "reason": str(data.get("reason") or "")[:400],
        "starts_at": starts_at, "ends_at": ends_at,
        "cycles": cycles, "cycles_used": 0, "is_active": True,
        "created_by": str(actor)[:120], "created_at": now_iso(),
    })
    billing_audit.write(store, "discount_granted", school_id=school_id, actor=actor,
                        detail=f"{school_id}: "
                               f"{value}{'%' if kind == 'percent' else ' fixed'} discount"
                               f"{f' for {cycles} cycle(s)' if cycles else ''}"
                               f"{f', until {ends_at[:10]}' if ends_at else ''}. "
                               f"{data.get('reason') or ''}".strip())
    return {"ok": True, "discount": with_state(row)}


def revoke_discount(store, repo, discount_id, actor="platform", reason=""):
    row = repo.get("school_discounts", discount_id)
    if not row:
        return {"ok": False, "status": 404, "error": "No such discount."}
    if not row.get("is_active"):
        return {"ok": True, "discount": with_state(row), "already": True}
    updated = repo.update("school_discounts", row["id"], {
        "is_active": False, "revoked_at": now_iso(), "revoked_by": str(actor)[:120],
        "reason": (row.get("reason") or "") + (f" | Revoked: {reason}" if reason else "")})
    billing_audit.write(store, "discount_revoked", school_id=row["school_id"], actor=actor,
                        detail=f"{row['school_id']}: discount withdrawn. {reason}".strip())
    return {"ok": True, "discount": with_state(updated)}


def consume_cycle(repo, discount_id):
    """Count one billing cycle against a discount that is limited to a number
    of them. Called by the invoice run, once per invoice actually raised — not
    once per quote, or a school looking at its own billing page would burn
    through a three-cycle discount by refreshing.
    """
    row = repo.get("school_discounts", discount_id) if discount_id else None
    if not row or row.get("cycles") is None:
        return row
    used = int(row.get("cycles_used") or 0) + 1
    patch = {"cycles_used": used}
    if used >= int(row["cycles"]):
        patch.update({"is_active": False, "revoked_at": now_iso(), "revoked_by": "system"})
    return repo.update("school_discounts", row["id"], patch)


# ── Exemptions ──────────────────────────────────────────────────────────────
def list_exemptions(repo, school_id=None, active_only=False):
    where = {"school_id": school_id} if school_id else {}
    if active_only:
        where["is_active"] = True
    rows = repo.find("payment_exemptions", where, order_by="id", desc=True)
    return [with_state(row) for row in rows]


def grant_exemption(store, repo, school_id, data, actor="platform"):
    try:
        percent = round(float(data.get("percent", 100)), 2)
    except (TypeError, ValueError):
        percent = 100.0
    if percent <= 0 or percent > 100:
        return {"ok": False, "status": 400, "error": "An exemption covers between 1% and 100% of the bill."}
    reason = str(data.get("reason") or "").strip()
    if not reason:
        # Required, and this is the one field in the platform that is. An
        # exemption is money the company has decided to forgo; six months later
        # somebody will ask why, and "nobody wrote it down" is not an answer.
        return {"ok": False, "status": 400,
                "error": "Say why this school is exempt — it goes on the record."}

    existing = repo.find_one("payment_exemptions",
                             {"school_id": school_id, "is_active": True})
    if existing:
        return {"ok": False, "status": 409,
                "error": "This school already has an exemption. Withdraw that one first.",
                "exemption_id": existing["id"]}

    ends_at = _optional_date(data.get("ends_at"))
    starts_at = _optional_date(data.get("starts_at")) or now_iso()
    if ends_at and parse_iso(ends_at) <= parse_iso(starts_at):
        return {"ok": False, "status": 400, "error": "An exemption cannot end before it starts."}

    row = repo.insert("payment_exemptions", {
        "school_id": school_id, "percent": percent, "reason": reason[:400],
        "starts_at": starts_at, "ends_at": ends_at, "is_active": True,
        "created_by": str(actor)[:120], "created_at": now_iso(),
    })
    billing_audit.write(store, "exemption_granted", school_id=school_id, actor=actor,
                        detail=f"{school_id}: {percent}% payment exemption"
                               f"{f' until {ends_at[:10]}' if ends_at else ' (no end date)'}. "
                               f"{reason}")
    return {"ok": True, "exemption": with_state(row)}


def revoke_exemption(store, repo, exemption_id, actor="platform", reason=""):
    row = repo.get("payment_exemptions", exemption_id)
    if not row:
        return {"ok": False, "status": 404, "error": "No such exemption."}
    if not row.get("is_active"):
        return {"ok": True, "exemption": with_state(row), "already": True}
    updated = repo.update("payment_exemptions", row["id"], {
        "is_active": False, "revoked_at": now_iso(), "revoked_by": str(actor)[:120],
        "reason": (row.get("reason") or "") + (f" | Withdrawn: {reason}" if reason else "")})
    billing_audit.write(store, "exemption_revoked", school_id=row["school_id"], actor=actor,
                        detail=f"{row['school_id']}: exemption withdrawn — the school is "
                               f"billed normally from now on. {reason}".strip())
    return {"ok": True, "exemption": with_state(updated)}


# ── Shared ──────────────────────────────────────────────────────────────────
def with_state(row):
    """A row plus the one thing every screen asks of it: is it working NOW.

    `is_active` alone is not that answer — a row can be active and not yet
    started, or active and expired — so the state is computed once here rather
    than in each of the four places that display one.
    """
    if not row:
        return row
    now = parse_iso(now_iso())
    starts = parse_iso(row.get("starts_at"))
    ends = parse_iso(row.get("ends_at"))
    if not row.get("is_active") or row.get("revoked_at"):
        state = "withdrawn"
    elif starts and now < starts:
        state = "scheduled"
    elif ends and now > ends:
        state = "expired"
    elif row.get("cycles") is not None and int(row.get("cycles_used") or 0) >= int(row["cycles"]):
        state = "used up"
    else:
        state = "in force"
    return {**row, "state": state, "in_force": state == "in force"}


def _optional_date(value):
    """A date from a form — `2026-12-31` or a full timestamp — or None.

    A bare date means the END of that day, not midnight at the start of it: an
    operator typing "until 31 December" means the school has December, and
    cutting them off at 00:00 on the 31st is a support call.
    """
    if value in (None, "", "null"):
        return None
    text = str(value).strip()
    if len(text) == 10:
        text += "T23:59:59+00:00"
    parsed = parse_iso(text)
    return parsed.isoformat() if parsed else None
