"""Invoices, and the run that raises them.

An invoice is a RECORD, not a view. Every figure that went into the total is
copied onto it at the moment it is issued — the pupil count, the price per
pupil, the discount that applied and what it was called, the exemption and why.
None of it is a foreign key to something an operator can edit later.

That is §19, and it is worth being precise about what it prevents: the
Superadmin raises Pro from GHS 3 to GHS 4 in March. Nothing that happened in
January may move. An invoice that recomputed itself from the plan would show
the school a different figure in April than it showed in January, against a
payment that has already gone through, and the school would be right to stop
trusting the system.

Statuses:

    DRAFT     raised, not yet issued to the school
    OPEN      issued, awaiting payment
    PAID      settled
    PAST_DUE  the due date passed with it open
    VOID      withdrawn; it never counted
    EXEMPT    nothing was owed, because the school is exempt — NOT "paid",
              because nobody paid it, and not "void", because it happened
"""
from . import adjustments
from . import audit as billing_audit
from . import engine
from . import plans as plan_lib
from . import settings as platform_settings
from . import subscriptions as subs
from . import usage as usage_lib
from .repo import money, now_iso, parse_iso, shift

DRAFT, OPEN, PAID, PAST_DUE, VOID, EXEMPT = "DRAFT", "OPEN", "PAID", "PAST_DUE", "VOID", "EXEMPT"
OUTSTANDING = (OPEN, PAST_DUE)


def next_number(repo):
    """`NE-2026-0001`. Sequential within the year, per platform.

    Derived from the count rather than a database sequence so both backends
    behave the same; a collision retries with a suffix, which is rare enough to
    be worth the simplicity and correct enough that it can never fail.
    """
    import datetime
    prefix = platform_settings.get(repo, "invoice_prefix", "NE")
    year = datetime.datetime.now(datetime.timezone.utc).year
    for attempt in range(1, 40):
        count = repo.count("invoices") + attempt
        number = f"{prefix}-{year}-{count:04d}"
        if not repo.find_one("invoices", {"invoice_number": number}):
            return number
    import secrets
    return f"{prefix}-{year}-{secrets.token_hex(3).upper()}"


def list_invoices(repo, school_id=None, status=None, limit=200):
    where = {}
    if school_id:
        where["school_id"] = school_id
    if status:
        where["status"] = status if isinstance(status, str) else ("in", list(status))
    return repo.find("invoices", where, order_by="id", desc=True, limit=limit)


def get_invoice(repo, invoice_id, school_id=None):
    invoice = repo.get("invoices", invoice_id)
    if not invoice:
        return None
    # The tenant check. An invoice id is a small integer and therefore
    # guessable, so the school asking has to be the school it belongs to —
    # checked here rather than remembered at each of the routes that reads one.
    if school_id is not None and str(invoice["school_id"]) != str(school_id):
        return None
    return {**invoice,
            "items": repo.find("invoice_items", {"invoice_id": invoice["id"]}, order_by="sort_order"),
            "payments": repo.find("platform_payments", {"invoice_id": invoice["id"]},
                                  order_by="id", desc=True)}


def raise_invoice(store, repo, school_id, subscription=None, period_start=None,
                  period_end=None, actor="system", status=None):
    """Raise one invoice for one billing period. Idempotent per period.

    Returns the existing invoice rather than a second one when the period has
    already been billed — which is what makes the billing run safe to restart
    after it dies half way through a hundred schools.
    """
    subscription = subscription or subs.current(repo, school_id)
    if not subscription:
        return {"ok": False, "status": 404, "error": "This school has no subscription."}
    plan = repo.get("subscription_plans", subscription["plan_id"])
    if not plan:
        return {"ok": False, "status": 404, "error": "The subscribed plan no longer exists."}

    period_start = period_start or subscription.get("current_period_start") or now_iso()
    period_end = period_end or subscription.get("current_period_end") or shift(period_start, 30)

    existing = next((inv for inv in repo.find("invoices", {
        "school_id": school_id, "subscription_id": subscription["id"]})
        if str(inv.get("period_start") or "")[:10] == str(period_start)[:10]
        and inv.get("status") != VOID), None)
    if existing:
        return {"ok": True, "invoice": get_invoice(repo, existing["id"]), "already": True}

    counted = usage_lib.count_students(store, repo, school_id)
    quoted = engine.quote(repo, school_id, plan, counted["billable_students"],
                          subscription=subscription, at=period_start)

    school = store.get_school(school_id) or {}
    due_days = platform_settings.get_int(repo, "invoice_due_days", 7)
    # Three ways an invoice can be born, and they are not the same fact.
    #   EXEMPT — an exemption covered the bill. Nobody paid it and nobody owes
    #            it, and the revenue report must be able to say so (§27).
    #   PAID   — there was genuinely nothing to charge: a school with no pupils
    #            on a per-pupil plan. Marked settled at zero rather than exempt,
    #            because calling it exempt would put a paying customer in the
    #            column reserved for schools Nickland chose not to charge.
    #   OPEN   — there is money to collect.
    settled = status or (EXEMPT if quoted["is_exempt"]
                         else PAID if quoted["total_amount"] <= 0
                         else OPEN)

    invoice = repo.insert("invoices", {
        "invoice_number": next_number(repo),
        "school_id": school_id,
        "school_name": school.get("name") or school_id,
        "subscription_id": subscription["id"],
        "plan_id": plan["plan_id"],
        "plan_name": plan["name"],
        "status": settled,
        "currency": quoted["currency"],
        "period_start": period_start,
        "period_end": period_end,
        "student_count": quoted["students"],
        "price_per_student": quoted["price_per_student"],
        "base_amount": quoted["base_amount"],
        "gross_amount": quoted["gross_amount"],
        "discount_amount": quoted["discount_amount"],
        "discount_detail": quoted["discount_detail"],
        "exemption_amount": quoted["exemption_amount"],
        "exemption_detail": quoted["exemption_detail"],
        "tax_rate": quoted["tax_rate"],
        "tax_amount": quoted["tax_amount"],
        "total_amount": quoted["total_amount"],
        "amount_paid": 0,
        "issued_at": now_iso(),
        "due_at": shift(now_iso(), due_days),
        "paid_at": now_iso() if settled in (EXEMPT, PAID) else None,
        "created_at": now_iso(),
    })
    for line in engine.quote_lines(quoted):
        repo.insert("invoice_items", {**line, "invoice_id": invoice["id"], "school_id": school_id})

    if quoted.get("discount_id"):
        adjustments.consume_cycle(repo, quoted["discount_id"])
    usage_lib.snapshot(store, repo, school_id, plan["plan_id"])

    billing_audit.write(store, "invoice_raised", school_id=school_id, actor=actor,
                        detail=f'{invoice["invoice_number"]}: {quoted["currency"]} '
                               f'{quoted["total_amount"]:,.2f} for {quoted["students"]} pupils '
                               f'({settled}).')
    return {"ok": True, "invoice": get_invoice(repo, invoice["id"]),
            "exempt": settled == EXEMPT, "quote": quoted}


def mark_paid(store, repo, invoice_id, amount=None, actor="system", reference=""):
    invoice = repo.get("invoices", invoice_id)
    if not invoice:
        return {"ok": False, "status": 404, "error": "No such invoice."}
    if invoice["status"] in (PAID, EXEMPT, VOID):
        return {"ok": True, "invoice": get_invoice(repo, invoice_id), "already": True}
    paid = money(invoice["total_amount"] if amount is None else amount)
    updated = repo.update("invoices", invoice_id, {
        "status": PAID, "amount_paid": paid, "paid_at": now_iso()})
    billing_audit.write(store, "invoice_paid", school_id=invoice["school_id"], actor=actor,
                        detail=f'{invoice["invoice_number"]}: settled '
                               f'{invoice["currency"]} {paid:,.2f}. {reference}'.strip())
    return {"ok": True, "invoice": get_invoice(repo, updated["id"])}


def void(store, repo, invoice_id, actor="platform", reason=""):
    invoice = repo.get("invoices", invoice_id)
    if not invoice:
        return {"ok": False, "status": 404, "error": "No such invoice."}
    if invoice["status"] == PAID:
        return {"ok": False, "status": 400,
                "error": "A paid invoice cannot be voided. Refund the payment instead."}
    updated = repo.update("invoices", invoice_id, {
        "status": VOID, "voided_at": now_iso(),
        "notes": (invoice.get("notes") or "") + (f" Voided: {reason}" if reason else " Voided.")})
    billing_audit.write(store, "invoice_voided", school_id=invoice["school_id"], actor=actor,
                        detail=f'{invoice["invoice_number"]}: voided. {reason}'.strip())
    return {"ok": True, "invoice": get_invoice(repo, updated["id"])}


def mark_exempt(store, repo, invoice_id, actor="platform", reason=""):
    """Mark an invoice EXEMPT after the fact — an exemption granted late, with
    a bill already open. The figures stay; only what is owed changes."""
    invoice = repo.get("invoices", invoice_id)
    if not invoice:
        return {"ok": False, "status": 404, "error": "No such invoice."}
    if invoice["status"] in (PAID, VOID):
        return {"ok": False, "status": 400,
                "error": f"That invoice is {invoice['status'].lower()} and cannot be made exempt."}
    updated = repo.update("invoices", invoice_id, {
        "status": EXEMPT,
        "exemption_amount": money(invoice["total_amount"]),
        "exemption_detail": reason or invoice.get("exemption_detail") or "Exempt",
        "total_amount": 0, "paid_at": now_iso()})
    repo.insert("invoice_items", {
        "invoice_id": invoice["id"], "school_id": invoice["school_id"], "kind": "exemption",
        "description": reason or "Payment exemption",
        "quantity": 1, "unit_amount": -money(invoice["total_amount"]),
        "amount": -money(invoice["total_amount"]), "sort_order": 9})
    billing_audit.write(store, "invoice_exempted", school_id=invoice["school_id"], actor=actor,
                        detail=f'{invoice["invoice_number"]}: marked exempt. {reason}'.strip())
    return {"ok": True, "invoice": get_invoice(repo, updated["id"])}


def age_invoices(store, repo, at=None):
    """Open invoices whose due date has passed become PAST_DUE, and their
    school's subscription is told. Part of the billing run."""
    at = at or now_iso()
    when = parse_iso(at)
    aged = []
    for invoice in repo.find("invoices", {"status": OPEN}):
        due = parse_iso(invoice.get("due_at"))
        if not due or when < due:
            continue
        repo.update("invoices", invoice["id"], {"status": PAST_DUE})
        subscription = subs.current(repo, invoice["school_id"])
        if subscription and subscription["status"] in (subs.ACTIVE, subs.TRIALING):
            subs.mark_past_due(
                store, repo, subscription, actor="system",
                reason=f'{invoice["invoice_number"]} was not settled by '
                       f'{str(invoice.get("due_at"))[:10]}.')
        aged.append(invoice["invoice_number"])
    return aged


def run_billing(store, repo, at=None, school_id=None):
    """The billing run: one pass over every school that owes something.

    In order, because each step depends on the one before:

      1. Move subscriptions along — trials that ended, grace that ran out.
      2. Raise an invoice for any live subscription whose period has ended and
         which has not already been billed for it.
      3. Age open invoices past their due date, and mark their schools PAST_DUE.

    Safe to run as often as you like. Every step is idempotent, and step 2 is
    guarded by the one-invoice-per-period rule rather than by a flag somebody
    has to remember to set.
    """
    at = at or now_iso()
    when = parse_iso(at)
    report = {"at": at, "advanced": [], "invoiced": [], "exempt": [], "aged": [], "errors": []}

    report["advanced"] = [
        {"school_id": s["school_id"], "status": s["status"]}
        for s in subs.advance(store, repo, school_id=school_id, at=at)]

    scope = {"school_id": school_id} if school_id else {}
    for subscription in repo.find("subscriptions", {**scope, "status": ("in", list(subs.LIVE))}):
        period_end = parse_iso(subscription.get("current_period_end"))
        if subscription["status"] == subs.TRIALING:
            continue                       # a trial is not billed; its end is step 1's business
        if not period_end or when < period_end:
            continue
        try:
            raised = raise_invoice(store, repo, subscription["school_id"],
                                   subscription=subscription,
                                   period_start=subscription.get("current_period_start"),
                                   period_end=subscription.get("current_period_end"),
                                   actor="system")
        except Exception as exc:           # one school's bad row must not stop the run
            report["errors"].append({"school_id": subscription["school_id"], "error": str(exc)})
            continue
        if not raised.get("ok"):
            report["errors"].append({"school_id": subscription["school_id"],
                                     "error": raised.get("error")})
            continue
        if raised.get("already"):
            continue
        invoice = raised["invoice"]
        (report["exempt"] if raised.get("exempt") else report["invoiced"]).append({
            "school_id": subscription["school_id"],
            "invoice_number": invoice["invoice_number"],
            "total": invoice["total_amount"], "currency": invoice["currency"]})

        # A fully exempt school is never sent to a payment provider (§10), and
        # neither is a school with nothing to pay. The period simply rolls; an
        # exempt school is a customer in good standing.
        days = plan_lib.interval_days(subscription.get("billing_interval"))
        if raised.get("exempt") or raised["invoice"]["status"] == PAID:
            repo.update("subscriptions", subscription["id"], {
                "current_period_start": at, "current_period_end": shift(at, days),
                "status": subs.ACTIVE, "updated_at": at})

    report["aged"] = age_invoices(store, repo, at=at)
    return report


def revenue_report(repo, school_id=None, since=None):
    """§27's waterfall, in one pass over the invoices.

        Gross → discounts → exemptions → net billed → collected → outstanding

    Computed in Python over the invoice rows rather than in SQL, because the
    two storage backends have to answer identically and because the largest
    deployment this product will plausibly have is a few thousand invoices a
    year. When that stops being true, this is the function to rewrite — and the
    shape it returns is the contract, not the loop.
    """
    where = {}
    if school_id:
        where["school_id"] = school_id
    totals = {
        "gross": 0.0, "discounts": 0.0, "exemptions": 0.0, "tax": 0.0,
        "net_billed": 0.0, "collected": 0.0, "outstanding": 0.0,
        "invoices": 0, "exempt_invoices": 0, "paid_invoices": 0,
        "overdue_invoices": 0, "voided_invoices": 0,
    }
    cutoff = parse_iso(since) if since else None
    by_status = {}
    for invoice in repo.find("invoices", where):
        if cutoff:
            issued = parse_iso(invoice.get("issued_at"))
            if issued and issued < cutoff:
                continue
        status = invoice["status"]
        by_status[status] = by_status.get(status, 0) + 1
        if status == VOID:
            totals["voided_invoices"] += 1
            continue
        totals["invoices"] += 1
        totals["gross"] += float(invoice["gross_amount"] or 0)
        totals["discounts"] += float(invoice["discount_amount"] or 0)
        totals["exemptions"] += float(invoice["exemption_amount"] or 0)
        totals["tax"] += float(invoice["tax_amount"] or 0)
        totals["net_billed"] += float(invoice["total_amount"] or 0)
        if status == PAID:
            totals["paid_invoices"] += 1
            totals["collected"] += float(invoice["amount_paid"] or invoice["total_amount"] or 0)
        elif status == EXEMPT:
            # The line that §27 exists for. An exempt invoice is neither
            # collected nor outstanding: nobody owes it and nobody paid it.
            totals["exempt_invoices"] += 1
        elif status in OUTSTANDING:
            totals["outstanding"] += float(invoice["total_amount"] or 0)
            if status == PAST_DUE:
                totals["overdue_invoices"] += 1
    return {**{k: (money(v) if isinstance(v, float) else v) for k, v in totals.items()},
            "by_status": by_status}
