"""Income, expenditure and the statement — a translation of ``electron/ipc/finance.js``.

The books, read and written. Everything that posts money goes through
``app/school/ledger.py``, which is the offline system's ``_ledger.js``: fees
posted from the fees screen and income recorded here land in the same table by
the same route, which is what stops a school's accounts being the sum of two
different ideas of what a receipt is.

One rule of the offline system is kept and worth naming: an account that may
only RECORD an expense does not approve it. Approving your own expenditure is
how a school's books stop meaning anything, so ``approved_by`` is set only when
the person also holds ``finance: edit``.
"""
import datetime

from . import ledger, security
from .billing import round2

INCOME_CATEGORIES = ["fees", "canteen", "books", "transport", "donation", "grant",
                     "rent", "sale", "other"]
EXPENSE_CATEGORIES = ["salary", "supplies", "canteen_supplies", "utilities", "rent",
                      "maintenance", "construction", "transport", "training",
                      "statutory", "refund", "other"]


def _today():
    return datetime.date.today().isoformat()


def _window(db, date_from=None, date_to=None):
    term = db.one("SELECT * FROM terms WHERE is_current = 1")
    return (date_from or (term["start_date"] if term else "1970-01-01"),
            date_to or (term["end_date"] if term else "2099-12-31"),
            term)


def income(db, actor, date_from=None, date_to=None, category=None, limit=400):
    date_from, date_to, _ = _window(db, date_from, date_to)
    sql = """
      SELECT ir.id, ir.receipt_number, ir.category, ir.subcategory, ir.amount, ir.payer_name,
             ir.description, ir.payment_method, ir.reference, ir.is_auto,
             COALESCE(ir.transaction_date, ir.date) AS date, u.full_name AS recorded_by_name
        FROM income_records ir LEFT JOIN users u ON u.id = ir.recorded_by
       WHERE COALESCE(ir.transaction_date, ir.date) BETWEEN %s AND %s
    """
    params = [date_from, date_to]
    if category:
        sql += " AND ir.category = %s"
        params.append(category)
    sql += " ORDER BY date DESC, ir.id DESC LIMIT %s"
    params.append(min(int(limit or 400), 1000))
    rows = db.all(sql, tuple(params))
    return {
        "ok": True, "from": date_from, "to": date_to, "records": rows,
        "total": round2(sum(r["amount"] or 0 for r in rows)),
        "may_record": security.can(actor, "finance", "create"),
        "categories": db.all("""
          SELECT category, COALESCE(SUM(amount),0) AS total, count(*) AS n FROM income_records
           WHERE COALESCE(transaction_date, date) BETWEEN %s AND %s
           GROUP BY category ORDER BY total DESC""", (date_from, date_to)),
    }


def record_income(db, actor, data):
    amount = round2(data.get("amount"))
    category = str(data.get("category") or "").strip()
    if not category:
        return {"ok": False, "status": 400, "error": "Choose what the money is for."}
    if amount <= 0:
        return {"ok": False, "status": 400, "error": "Enter an amount greater than zero."}
    with db.tx() as tx:
        row_id = ledger.post_income(tx, {
            "category": category, "subcategory": data.get("subcategory"), "amount": amount,
            "payer_name": data.get("payer_name") or data.get("payer"),
            "description": data.get("description"),
            "payment_method": data.get("payment_method") or data.get("method") or "Cash",
            "reference": data.get("reference"), "date": data.get("date") or _today(),
            "source": "manual", "recorded_by": actor["user_id"],
        })
    security.audit(db, actor, "income", row_id, "record_income", f"{category} {amount}")
    return {"ok": True, "id": row_id}


def expenses(db, actor, date_from=None, date_to=None, category=None, limit=400):
    date_from, date_to, _ = _window(db, date_from, date_to)
    sql = """
      SELECT er.id, er.transaction_number, er.category, er.subcategory, er.amount,
             er.payee_name, er.description, er.payment_method, er.reference, er.is_auto,
             COALESCE(er.transaction_date, er.date) AS date,
             u.full_name AS approved_by_name, ru.full_name AS recorded_by_name
        FROM expense_records er
        LEFT JOIN users u ON u.id = er.approved_by
        LEFT JOIN users ru ON ru.id = er.recorded_by
       WHERE COALESCE(er.transaction_date, er.date) BETWEEN %s AND %s
    """
    params = [date_from, date_to]
    if category:
        sql += " AND er.category = %s"
        params.append(category)
    sql += " ORDER BY date DESC, er.id DESC LIMIT %s"
    params.append(min(int(limit or 400), 1000))
    rows = db.all(sql, tuple(params))
    return {
        "ok": True, "from": date_from, "to": date_to, "records": rows,
        "total": round2(sum(r["amount"] or 0 for r in rows)),
        "may_record": security.can(actor, "finance", "create"),
        "unapproved": sum(1 for r in rows if not r["approved_by_name"]),
        "categories": db.all("""
          SELECT category, COALESCE(SUM(amount),0) AS total, count(*) AS n FROM expense_records
           WHERE COALESCE(transaction_date, date) BETWEEN %s AND %s
           GROUP BY category ORDER BY total DESC""", (date_from, date_to)),
    }


def record_expense(db, actor, data):
    amount = round2(data.get("amount"))
    category = str(data.get("category") or "").strip()
    description = str(data.get("description") or "").strip()
    if not category:
        return {"ok": False, "status": 400, "error": "Choose what the money was spent on."}
    if not description:
        return {"ok": False, "status": 400, "error": "Say what the payment was for."}
    if amount <= 0:
        return {"ok": False, "status": 400, "error": "Enter an amount greater than zero."}

    with db.tx() as tx:
        row_id = ledger.post_expense(tx, {
            "transaction_number": ledger.next_counter(tx, "transaction_counter", "TX"),
            "category": category, "subcategory": data.get("subcategory"), "amount": amount,
            "payee_name": data.get("payee_name") or data.get("payee"),
            "description": description,
            "payment_method": data.get("payment_method") or data.get("method") or "Cash",
            "reference": data.get("reference"), "date": data.get("date") or _today(),
            "recorded_by": actor["user_id"],
            # NOBODY approves their own expenditure — not even an account that
            # holds `finance: manage`, and not even the Super Admin.
            #
            # The desktop lets the person recording an expense sign it off in
            # the same act, because the desktop is one machine in one office
            # where the bursar and the head are the same two people all day.
            # Online it is two acts by two accounts, which is the ordinary
            # separation of duties every school's auditor asks about, and it
            # costs one tap.
            "approved_by": None,
        })
    security.audit(db, actor, "expense", row_id, "record_expense",
                   f"{category} {amount} — {description}")
    return {"ok": True, "id": row_id, "approved": False,
            "message": "Recorded. Somebody else has to approve it."}


def approve_expense(db, actor, expense_id):
    if not security.can(actor, "finance", "edit"):
        return {"ok": False, "status": 403, "error": "You may not approve expenditure."}
    row = db.one("SELECT id, recorded_by, approved_by, amount, description FROM expense_records WHERE id = %s",
                 (expense_id,))
    if not row:
        return {"ok": False, "status": 404, "error": "No such expense."}
    if row["approved_by"]:
        return {"ok": False, "status": 400, "error": "That expense is already approved."}
    if row["recorded_by"] == actor["user_id"]:
        return {"ok": False, "status": 400,
                "error": "Somebody other than the person who recorded it has to approve it."}
    db.run("UPDATE expense_records SET approved_by = %s WHERE id = %s", (actor["user_id"], expense_id))
    security.audit(db, actor, "expense", expense_id, "approve_expense",
                   f'{row["amount"]} — {row["description"]}', "high")
    return {"ok": True}


def statement(db, actor, term_id=None, date_from=None, date_to=None):
    """Income against expenditure, by category and by month."""
    term = db.one("SELECT * FROM terms WHERE id = %s", (term_id,)) if term_id else None
    if term:
        date_from = date_from or term["start_date"]
        date_to = date_to or term["end_date"]
    date_from, date_to, current = _window(db, date_from, date_to)
    term = term or current

    income_rows = db.all("""
      SELECT category, COALESCE(SUM(amount),0) AS total, count(*) AS n FROM income_records
       WHERE COALESCE(transaction_date, date) BETWEEN %s AND %s
       GROUP BY category ORDER BY total DESC""", (date_from, date_to))
    expense_rows = db.all("""
      SELECT category, COALESCE(SUM(amount),0) AS total, count(*) AS n FROM expense_records
       WHERE COALESCE(transaction_date, date) BETWEEN %s AND %s
       GROUP BY category ORDER BY total DESC""", (date_from, date_to))
    monthly = db.all("""
      SELECT ym, COALESCE(SUM(inc),0) AS income, COALESCE(SUM(exp),0) AS expense FROM (
        SELECT left(COALESCE(transaction_date, date), 7) AS ym, amount AS inc, 0 AS exp
          FROM income_records WHERE COALESCE(transaction_date, date) BETWEEN %s AND %s
        UNION ALL
        SELECT left(COALESCE(transaction_date, date), 7) AS ym, 0 AS inc, amount AS exp
          FROM expense_records WHERE COALESCE(transaction_date, date) BETWEEN %s AND %s
      ) x GROUP BY ym ORDER BY ym""", (date_from, date_to, date_from, date_to))

    total_income = round2(sum(r["total"] or 0 for r in income_rows))
    total_expense = round2(sum(r["total"] or 0 for r in expense_rows))
    return {
        "ok": True, "from": date_from, "to": date_to,
        "term": {"id": term["id"], "label": term["label"]} if term else None,
        "income": income_rows, "expense": expense_rows, "monthly": monthly,
        "totals": {"income": total_income, "expense": total_expense,
                   "net": round2(total_income - total_expense)},
        "school": {"name": db.get_setting("school_name", "School"),
                   "currency": db.get_setting("payment_currency", "GHS")},
    }


def audit_checks(db, actor, term_id=None):
    """The finance audit — what does not add up.

    A translation of the checks the offline Finance → Audit tab runs. Each one
    is a question a bursar would be asked by an auditor, answered by comparing
    two tables that ought to agree.
    """
    term = (db.one("SELECT * FROM terms WHERE id = %s", (term_id,)) if term_id
            else db.one("SELECT * FROM terms WHERE is_current = 1"))
    findings = []

    if term:
        # Every fee payment should have posted income against it.
        missing = db.value("""
          SELECT count(*) FROM payments p
           WHERE p.term_id = %s AND p.is_reversed = 0
             AND NOT EXISTS (SELECT 1 FROM income_records i WHERE i.linked_payment_id = p.id)""",
                           (term["id"],), 0)
        if missing:
            findings.append({
                "severity": "high", "check": "fees_not_in_ledger",
                "title": "Fee payments with no income entry",
                "detail": f"{missing} payment(s) this term were recorded without posting to the books.",
                "count": missing,
            })

        # And no income entry should claim a payment that was reversed.
        orphaned = db.value("""
          SELECT count(*) FROM income_records i JOIN payments p ON p.id = i.linked_payment_id
           WHERE p.is_reversed = 1
             AND NOT EXISTS (SELECT 1 FROM expense_records e
                              WHERE e.category = 'refund' AND e.reference = p.receipt_number)""",
                            (), 0)
        if orphaned:
            findings.append({
                "severity": "high", "check": "reversal_not_in_ledger",
                "title": "Reversed payments still counted as income",
                "detail": f"{orphaned} reversed payment(s) have no matching refund entry.",
                "count": orphaned,
            })

        # A bill whose stored balance disagrees with its own arithmetic.
        drifted = db.value("""
          SELECT count(*) FROM student_bills
           WHERE term_id = %s AND COALESCE(status,'active') = 'active'
             AND abs(balance - (total_billed - total_paid)) > 0.01""", (term["id"],), 0)
        if drifted:
            findings.append({
                "severity": "high", "check": "bill_balance_drift",
                "title": "Bills whose balance does not match their own figures",
                "detail": f"{drifted} bill(s) need regenerating.", "count": drifted,
            })

    # Salaries marked paid with no expense behind them.
    unposted = db.value("""
      SELECT count(*) FROM staff_salaries s
       WHERE s.is_paid = 1
         AND NOT EXISTS (SELECT 1 FROM expense_records e WHERE e.linked_salary_id = s.id)""", (), 0)
    if unposted:
        findings.append({
            "severity": "high", "check": "salary_not_in_ledger",
            "title": "Salaries marked paid with no expense recorded",
            "detail": f"{unposted} salary row(s) report money paid that the books do not show.",
            "count": unposted,
        })

    # Expenditure nobody has signed off.
    unapproved = db.value(
        "SELECT count(*) FROM expense_records WHERE approved_by IS NULL AND COALESCE(is_auto,0) = 0",
        (), 0)
    if unapproved:
        findings.append({
            "severity": "normal", "check": "unapproved_expense",
            "title": "Expenditure awaiting approval",
            "detail": f"{unapproved} expense(s) were recorded but not approved.", "count": unapproved,
        })

    return {"ok": True, "term": {"id": term["id"], "label": term["label"]} if term else None,
            "findings": findings, "clean": not findings}
