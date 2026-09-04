"""Fees — bills, payments, receipts and arrears.

A translation of ``electron/ipc/fees.js`` and ``electron/server/payments_service.js``.

The one function that matters most is ``record_payment``, and what makes it
right is that four things happen inside ONE transaction:

  1. the receipt number is consumed,
  2. the payment row is written,
  3. the bill's totals are recomputed from the payments table,
  4. the ledger is posted.

Taking the receipt number outside the transaction meant a payment that failed
to record still burned a number and left a gap in the sequence — which is what
an audit of a school's books treats as a missing receipt. Recomputing the bill
from the payments table rather than by addition means a reversal, a correction
or a re-generated bill all arrive at the same balance.

Reversal is deliberately harder than recording. A reversal rewrites what a
parent was told they had paid, so it needs an elevated account and a reason in
writing, and it posts its own ledger entry rather than editing the original —
the books show what happened, not a number that changed.
"""
import datetime

from . import billing, idgen, ledger, scope as scope_lib, security
from .billing import round2

METHODS = ["Cash", "Mobile Money", "Bank Transfer", "Cheque", "Paystack", "Card"]


def _today():
    return datetime.date.today().isoformat()


def current_term(db):
    return db.one("SELECT * FROM terms WHERE is_current = 1")


# ── reading ─────────────────────────────────────────────────────────────────

def overview(db, actor):
    """The term's position: billed, collected, outstanding, today's takings."""
    term = current_term(db)
    if not term:
        return {"ok": True, "term": None, "fees": None}
    billed = db.one("""
      SELECT COALESCE(SUM(total_billed),0) AS billed, COALESCE(SUM(balance),0) AS outstanding,
             count(*) FILTER (WHERE balance > 0) AS debtors, count(*) AS bills
        FROM student_bills WHERE term_id = %s AND COALESCE(status,'active') = 'active'""",
                    (term["id"],))
    collected = db.one("""
      SELECT COALESCE(SUM(amount),0) AS t, count(*) AS n FROM payments
       WHERE term_id = %s AND is_reversed = 0""", (term["id"],))
    today = db.one("""
      SELECT COALESCE(SUM(amount),0) AS t, count(*) AS n FROM payments
       WHERE payment_date = %s AND is_reversed = 0""", (_today(),))
    return {
        "ok": True,
        "term": {"id": term["id"], "label": term["label"],
                 "start_date": term["start_date"], "end_date": term["end_date"]},
        "currency": db.get_setting("payment_currency", "GHS"),
        "fees": {
            "billed": round2(billed["billed"]), "collected": round2(collected["t"]),
            "receipts": collected["n"], "outstanding": round2(billed["outstanding"]),
            "debtors": billed["debtors"], "bills": billed["bills"],
            "today": round2(today["t"]), "today_receipts": today["n"],
            "collection_rate": round(collected["t"] / billed["billed"] * 100)
                               if billed["billed"] else 0,
        },
        "may_record": security.can(actor, "fees", "create"),
    }


def collections(db, actor, date_from=None, date_to=None, class_id=None, method=None, limit=400):
    term = current_term(db)
    date_from = date_from or (term["start_date"] if term else "1970-01-01")
    date_to = date_to or (term["end_date"] if term else "2099-12-31")
    sql = """
      SELECT p.id, p.receipt_number, p.amount, p.payment_date, p.payment_method,
             p.reference, p.notes, p.is_reversed, p.reversal_reason,
             s.id AS student_id, s.surname, s.first_name, s.index_number,
             c.name AS class_name, u.full_name AS received_by_name
        FROM payments p
        JOIN students s ON s.id = p.student_id
        LEFT JOIN class_groups c ON c.id = s.current_class_id
        LEFT JOIN users u ON u.id = p.received_by
       WHERE p.payment_date BETWEEN %s AND %s
    """
    params = [date_from, date_to]
    if class_id:
        sql += " AND s.current_class_id = %s"
        params.append(class_id)
    if method:
        sql += " AND p.payment_method = %s"
        params.append(method)
    sql += " ORDER BY p.payment_date DESC, p.id DESC LIMIT %s"
    params.append(min(int(limit or 400), 1000))

    rows = db.all(sql, tuple(params))
    for r in rows:
        r["student_name"] = f"{r.get('surname') or ''} {r.get('first_name') or ''}".strip()
    return {
        "ok": True, "from": date_from, "to": date_to,
        "total": round2(sum(r["amount"] for r in rows if not r["is_reversed"])),
        "count": len(rows), "payments": rows,
        "may_record": security.can(actor, "fees", "create"),
    }


def student_account(db, actor, student_id, term_id=None):
    """A pupil's bill, line by line, with every receipt against it."""
    student = db.one("""
      SELECT s.id, s.index_number, s.surname, s.first_name, s.other_names, s.status,
             c.name AS class_name
        FROM students s LEFT JOIN class_groups c ON c.id = s.current_class_id
       WHERE s.id = %s""", (student_id,))
    if not student:
        return {"ok": False, "status": 404, "error": "That pupil is not on the roll."}

    term = db.one("SELECT * FROM terms WHERE id = %s", (term_id,)) if term_id else current_term(db)
    bill = db.one("""
      SELECT * FROM student_bills WHERE student_id = %s AND term_id = %s
         AND COALESCE(status,'active') = 'active'""",
                  (student_id, term["id"])) if term else None
    items = db.all("""
      SELECT item_number, description, amount, is_arrear, charge_type
        FROM bill_line_items WHERE student_bill_id = %s
       ORDER BY is_arrear, item_number, id""", (bill["id"],)) if bill else []
    history = db.all("""
      SELECT p.id, p.receipt_number, p.amount, p.payment_date, p.payment_method, p.reference,
             p.is_reversed, p.reversal_reason, t.label AS term_label, u.full_name AS received_by_name
        FROM payments p LEFT JOIN terms t ON t.id = p.term_id
        LEFT JOIN users u ON u.id = p.received_by
       WHERE p.student_id = %s ORDER BY p.payment_date DESC, p.id DESC LIMIT 120""", (student_id,))

    student["name"] = f"{student.get('surname') or ''} {student.get('first_name') or ''}".strip()
    return {
        "ok": True, "student": student,
        "term": {"id": term["id"], "label": term["label"]} if term else None,
        "bill": {
            "id": bill["id"], "billed": round2(bill["total_billed"]),
            "paid": round2(bill["total_paid"]), "balance": round2(bill["balance"]),
            "arrears": round2(bill["arrears_from_prev"]), "discount": round2(bill["discount_amount"]),
            "books_total": round2(bill["books_total"]), "books_paid": round2(bill["books_paid"]),
            "generated_at": bill["generated_at"],
        } if bill else None,
        "items": items, "history": history,
    }


def debtors(db, actor, class_id=None, minimum=None, limit=500):
    term = current_term(db)
    if not term:
        return {"ok": True, "debtors": [], "total": 0, "by_class": []}
    sql = """
      SELECT s.id AS student_id, s.index_number, s.surname, s.first_name,
             c.id AS class_id, c.name AS class_name, b.balance, b.total_billed, b.total_paid,
             (current_date - to_date(left(b.generated_at, 10), 'YYYY-MM-DD')) AS days_outstanding,
             COALESCE(s.guardian_contact, s.father_contact, s.mother_contact) AS guardian_phone
        FROM student_bills b
        JOIN students s ON s.id = b.student_id
        LEFT JOIN class_groups c ON c.id = s.current_class_id
       WHERE b.term_id = %s AND b.balance > 0 AND s.status = 'Active'
         AND COALESCE(b.status,'active') = 'active'
    """
    params = [term["id"]]
    if class_id:
        sql += " AND s.current_class_id = %s"
        params.append(class_id)
    if minimum:
        sql += " AND b.balance >= %s"
        params.append(float(minimum))
    sql += " ORDER BY b.balance DESC LIMIT %s"
    params.append(min(int(limit or 500), 2000))

    rows = db.all(sql, tuple(params))
    for r in rows:
        r["student_name"] = f"{r.get('surname') or ''} {r.get('first_name') or ''}".strip()
    by_class = db.all("""
      SELECT c.name AS class_name, count(*) AS n, COALESCE(SUM(b.balance),0) AS total
        FROM student_bills b JOIN students s ON s.id = b.student_id
        LEFT JOIN class_groups c ON c.id = s.current_class_id
       WHERE b.term_id = %s AND b.balance > 0 AND s.status = 'Active'
         AND COALESCE(b.status,'active') = 'active'
       GROUP BY c.id, c.name ORDER BY total DESC""", (term["id"],))
    return {
        "ok": True, "term": {"id": term["id"], "label": term["label"]},
        "total": round2(sum(r["balance"] for r in rows)),
        "by_class": by_class, "debtors": rows,
    }


# ── taking money ────────────────────────────────────────────────────────────

def record_payment(db, actor, data):
    """Take a fee payment.

    One transaction: the receipt number, the payment row, the bill's totals and
    the ledger entry. If any of them fails none of them happened, which is the
    only acceptable outcome when the alternative is a receipt number issued for
    a payment that was not recorded.
    """
    try:
        student_id = int(data.get("student_id") or data.get("studentId"))
    except (TypeError, ValueError):
        return {"ok": False, "status": 400, "error": "Choose the pupil the payment is for."}
    amount = round2(data.get("amount"))
    if amount <= 0:
        return {"ok": False, "status": 400, "error": "Enter an amount greater than zero."}

    student = db.one("SELECT id, surname, first_name FROM students WHERE id = %s", (student_id,))
    if not student:
        return {"ok": False, "status": 404, "error": "That pupil is not on the roll."}

    pay_date = str(data.get("payment_date") or data.get("date") or _today())[:10]
    term = (db.one("SELECT * FROM terms WHERE id = %s", (data["term_id"],))
            if data.get("term_id") else current_term(db))
    term_id = term["id"] if term else None
    method = data.get("payment_method") or data.get("method") or "Cash"

    with db.tx() as tx:
        bill = tx.one("""
          SELECT id FROM student_bills
           WHERE student_id = %s AND term_id = %s AND COALESCE(status,'active') = 'active'""",
                      (student_id, term_id)) if term_id else None
        bill_id = data.get("bill_id") or (bill["id"] if bill else None)

        counter = idgen.next_receipt_number(tx)
        receipt_no = f"FE/{datetime.date.today().year % 100}/{str(counter).zfill(5)}"

        payment_id = tx.insert("payments", {
            "student_id": student_id, "student_bill_id": bill_id, "term_id": term_id,
            "amount": amount, "payment_date": pay_date, "payment_method": method,
            "reference": data.get("reference"), "received_by": (actor or {}).get("user_id"),
            "notes": data.get("notes"), "receipt_number": receipt_no,
        })

        if bill_id:
            # Only the PAID side. Recomputed from the payments table rather
            # than added to the stored total, so a reversal or a correction
            # arrives at the same answer — and deliberately not the full
            # recompute, because taking money must never rewrite what the
            # pupil was charged. See billing.recompute_paid.
            billing.recompute_paid(tx, bill_id)

        ledger.post_income(tx, {
            "receipt_number": receipt_no, "category": "fees", "amount": amount,
            "description": f"School fees payment — {receipt_no}",
            "payment_method": method, "reference": data.get("reference"),
            "date": pay_date, "source": data.get("source") or "office_payment",
            "student_id": student_id, "term_id": term_id,
            "linked_payment_id": payment_id,
            "recorded_by": (actor or {}).get("user_id"), "is_auto": 1,
        })

    security.audit(db, actor, "payment", payment_id, "record_payment",
                   f'{receipt_no} — {amount} for {student["surname"]} {student["first_name"]}')
    return {"ok": True, "payment_id": payment_id, "receipt_number": receipt_no, "amount": amount}


def reverse_payment(db, actor, payment_id, reason):
    """Undo a payment.

    Held to a higher bar than recording one: an elevated account, and a reason
    in writing. The ledger is not edited — the reversal is its own entry, so
    the books show what happened rather than a number that changed.
    """
    if not security.is_elevated(actor):
        return {"ok": False, "status": 403,
                "error": "Only the Super Admin or the Proprietor may reverse a payment."}
    reason = str(reason or "").strip()
    if len(reason) < 5:
        return {"ok": False, "status": 400, "error": "Give the reason the payment is being reversed."}

    pay = db.one("SELECT * FROM payments WHERE id = %s", (payment_id,))
    if not pay:
        return {"ok": False, "status": 404, "error": "That payment does not exist."}
    if pay["is_reversed"]:
        return {"ok": False, "status": 400, "error": "That payment has already been reversed."}

    with db.tx() as tx:
        tx.run("""UPDATE payments
                     SET is_reversed = 1, reversed_by = %s, reversal_reason = %s,
                         reversed_at = %s
                   WHERE id = %s""",
               (actor["user_id"], reason,
                datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
                payment_id))
        if pay["student_bill_id"]:
            billing.recompute_paid(tx, pay["student_bill_id"])
        ledger.post_expense(tx, {
            "category": "refund", "amount": pay["amount"],
            "description": f'Reversal of receipt {pay["receipt_number"]} — {reason}',
            "payment_method": pay["payment_method"], "reference": pay["receipt_number"],
            "date": _today(), "term_id": pay["term_id"],
            "recorded_by": actor["user_id"], "is_auto": 1,
        })

    security.audit(db, actor, "payment", payment_id, "reverse_payment",
                   f'Reversed {pay["receipt_number"]} ({pay["amount"]}): {reason}', "high")
    return {"ok": True}


# ── bills ───────────────────────────────────────────────────────────────────

def generate_bill(db, actor, student_id, term_id=None):
    term = db.one("SELECT id FROM terms WHERE id = %s", (term_id,)) if term_id else current_term(db)
    if not term:
        return {"ok": False, "status": 400, "error": "There is no current term."}
    result = billing.generate_bill(db, student_id, term["id"])
    if result.get("ok"):
        security.audit(db, actor, "student_bill", result["id"], "generate_bill",
                       f'Pupil {student_id}, term {term["id"]}')
    return result


def generate_bills_for_class(db, actor, class_id, term_id=None):
    """Raise a whole class's bills.

    Each pupil is its own transaction. One pupil with no applicable template
    must not stop the other thirty-nine from being billed, and a school
    generating bills on the first day of term has thirty-nine parents at the
    gate who would rather not wait.
    """
    term = db.one("SELECT id FROM terms WHERE id = %s", (term_id,)) if term_id else current_term(db)
    if not term:
        return {"ok": False, "status": 400, "error": "There is no current term."}
    pupils = db.all("SELECT id FROM students WHERE current_class_id = %s AND status = 'Active'",
                    (class_id,))
    done, failed = 0, []
    for p in pupils:
        r = billing.generate_bill(db, p["id"], term["id"])
        if r.get("ok"):
            done += 1
        else:
            failed.append({"student_id": p["id"], "error": r.get("error")})
    security.audit(db, actor, "student_bill", class_id, "generate_bills_class",
                   f"{done} raised, {len(failed)} could not be")
    return {"ok": True, "generated": done, "failed": failed}


def templates(db, actor, bill_type="school_fees"):
    """The fee schedules. School fees by default.

    The extra charges a term throws up are a different list on a different
    screen — mixing them was how a class ended up billed for the excursion
    twice.
    """
    where = "" if bill_type in (None, "all") else \
        " AND COALESCE(ft.bill_type,'school_fees') = %(bill_type)s"
    rows = db.all("""
      SELECT ft.*, c.name AS class_name, t.label AS term_label,
             (SELECT COALESCE(SUM(amount),0) FROM fee_line_items WHERE fee_template_id = ft.id) AS total,
             (SELECT count(*) FROM fee_line_items WHERE fee_template_id = ft.id) AS items
        FROM fee_templates ft
        LEFT JOIN class_groups c ON c.id = ft.class_group_id
        LEFT JOIN terms t ON t.id = ft.term_id
       WHERE ft.is_active = 1""" + where + """
       ORDER BY c.name NULLS FIRST, t.label NULLS FIRST, ft.id""",
                  {"bill_type": bill_type})
    return {"ok": True, "templates": rows}


def supplementary_templates(db, actor, term_id=None):
    """The extra charges a term throws up, and how many bills each is on.

    School fees are billed once a term. Excursion, sports week, mock exams,
    BECE registration, speech day — those are raised here and land on the
    pupil's existing term bill as extra lines, so a parent still has one bill
    and one balance to settle.
    """
    term = db.one("SELECT * FROM terms WHERE id = %s", (term_id,)) if term_id else current_term(db)
    tid = term["id"] if term else None
    rows = db.all("""
      SELECT ft.*, c.name AS class_name,
             (SELECT COALESCE(SUM(amount),0) FROM fee_line_items WHERE fee_template_id = ft.id) AS total,
             (SELECT count(*) FROM fee_line_items WHERE fee_template_id = ft.id) AS items,
             (SELECT count(DISTINCT li.student_bill_id)
                FROM bill_line_items li JOIN student_bills b ON b.id = li.student_bill_id
               WHERE li.source_template_id = ft.id AND li.charge_type = 'extra'
                 AND (%(term)s IS NULL OR b.term_id = %(term)s)) AS applied_to
        FROM fee_templates ft
        LEFT JOIN class_groups c ON c.id = ft.class_group_id
       WHERE ft.is_active = 1 AND ft.bill_type = 'supplementary'
       ORDER BY ft.id DESC""", {"term": tid})
    return {"ok": True, "templates": rows, "may_apply": security.is_elevated(actor),
            "term": {"id": tid, "label": term["label"]} if term else None}


def apply_supplementary(db, actor, data):
    """Add a supplementary charge onto bills that already exist.

    Elevated: this raises what every family in a class is asked to pay, which
    is not the same question as "may this person take a payment". Idempotent
    per (bill, template) — applying twice does not charge twice, and it says
    how many it skipped rather than pretending it did nothing.
    """
    if not security.is_elevated(actor):
        return {"ok": False, "status": 403,
                "error": "Only the Super Admin or the Proprietor may apply a supplementary charge."}
    template_id = data.get("templateId") or data.get("template_id")
    tpl = db.one("SELECT * FROM fee_templates WHERE id = %s", (template_id,)) if template_id else None
    if not tpl:
        return {"ok": False, "status": 404, "error": "That supplementary bill no longer exists."}
    if (tpl.get("bill_type") or "school_fees") != "supplementary":
        return {"ok": False, "status": 400,
                "error": "Only a supplementary bill can be added on top of a term bill. "
                         "School fees are billed once per term through Generate Bills."}
    items = [i for i in billing.template_items(db, template_id)
             if (i.get("amount") or 0) != 0 or i.get("description")]
    if not items:
        return {"ok": False, "status": 400, "error": "That supplementary bill has no line items."}

    tid = data.get("termId") or data.get("term_id")
    term = db.one("SELECT * FROM terms WHERE id = %s", (tid,)) if tid else current_term(db)
    if not term:
        return {"ok": False, "status": 400,
                "error": "No term is running, so there is nothing to add the charge to."}

    sc = data.get("scope") if data.get("scope") in ("class", "selected") else "all"
    if sc == "class" and data.get("classId"):
        bills = db.all("""
          SELECT b.id FROM student_bills b JOIN students s ON s.id = b.student_id
           WHERE b.term_id = %s AND s.current_class_id = %s
             AND COALESCE(b.status,'active') = 'active'""", (term["id"], data["classId"]))
    elif sc == "selected" and data.get("studentIds"):
        bills = db.all("""
          SELECT id FROM student_bills
           WHERE term_id = %s AND COALESCE(status,'active') = 'active'
             AND student_id = ANY(%s)""", (term["id"], list(data["studentIds"])))
    else:
        bills = db.all("""
          SELECT b.id FROM student_bills b JOIN students s ON s.id = b.student_id
           WHERE b.term_id = %s AND s.status = 'Active'
             AND COALESCE(b.status,'active') = 'active'""", (term["id"],))
    if not bills:
        return {"ok": False, "status": 400,
                "error": "No term bills matched. Generate the term bills first, "
                         "then add the extra charge."}

    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    applied = skipped = 0
    amount = 0.0
    with db.tx() as tx:
        for b in bills:
            on = tx.one("""SELECT count(*) AS n FROM bill_line_items
                            WHERE student_bill_id = %s AND source_template_id = %s
                              AND charge_type = 'extra'""", (b["id"], template_id))["n"]
            if on:
                skipped += 1
                continue
            n = tx.one("""SELECT COALESCE(MAX(item_number), 0) AS n FROM bill_line_items
                           WHERE student_bill_id = %s""", (b["id"],))["n"]
            for it in items:
                n += 1
                tx.run("""INSERT INTO bill_line_items
                            (student_bill_id, item_number, description, amount, is_arrear,
                             charge_type, source_template_id, added_at, added_by)
                          VALUES (%s,%s,%s,%s,0,'extra',%s,%s,%s)""",
                       (b["id"], n, it.get("description"), round2(it.get("amount")),
                        template_id, now, actor["user_id"]))
                amount += round2(it.get("amount"))
            billing.recompute_bill_totals(tx, b["id"])
            applied += 1

    security.audit(db, actor, "student_bill", None, "supplementary_applied",
                   f'Applied "{tpl["name"]}" (GHS {round2(amount)}) to {applied} bill(s) '
                   f'for {term["label"]}.', "high")
    return {"ok": True, "applied": applied, "skipped": skipped,
            "total_amount": round2(amount), "template_name": tpl["name"], "term": term["label"]}


def remove_supplementary(db, actor, data):
    """Take a supplementary charge back off every bill it was added to."""
    if not security.is_elevated(actor):
        return {"ok": False, "status": 403,
                "error": "Only the Super Admin or the Proprietor may withdraw a supplementary charge."}
    template_id = data.get("templateId") or data.get("template_id")
    if not template_id:
        return {"ok": False, "status": 400, "error": "Which charge?"}
    bill_id = data.get("billId") or data.get("bill_id")
    tid = data.get("termId") or data.get("term_id")
    term = db.one("SELECT * FROM terms WHERE id = %s", (tid,)) if tid else current_term(db)

    if bill_id:
        targets = db.all("SELECT id FROM student_bills WHERE id = %s", (bill_id,))
    else:
        targets = db.all("""
          SELECT DISTINCT b.id FROM student_bills b
            JOIN bill_line_items li ON li.student_bill_id = b.id
           WHERE (%(term)s IS NULL OR b.term_id = %(term)s)
             AND li.source_template_id = %(tpl)s AND li.charge_type = 'extra'""",
                         {"term": term["id"] if term else None, "tpl": template_id})

    removed = 0
    with db.tx() as tx:
        for t in targets:
            n = tx.run("""DELETE FROM bill_line_items
                           WHERE student_bill_id = %s AND source_template_id = %s
                             AND charge_type = 'extra'""", (t["id"], template_id))
            if n:
                billing.recompute_bill_totals(tx, t["id"])
                removed += 1

    security.audit(db, actor, "student_bill", bill_id, "supplementary_removed",
                   f"Removed supplementary charge {template_id} from {removed} bill(s).", "high")
    return {"ok": True, "removed": removed}


# ── withdrawing a bill ──────────────────────────────────────────────────────
#
# A voided bill is hidden from the bills list, the debtors report and every
# total, which is exactly what makes this worth serving: it is the only place
# anybody can see what was withdrawn, by whom, and on what stated grounds —
# and put it back if it should not have been.

def voided_bills(db, actor, term_id=None, all_terms=False):
    tid = None if all_terms else term_id
    if tid is None and not all_terms:
        term = current_term(db)
        tid = term["id"] if term else None
    rows = db.all("""
      SELECT b.*, s.index_number, s.surname, s.first_name,
             TRIM(COALESCE(s.surname,'') || ' ' || COALESCE(s.first_name,'')) AS student_name,
             c.name AS class_name, t.label AS term_label, u.full_name AS voided_by_name
        FROM student_bills b
        JOIN students s ON s.id = b.student_id
        LEFT JOIN class_groups c ON c.id = s.current_class_id
        JOIN terms t ON t.id = b.term_id
        LEFT JOIN users u ON u.id = b.voided_by
       WHERE COALESCE(b.status,'active') = 'voided' AND (%(term)s IS NULL OR b.term_id = %(term)s)
       ORDER BY b.voided_at DESC LIMIT 400""", {"term": tid})
    return {"ok": True, "term_id": tid, "bills": rows,
            "may_restore": security.is_elevated(actor)}


def void_bill(db, actor, bill_id, reason):
    if not security.is_elevated(actor):
        return {"ok": False, "status": 403,
                "error": "Only the Super Admin or the Proprietor may withdraw a bill."}
    reason = str(reason or "").strip()
    if len(reason) < 5:
        return {"ok": False, "status": 400,
                "error": "A reason is required, and it has to say something — "
                         "this is written to the audit trail."}
    bill = db.one("""SELECT b.*, s.index_number, s.surname, s.first_name
                       FROM student_bills b JOIN students s ON s.id = b.student_id
                      WHERE b.id = %s""", (bill_id,))
    if not bill:
        return {"ok": False, "status": 404, "error": "Bill not found."}
    if (bill.get("status") or "active") == "voided":
        return {"ok": False, "status": 400, "error": "That bill is already voided."}

    db.run("""UPDATE student_bills
                 SET status = 'voided', voided_at = %s, voided_by = %s, void_reason = %s
               WHERE id = %s""",
           (datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
            actor["user_id"], reason, bill_id))
    security.audit(db, actor, "student_bill", bill_id, "bill_voided",
                   f'Voided bill #{bill_id} for {bill["index_number"]} '
                   f'({bill["surname"]} {bill["first_name"]}), '
                   f'GHS {round2(bill["total_billed"])} billed / '
                   f'GHS {round2(bill["total_paid"])} paid. Reason: {reason}', "high")
    paid = round2(bill["total_paid"] or 0)
    # Voiding does not un-receive money. Saying so plainly beats a silent
    # discrepancy between the bill list and the finance ledger.
    return {"ok": True, "retained_payments": paid,
            "warning": (f"GHS {paid} already received against this bill stays recorded in "
                        "Finance. Reverse those payments separately if the money is being "
                        "refunded.") if paid > 0 else None}


def restore_bill(db, actor, bill_id):
    if not security.is_elevated(actor):
        return {"ok": False, "status": 403,
                "error": "Only the Super Admin or the Proprietor may restore a withdrawn bill."}
    bill = db.one("SELECT * FROM student_bills WHERE id = %s", (bill_id,))
    if not bill:
        return {"ok": False, "status": 404, "error": "Bill not found."}
    if (bill.get("status") or "active") != "voided":
        return {"ok": False, "status": 400, "error": "That bill is not voided."}
    with db.tx() as tx:
        tx.run("""UPDATE student_bills
                     SET status = 'active', voided_at = NULL, voided_by = NULL, void_reason = NULL
                   WHERE id = %s""", (bill_id,))
        billing.recompute_bill_totals(tx, bill_id)
    security.audit(db, actor, "student_bill", bill_id, "bill_restored",
                   f"Restored voided bill #{bill_id}.", "high")
    return {"ok": True}


def template(db, actor, template_id):
    row = db.one("SELECT * FROM fee_templates WHERE id = %s", (template_id,))
    if not row:
        return {"ok": False, "status": 404, "error": "No such fee template."}
    row["items"] = billing.template_items(db, template_id)
    row["total"] = billing.template_total(db, template_id)
    return {"ok": True, "template": row}


def save_template(db, actor, data):
    """Create or amend a fee template.

    A school-fees template that clashes with an existing one for the same class
    and term is refused rather than silently shadowing it — "there cannot be two
    school fees in the same term" is the school's rule, and a second template
    that quietly wins is how a class gets billed the wrong amount.
    """
    name = str(data.get("name") or "").strip()
    if not name:
        return {"ok": False, "status": 400, "error": "Give the template a name."}
    items = data.get("items") or []
    if not items:
        return {"ok": False, "status": 400, "error": "A bill needs at least one line."}

    template_id = data.get("id")
    class_id = data.get("class_group_id") or None
    term_id = data.get("term_id") or None
    bill_type = data.get("bill_type") or "school_fees"

    if bill_type == "school_fees" and term_id:
        clash = db.one("""
          SELECT ft.id, ft.name, c.name AS class_name, t.label AS term_label
            FROM fee_templates ft
            LEFT JOIN class_groups c ON c.id = ft.class_group_id
            LEFT JOIN terms t ON t.id = ft.term_id
           WHERE ft.is_active = 1 AND COALESCE(ft.bill_type,'school_fees') = 'school_fees'
             AND ft.term_id = %s AND ft.class_group_id IS NOT DISTINCT FROM %s
             AND ft.id IS DISTINCT FROM %s LIMIT 1""",
                       (term_id, class_id, template_id))
        if clash:
            return {"ok": False, "status": 409,
                    "error": f'"{clash["name"]}" already covers that class and term.'}

    with db.tx() as tx:
        if template_id:
            tx.run("""UPDATE fee_templates SET name = %s, class_group_id = %s, term_id = %s,
                             bill_type = %s WHERE id = %s""",
                   (name, class_id, term_id, bill_type, template_id))
            tx.run("DELETE FROM fee_line_items WHERE fee_template_id = %s", (template_id,))
        else:
            template_id = tx.insert("fee_templates", {
                "name": name, "class_group_id": class_id, "term_id": term_id,
                "bill_type": bill_type, "is_active": 1,
            })
        for n, item in enumerate(items, start=1):
            tx.run("""INSERT INTO fee_line_items (fee_template_id, item_number, description, amount)
                        VALUES (%s,%s,%s,%s)""",
                   (template_id, n, str(item.get("description") or "")[:200],
                    round2(item.get("amount"))))

    security.audit(db, actor, "fee_template", template_id, "save_fee_template", name)
    return {"ok": True, "id": template_id}
