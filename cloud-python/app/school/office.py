"""The last of the office: staff activities, budgets and the cashbook.

Three things the desktop has had since the first release and the app could not
reach at all, because they lived behind IPC handlers on one PC.

  * **Staff activities** — what a member of staff did beyond their timetable:
    the club they run, the Saturday they gave to an inter-schools match, the
    duty they covered. Schools use it to argue for allowances and to write end
    of year reports, and it is worth nothing if only the head can enter it.
  * **Budgets** — what the school PLANNED to spend, against what it did. A
    statement says what happened; a budget says whether that was the intention.
  * **Cashbook** — income and expenditure on one page, in date order, with a
    running balance. The oldest financial document there is, and the one an
    auditor asks for first.

The cashbook is a READ, computed from the two ledgers rather than stored: a
third table that has to agree with two others is a third table that will not.
"""
import datetime

from . import security


def _round2(v):
    return round(float(v or 0), 2)


# ── staff activities ────────────────────────────────────────────────────────

ACTIVITY_FIELDS = ["staff_id", "activity_date", "activity_type", "title", "description",
                   "duration_minutes", "location", "related_class_id", "hours_contributed"]


def activities(db, actor, staff_id=None, date_from=None, date_to=None):
    """What staff have done beyond the timetable.

    A person may always read their OWN activities; reading anybody else's needs
    the staff module, because it is a record about a colleague.
    """
    mine_only = not security.can(actor, "staff", "view")
    sql = """
      SELECT sa.*, TRIM(COALESCE(s.surname,'') || ' ' || COALESCE(s.first_name,'')) AS staff_name,
             c.name AS class_name, u.full_name AS acknowledged_by_name
        FROM staff_activities sa
        LEFT JOIN staff s ON s.id = sa.staff_id
        LEFT JOIN class_groups c ON c.id = sa.related_class_id
        LEFT JOIN users u ON u.id = sa.acknowledged_by
       WHERE 1=1"""
    params = []
    if mine_only:
        if not actor.get("staff_id"):
            return {"ok": True, "activities": [], "may_acknowledge": False, "mine_only": True}
        sql += " AND sa.staff_id = %s"; params.append(actor["staff_id"])
    elif staff_id:
        sql += " AND sa.staff_id = %s"; params.append(staff_id)
    if date_from:
        sql += " AND sa.activity_date >= %s"; params.append(date_from)
    if date_to:
        sql += " AND sa.activity_date <= %s"; params.append(date_to)
    sql += " ORDER BY sa.activity_date DESC, sa.id DESC LIMIT 400"
    return {"ok": True, "activities": db.all(sql, tuple(params)),
            "may_acknowledge": security.can(actor, "staff", "edit"),
            "mine_only": mine_only}


def save_activity(db, actor, data):
    row = {k: (data.get(k) if data.get(k) != "" else None) for k in ACTIVITY_FIELDS if k in (data or {})}
    # Somebody without the staff module may only ever file their own.
    if not security.can(actor, "staff", "edit"):
        if not actor.get("staff_id"):
            return {"ok": False, "status": 403, "error": "Your account has no staff record to file against."}
        row["staff_id"] = actor["staff_id"]
    if not row.get("staff_id"):
        return {"ok": False, "status": 400, "error": "Whose activity is this?"}
    if not str(row.get("title") or "").strip():
        return {"ok": False, "status": 400, "error": "Give the activity a title."}
    row.setdefault("activity_date", datetime.date.today().isoformat())
    row.setdefault("activity_type", "other")

    activity_id = (data or {}).get("id")
    if activity_id:
        existing = db.one("SELECT staff_id FROM staff_activities WHERE id = %s", (activity_id,))
        if not existing:
            return {"ok": False, "status": 404, "error": "No such activity."}
        if not security.can(actor, "staff", "edit") and existing["staff_id"] != actor.get("staff_id"):
            return {"ok": False, "status": 403, "error": "That is not your activity."}
        sets = ", ".join(f'"{k}" = %s' for k in row)
        db.run(f"UPDATE staff_activities SET {sets} WHERE id = %s", tuple(row.values()) + (activity_id,))
    else:
        activity_id = db.insert("staff_activities", row)
    return {"ok": True, "id": activity_id}


def acknowledge_activity(db, actor, activity_id):
    """A supervisor has seen it. That is the whole of the workflow, on purpose —
    an activity log with an approve/reject cycle becomes a thing nobody fills in."""
    if not security.can(actor, "staff", "edit"):
        return {"ok": False, "status": 403, "error": "Only a supervisor may acknowledge an activity."}
    db.run("""UPDATE staff_activities SET acknowledged_by = %s, acknowledged_at = %s
               WHERE id = %s""",
           (actor["user_id"],
            datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
            activity_id))
    return {"ok": True}


def delete_activity(db, actor, activity_id):
    existing = db.one("SELECT staff_id FROM staff_activities WHERE id = %s", (activity_id,))
    if not existing:
        return {"ok": False, "status": 404, "error": "No such activity."}
    if not security.can(actor, "staff", "delete") and existing["staff_id"] != actor.get("staff_id"):
        return {"ok": False, "status": 403, "error": "That is not your activity."}
    db.run("DELETE FROM staff_activities WHERE id = %s", (activity_id,))
    return {"ok": True}


# ── budgets ─────────────────────────────────────────────────────────────────

def budgets(db, actor, budget_id=None):
    if budget_id:
        b = db.one("""SELECT b.*, t.label AS term_label, y.label AS year_label
                        FROM budgets b
                        LEFT JOIN terms t ON t.id = b.term_id
                        LEFT JOIN academic_years y ON y.id = b.academic_year_id
                       WHERE b.id = %s""", (budget_id,))
        if not b:
            return {"ok": False, "status": 404, "error": "No such budget."}
        b["items"] = db.all("""SELECT * FROM budget_items WHERE budget_id = %s
                                ORDER BY item_type, display_order, id""", (budget_id,))
        return {"ok": True, "budget": b, "may_edit": security.can(actor, "finance", "edit")}

    rows = db.all("""
      SELECT b.*, t.label AS term_label,
             (SELECT COALESCE(SUM(projected_amount),0) FROM budget_items
               WHERE budget_id = b.id AND item_type = 'expense') AS planned_expense,
             (SELECT COALESCE(SUM(projected_amount),0) FROM budget_items
               WHERE budget_id = b.id AND item_type = 'income') AS planned_income,
             (SELECT COALESCE(SUM(actual_amount),0) FROM budget_items
               WHERE budget_id = b.id AND item_type = 'expense') AS actual_expense
        FROM budgets b
        LEFT JOIN terms t ON t.id = b.term_id
       ORDER BY b.id DESC""")
    return {"ok": True, "budgets": rows, "may_edit": security.can(actor, "finance", "edit")}


def save_budget(db, actor, data):
    title = str((data or {}).get("title") or "").strip()
    if not title:
        return {"ok": False, "status": 400, "error": "Give the budget a title."}
    row = {
        "title": title,
        "budget_type": data.get("budget_type") or "term",
        "term_id": data.get("term_id") or None,
        "academic_year_id": data.get("academic_year_id") or None,
        "period_label": data.get("period_label") or None,
        "start_date": data.get("start_date") or None,
        "end_date": data.get("end_date") or None,
        "notes": data.get("notes") or None,
        "status": data.get("status") or "draft",
    }
    budget_id = data.get("id")
    items = data.get("items")
    with db.tx() as tx:
        if budget_id:
            sets = ", ".join(f'"{k}" = %s' for k in row)
            tx.run(f"UPDATE budgets SET {sets} WHERE id = %s", tuple(row.values()) + (budget_id,))
        else:
            row["created_by"] = actor["user_id"]
            budget_id = tx.insert("budgets", row)
        # Items are replaced wholesale when they are sent at all, so what is
        # stored is what the screen showed. Omitting them leaves them alone,
        # which is how the heading is renamed without touching the lines.
        if items is not None:
            tx.run("DELETE FROM budget_items WHERE budget_id = %s", (budget_id,))
            for n, item in enumerate(items):
                tx.run("""INSERT INTO budget_items
                            (budget_id, item_type, category, description,
                             projected_amount, actual_amount, notes, display_order)
                          VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                       (budget_id, item.get("item_type") or "expense",
                        str(item.get("category") or "")[:80],
                        str(item.get("description") or "")[:200],
                        _round2(item.get("projected_amount")),
                        _round2(item.get("actual_amount")),
                        item.get("notes"), n))
    security.audit(db, actor, "budget", budget_id, "save_budget", title)
    return {"ok": True, "id": budget_id}


def delete_budget(db, actor, budget_id):
    b = db.one("SELECT id, title FROM budgets WHERE id = %s", (budget_id,))
    if not b:
        return {"ok": False, "status": 404, "error": "No such budget."}
    with db.tx() as tx:
        tx.run("DELETE FROM budget_items WHERE budget_id = %s", (budget_id,))
        tx.run("DELETE FROM budgets WHERE id = %s", (budget_id,))
    security.audit(db, actor, "budget", budget_id, "delete_budget", b["title"], "high")
    return {"ok": True}


# ── the cashbook ────────────────────────────────────────────────────────────

def cashbook(db, actor, date_from=None, date_to=None):
    """Income and expenditure on one page, in date order, with a running balance.

    Computed rather than stored. A cashbook table would have to agree with the
    income and expense ledgers on every row forever, and the first time it did
    not, three people would spend a morning finding out which one was lying.
    """
    term = db.one("SELECT id, start_date, end_date FROM terms WHERE is_current = 1")
    date_from = date_from or (term["start_date"] if term else "1970-01-01")
    date_to = date_to or (term["end_date"] if term else "2099-12-31")

    income = db.all("""
      SELECT ir.transaction_date AS date, ir.category, ir.description,
             ir.amount, COALESCE(ir.receipt_number, ir.reference) AS reference, 'income' AS kind
        FROM income_records ir
       WHERE ir.transaction_date BETWEEN %s AND %s""", (date_from, date_to))
    expense = db.all("""
      SELECT er.transaction_date AS date, er.category, er.description,
             er.amount, er.transaction_number AS reference, 'expense' AS kind
        FROM expense_records er
       WHERE er.transaction_date BETWEEN %s AND %s""", (date_from, date_to))

    rows = sorted(income + expense, key=lambda r: (str(r["date"] or ""), r["kind"]))
    balance = 0.0
    for r in rows:
        amount = _round2(r["amount"])
        balance += amount if r["kind"] == "income" else -amount
        r["amount"] = amount
        r["balance"] = _round2(balance)

    total_in = _round2(sum(r["amount"] for r in rows if r["kind"] == "income"))
    total_out = _round2(sum(r["amount"] for r in rows if r["kind"] == "expense"))
    return {
        "ok": True, "from": date_from, "to": date_to, "entries": rows,
        "total_in": total_in, "total_out": total_out,
        "closing_balance": _round2(total_in - total_out),
    }
