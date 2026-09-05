"""Bills, and the arithmetic behind them — a translation of ``electron/ipc/_billing.js``.

Two things in here carry the weight, and both are the offline system's rules
rather than new ones:

  * ONE template resolution order, most specific first — class+term, class,
    term, global — used by bill generation and by every projection that has to
    answer "what would this pupil be billed?". Two resolution orders would mean
    the dashboard and the bill disagreeing about a figure a parent was given.
  * Money is rounded to two decimals AT THE POINT IT IS COMPUTED. Ghana
    transacts in pesewas; rounding only at display time let fractions
    accumulate into balances that never reached zero.
"""
from decimal import Decimal, ROUND_HALF_UP

CHARGE_FEES = "fees"
CHARGE_ARREAR = "arrear"
CHARGE_EXTRA = "extra"


def round2(n):
    try:
        return float(Decimal(str(n or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    except Exception:
        return 0.0


def resolve_fee_template(db, class_group_id, term_id):
    """Most specific first: class+term → class → term → global.

    Only school-fees templates are ever auto-applied; supplementary templates
    are applied deliberately, by a person, to a chosen set of pupils.
    """
    base = ("SELECT * FROM fee_templates WHERE is_active = 1 "
            "AND COALESCE(bill_type, 'school_fees') = 'school_fees'")
    for sql, params in (
        (f"{base} AND class_group_id = %s AND term_id = %s ORDER BY id DESC LIMIT 1",
         (class_group_id, term_id)),
        (f"{base} AND class_group_id = %s AND term_id IS NULL ORDER BY id DESC LIMIT 1",
         (class_group_id,)),
        (f"{base} AND class_group_id IS NULL AND term_id = %s ORDER BY id DESC LIMIT 1",
         (term_id,)),
        (f"{base} AND class_group_id IS NULL AND term_id IS NULL ORDER BY id DESC LIMIT 1", ()),
    ):
        row = db.one(sql, params)
        if row:
            return row
    return None


def term_label(term):
    """Name a term so two of them can be told apart.

    Every academic year has a "First Term". A bare term name in a dropdown
    therefore appears twice, and a fee schedule saved against next year's First
    Term while the school is running this year's Third Term looks identical to
    the right one — until bill generation reports "no template applies" and
    nobody can see why. Every term shown to a user carries its academic year.
    """
    if not term:
        return ""
    label = term.get("label") or term.get("term_label") or ""
    if not label:
        return ""
    year = term.get("year_label") or term.get("academic_year_label") or ""
    return f"{label} · {year}" if year else label


def term_with_year(db, term_id):
    if not term_id:
        return None
    return db.one("""
      SELECT t.*, y.label AS year_label
        FROM terms t LEFT JOIN academic_years y ON y.id = t.academic_year_id
       WHERE t.id = %s""", (term_id,))


def no_template_message(db, student, term_id):
    """What a school can act on when nothing covers a pupil.

    Names the term in full and reads back the schedules that DO exist, because
    the answer is nearly always "it was written against the wrong term".
    """
    term = term_with_year(db, term_id)
    klass = None
    if student and student.get("current_class_id"):
        klass = db.one("SELECT name FROM class_groups WHERE id = %s",
                       (student["current_class_id"],))
    where = f"{klass['name']} in {term_label(term)}" if klass else term_label(term)

    others = db.all("""
      SELECT ft.name, c.name AS class_name, t.label AS term_label, y.label AS year_label
        FROM fee_templates ft
        LEFT JOIN class_groups c ON c.id = ft.class_group_id
        LEFT JOIN terms t ON t.id = ft.term_id
        LEFT JOIN academic_years y ON y.id = t.academic_year_id
       WHERE ft.is_active = 1 AND COALESCE(ft.bill_type, 'school_fees') = 'school_fees'
       ORDER BY ft.id DESC LIMIT 4""")

    msg = f"No school fees schedule covers {where}."
    if others:
        listed = "; ".join(
            f"“{o['name']}” ({o['class_name'] or 'all classes'}, "
            f"{term_label(o) if o.get('term_label') else 'all terms'})"
            for o in others)
        msg += (f" The schedules you have are: {listed}."
                " Check the term each one is written against — every academic year"
                " has a term by the same name.")
    else:
        msg += " Create one under Fees → Bills → School Fees."
    return msg


def template_items(db, template_id):
    return db.all("SELECT * FROM fee_line_items WHERE fee_template_id = %s ORDER BY item_number, id",
                  (template_id,))


def template_total(db, template_id):
    return round2(db.value(
        "SELECT COALESCE(SUM(amount), 0) FROM fee_line_items WHERE fee_template_id = %s",
        (template_id,), 0))


def projected_income_for_term(db, term_id):
    """What the term is worth, whether or not the bills have been raised.

    A school that has not yet raised this term's bills is not a school with no
    income — it is a school with no bills yet. The offline dashboard has always
    shown the projection (``electron/ipc/_billing.js``), so the online one
    shows the same one, computed the same way:

      * bills that EXIST are authoritative, including what has been paid
        against them and any discount already applied;
      * every other active pupil is put through the template bill generation
        would use, so raising the missing bills does not move the figure;
      * a pupil no template covers is counted separately rather than as zero —
        "nobody owes anything" and "nobody has been told what they owe" are
        different things, and only one of them is a problem to fix today.
    """
    billed = db.one("""
      SELECT COALESCE(SUM(total_billed), 0) AS total, COUNT(*) AS count
        FROM student_bills
       WHERE term_id = %s AND COALESCE(status, 'active') = 'active'""", (term_id,))

    unbilled = db.all("""
      SELECT s.id, s.current_class_id
        FROM students s
       WHERE s.status = 'Active'
         AND NOT EXISTS (
           SELECT 1 FROM student_bills b
            WHERE b.student_id = s.id AND b.term_id = %s
              AND COALESCE(b.status, 'active') = 'active')""", (term_id,))

    # One template lookup per CLASS, not per pupil: a school of nine hundred in
    # twelve classes is twelve lookups, and the answer cannot differ within a
    # class anyway.
    cache = {}
    projected = 0.0
    projected_count = 0
    unresolved = 0
    for s in unbilled:
        key = s["current_class_id"]
        if key not in cache:
            tpl = resolve_fee_template(db, key, term_id)
            cache[key] = template_total(db, tpl["id"]) if tpl else None
        amount = cache[key]
        if amount is None:
            unresolved += 1
            continue
        projected += amount
        projected_count += 1

    total = round2((billed["total"] or 0) + projected)
    return {
        "total": total,
        "billed_total": round2(billed["total"] or 0),
        "billed_count": billed["count"] or 0,
        "projected_total": round2(projected),
        "projected_count": projected_count,
        "unresolved_count": unresolved,
    }


def recompute_paid(tx, bill_id):
    """Recompute what has been PAID, and nothing else.

    This is what a payment or a reversal calls, and the distinction from
    ``recompute_bill_totals`` below is not cosmetic — it is a bug this system
    had and no longer has.

    Taking money must never rewrite what a pupil was CHARGED. The full recompute
    rebuilds ``total_billed`` from the bill's line items, which is right when
    the bill's composition changes and catastrophic when it has not: a bill row
    whose items are missing — a legacy import, a bill raised by another path —
    had its ``total_billed`` silently zeroed by the next payment, and the parent
    was then told they owed nothing. A payment changes what was paid. That is
    all it may touch.
    """
    bill = tx.one("SELECT student_id, term_id, total_billed FROM student_bills WHERE id = %s",
                  (bill_id,))
    if not bill:
        return None
    paid = round2(tx.one("""
      SELECT COALESCE(SUM(amount), 0) AS t FROM payments
       WHERE student_id = %s AND term_id = %s AND COALESCE(is_reversed, 0) = 0""",
                         (bill["student_id"], bill["term_id"]))["t"])
    billed = round2(bill["total_billed"] or 0)
    tx.run("UPDATE student_bills SET total_paid = %s, balance = %s WHERE id = %s",
           (paid, round2(billed - paid), bill_id))
    return {"total_billed": billed, "total_paid": paid, "balance": round2(billed - paid)}


def recompute_bill_totals(tx, bill_id):
    """Recompute a bill's stored money columns from its line items and from the
    payments table, which is the source of truth for what was received.

    For changes to what a pupil is CHARGED — generating a bill, adding a
    supplementary line. A payment calls ``recompute_paid`` instead.
    """
    bill = tx.one("SELECT * FROM student_bills WHERE id = %s", (bill_id,))
    if not bill:
        return None
    sums = tx.one("""
      SELECT COALESCE(SUM(CASE WHEN charge_type = 'arrear' THEN amount ELSE 0 END), 0) AS arrears,
             COALESCE(SUM(CASE WHEN charge_type = 'extra'  THEN amount ELSE 0 END), 0) AS extra,
             COALESCE(SUM(CASE WHEN charge_type NOT IN ('arrear','extra') THEN amount ELSE 0 END), 0) AS fees
        FROM bill_line_items WHERE student_bill_id = %s""", (bill_id,))
    paid = tx.one("""
      SELECT COALESCE(SUM(amount), 0) AS t FROM payments
       WHERE student_id = %s AND term_id = %s AND COALESCE(is_reversed, 0) = 0""",
                  (bill["student_id"], bill["term_id"]))["t"]

    gross = round2(sums["fees"] + sums["arrears"] + sums["extra"])
    if gross <= 0 and (bill["total_billed"] or 0) > 0:
        # A bill with a figure on it but no line items behind it. Something
        # raised it another way — an import, an older release — and rebuilding
        # from nothing would tell the parent they owe nothing. Recompute what
        # was paid and leave what was charged exactly where it is.
        return recompute_paid(tx, bill_id)
    # The discount was agreed against the fee schedule, so it stays capped at
    # the gross rather than being re-derived — re-deriving a percentage after a
    # supplementary charge would quietly widen a discount nobody re-approved.
    discount = min(round2(bill["discount_amount"] or 0), gross)
    total_billed = round2(max(0, gross - discount) + round2(bill["books_arrears"] or 0))
    total_paid = round2(paid)
    balance = round2(total_billed - total_paid)

    tx.run("""UPDATE student_bills
                 SET total_billed = %s, total_paid = %s, balance = %s,
                     arrears_from_prev = %s, supplementary_total = %s
               WHERE id = %s""",
           (total_billed, total_paid, balance,
            round2(sums["arrears"]), round2(sums["extra"]), bill_id))
    return {"total_billed": total_billed, "total_paid": total_paid, "balance": balance}


def generate_bill(db, student_id, term_id):
    """Raise or re-raise one pupil's bill for a term.

    Re-generating must NEVER discard money already received. The bill row is
    updated in place and ``total_paid`` recomputed from the payments table,
    which is the source of truth — an earlier version of the offline code
    deleted and re-inserted, and either failed on the foreign key or silently
    re-billed a parent for money they had already handed over.

    Supplementary charges already on the bill (an excursion, sports week)
    survive: they are not template-derived, so rebuilding the school-fees
    portion must leave them where they are.
    """
    student = db.one("SELECT * FROM students WHERE id = %s", (student_id,))
    if not student:
        return {"ok": False, "status": 404, "error": "That pupil is not on the roll."}
    term = db.one("SELECT * FROM terms WHERE id = %s", (term_id,))
    if not term:
        return {"ok": False, "status": 400, "error": "No such term."}

    template = resolve_fee_template(db, student["current_class_id"], term_id)
    if not template:
        return {"ok": False, "status": 400,
                "error": no_template_message(db, student, term_id)}
    items = template_items(db, template["id"])

    # Unpaid arrears from previous terms. A bill the school WITHDREW must not
    # come back as an arrear on the next term's bill.
    prev_arrears = db.all("""
      SELECT t.id AS term_id, t.label, b.balance
        FROM student_bills b JOIN terms t ON t.id = b.term_id
       WHERE b.student_id = %s AND b.balance > 0 AND b.term_id <> %s
         AND COALESCE(b.status, 'active') = 'active'
       ORDER BY t.start_date""", (student_id, term_id))

    discount = db.one("""
      SELECT * FROM student_discounts
       WHERE student_id = %s AND is_active = 1
         AND (applies_to = 'fees' OR applies_to = 'both') LIMIT 1""", (student_id,))

    books_arrears = 0.0
    if term["academic_year_id"] and (term["term_number"] or 1) > 1:
        books_arrears = db.value(
            "SELECT balance FROM student_books WHERE student_id = %s AND academic_year_id = %s",
            (student_id, term["academic_year_id"]), 0) or 0

    with db.tx() as tx:
        existing = tx.one("SELECT * FROM student_bills WHERE student_id = %s AND term_id = %s",
                          (student_id, term_id))
        if existing and (existing.get("status") or "active") == "voided":
            return {"ok": False, "status": 400,
                    "error": "This bill was withdrawn. Restore it before regenerating."}

        kept_extras = tx.all("""
          SELECT * FROM bill_line_items
           WHERE student_bill_id = %s AND charge_type = 'extra' ORDER BY item_number, id""",
                             (existing["id"],)) if existing else []
        extras_subtotal = round2(sum(e["amount"] or 0 for e in kept_extras))
        already_paid = round2(tx.one("""
          SELECT COALESCE(SUM(amount), 0) AS t FROM payments
           WHERE student_id = %s AND term_id = %s AND COALESCE(is_reversed, 0) = 0""",
                                     (student_id, term_id))["t"] or 0)

        fee_subtotal = round2(sum(i["amount"] or 0 for i in items))
        arrears_subtotal = round2(sum(a["balance"] or 0 for a in prev_arrears))
        chargeable = round2(fee_subtotal + arrears_subtotal + extras_subtotal)

        discount_amount, discount_reason = 0.0, None
        if discount:
            discount_reason = discount["reason"]
            if discount["discount_type"] == "percent":
                discount_amount = round2(chargeable * (discount["discount_value"] / 100))
            else:
                discount_amount = min(round2(discount["discount_value"]), chargeable)

        fees_net = max(0.0, round2(chargeable - discount_amount))
        total_billed = round2(fees_net + books_arrears)
        balance = round2(total_billed - already_paid)

        if existing:
            tx.run("""UPDATE student_bills
                         SET template_id = %s, total_billed = %s, total_paid = %s, balance = %s,
                             arrears_from_prev = %s, books_arrears = %s, supplementary_total = %s,
                             discount_amount = %s, discount_reason = %s
                       WHERE id = %s""",
                   (template["id"], total_billed, already_paid, balance, arrears_subtotal,
                    books_arrears, extras_subtotal, discount_amount, discount_reason, existing["id"]))
            bill_id = existing["id"]
            tx.run("DELETE FROM bill_line_items WHERE student_bill_id = %s AND charge_type <> 'extra'",
                   (bill_id,))
        else:
            bill_id = tx.insert("student_bills", {
                "student_id": student_id, "term_id": term_id, "template_id": template["id"],
                "total_billed": total_billed, "total_paid": already_paid, "balance": balance,
                "arrears_from_prev": arrears_subtotal, "books_arrears": books_arrears,
                "supplementary_total": extras_subtotal,
                "discount_amount": discount_amount, "discount_reason": discount_reason,
                "status": "active",
            })

        # Fees first, then arrears, then the retained extras — renumbered so the
        # printed bill reads 1..n without gaps.
        n = 1
        for item in items:
            tx.run("""INSERT INTO bill_line_items
                        (student_bill_id, item_number, description, amount, is_arrear,
                         arrear_from_term_id, charge_type, source_template_id)
                      VALUES (%s,%s,%s,%s,0,NULL,%s,%s)""",
                   (bill_id, n, item["description"], round2(item["amount"]),
                    CHARGE_FEES, template["id"]))
            n += 1
        for a in prev_arrears:
            tx.run("""INSERT INTO bill_line_items
                        (student_bill_id, item_number, description, amount, is_arrear,
                         arrear_from_term_id, charge_type, source_template_id)
                      VALUES (%s,%s,%s,%s,1,%s,%s,NULL)""",
                   (bill_id, n, f'Arrears from {a["label"]}', round2(a["balance"]),
                    a["term_id"], CHARGE_ARREAR))
            n += 1
        for e in kept_extras:
            tx.run("UPDATE bill_line_items SET item_number = %s WHERE id = %s", (n, e["id"]))
            n += 1

    return {"ok": True, "id": bill_id, "total_billed": total_billed, "balance": balance}
