"""The billing engine — one calculation, used by everything.

    Plan
      ↓
    Billable pupils
      ↓
    Base price + (pupils × price per pupil)      = GROSS
      ↓
    School discount                              − discount
      ↓
    Payment exemption                            − exemption
      ↓
    Tax                                          + tax
      ↓
    FINAL

Every screen that shows a school what it will pay — the pricing page's
estimator, the checkout, the school's own billing portal, the invoice run, the
Superadmin's school detail — calls ``quote``. That is not tidiness. Four
implementations of this waterfall would be four chances for the number on the
website to differ from the number on the invoice, and the school finds out
which one was wrong at the worst possible moment.

Two rules the shape of this enforces:

  * **A discount never becomes an exemption.** They are computed in sequence
    and reported separately, and both stay on the invoice, because "a school
    that negotiated 20% off" and "a school Nickland decided not to charge" must
    never collapse into the same number in the revenue report (§27).
  * **A quote is a value, not a promise.** It carries the figures it used —
    the price per pupil, the pupil count, the discount rule that applied — so
    when it is turned into an invoice, the invoice keeps THOSE figures rather
    than a reference to a plan somebody may edit in March (§19).
"""
from . import plans as plan_lib
from . import settings as platform_settings
from .repo import money, now_iso, parse_iso


# ── Discounts and exemptions that are in force ──────────────────────────────
def active_discount(repo, school_id, at=None):
    """The discount in force for this school, or None.

    A school may have several rows over its life — one expired, one revoked,
    one running — so this picks the one that is live at ``at``. Where more than
    one qualifies (which the console permits, and which happens when a renewal
    discount is granted before the old one lapses) the school gets the BEST of
    them, once. Stacking two would be a decision nobody made.
    """
    when = parse_iso(at or now_iso())
    live = []
    for row in repo.find("school_discounts", {"school_id": school_id, "is_active": True}):
        if row.get("revoked_at"):
            continue
        starts = parse_iso(row.get("starts_at"))
        ends = parse_iso(row.get("ends_at"))
        if starts and when < starts:
            continue
        if ends and when > ends:
            continue
        if row.get("cycles") is not None and int(row.get("cycles_used") or 0) >= int(row["cycles"]):
            continue
        live.append(row)
    if not live:
        return None
    # Best by face value. It orders two percentages correctly and two fixed
    # amounts correctly, and only ever has to choose between a percentage and a
    # fixed amount in the rare case where a school holds both — where either
    # answer is defensible and the important property is that it is the same
    # answer every time, not that it is the larger one. Comparing them properly
    # would need the gross, which is not known here, and making this depend on
    # it would make the discount a school gets depend on when it was asked for.
    return max(live, key=lambda d: float(d.get("value") or 0))


def active_exemption(repo, school_id, at=None):
    when = parse_iso(at or now_iso())
    for row in repo.find("payment_exemptions", {"school_id": school_id, "is_active": True},
                         order_by="percent", desc=True):
        if row.get("revoked_at"):
            continue
        starts = parse_iso(row.get("starts_at"))
        ends = parse_iso(row.get("ends_at"))
        if starts and when < starts:
            continue
        if ends and when > ends:
            continue
        return row
    return None


def describe_discount(discount, currency="GHS"):
    if not discount:
        return ""
    if str(discount.get("kind")) == "percent":
        head = f"{_plain(discount.get('value'))}% off"
    else:
        head = f"{currency} {money(discount.get('value')):,.2f} off"
    label = str(discount.get("label") or "").strip()
    return f"{head} — {label}" if label else head


def describe_exemption(exemption):
    if not exemption:
        return ""
    percent = float(exemption.get("percent") or 0)
    head = "Fully exempt" if percent >= 100 else f"{_plain(percent)}% exempt"
    reason = str(exemption.get("reason") or "").strip()
    return f"{head} — {reason}" if reason else head


def _plain(value):
    """A percentage a person would write: 20, not 20.0; 12.5 stays 12.5."""
    number = float(value or 0)
    return int(number) if number == int(number) else round(number, 2)


# ── The calculation ─────────────────────────────────────────────────────────
def quote(repo, school_id, plan, students, subscription=None, at=None):
    """What this school would pay, for one billing period, right now.

    ``plan`` is a plan row (decorated or raw); ``students`` the billable roll;
    ``subscription`` the school's own subscription, which may carry negotiated
    prices that override the plan's. Nothing is written.
    """
    at = at or now_iso()
    subscription = subscription or {}
    currency = str(subscription.get("currency") or plan.get("currency")
                   or platform_settings.get(repo, "currency", "GHS"))

    # A negotiated price is a property of the subscription and beats the plan;
    # the plan is never edited for one school (§9).
    base_price = subscription.get("base_price_override")
    base_price = money(plan.get("base_price") if base_price is None else base_price)
    per_student = subscription.get("price_per_student_override")
    per_student = money(plan.get("price_per_student") if per_student is None else per_student)

    roll = max(0, int(students or 0))
    included = max(0, int(plan.get("included_students") or 0))
    chargeable = max(0, roll - included)
    student_amount = money(chargeable * per_student)
    gross = money(base_price + student_amount)

    discount = active_discount(repo, school_id, at)
    discount_amount = 0.0
    if discount:
        if str(discount.get("kind")) == "percent":
            discount_amount = money(gross * float(discount.get("value") or 0) / 100.0)
        else:
            discount_amount = money(discount.get("value"))
        # A discount can take a bill to nothing and never below it. A negative
        # invoice is a credit note, which this platform does not issue.
        discount_amount = money(min(discount_amount, gross))
    net = money(gross - discount_amount)

    exemption = active_exemption(repo, school_id, at)
    exemption_amount = 0.0
    if exemption:
        exemption_amount = money(min(net * float(exemption.get("percent") or 0) / 100.0, net))
    payable = money(net - exemption_amount)

    tax_rate = platform_settings.get_float(repo, "tax_rate", 0.0)
    tax_amount = money(payable * tax_rate / 100.0) if tax_rate else 0.0
    total = money(payable + tax_amount)

    return {
        "currency": currency,
        "plan_id": plan.get("plan_id"),
        "plan_name": plan.get("name"),
        "billing_interval": subscription.get("billing_interval") or plan.get("billing_interval") or "monthly",
        "interval_label": plan_lib.interval_label(
            subscription.get("billing_interval") or plan.get("billing_interval")),
        "students": roll,
        "included_students": included,
        "chargeable_students": chargeable,
        "price_per_student": per_student,
        "base_amount": base_price,
        "student_amount": student_amount,
        "gross_amount": gross,
        "discount_amount": discount_amount,
        "discount_detail": describe_discount(discount, currency),
        "discount_id": discount.get("id") if discount else None,
        "net_amount": net,
        "exemption_amount": exemption_amount,
        "exemption_detail": describe_exemption(exemption),
        "exemption_id": exemption.get("id") if exemption else None,
        # An exemption that covers the whole bill is not a zero invoice — it is
        # an EXEMPT invoice, and the difference is the whole of §10 and §27.
        "is_exempt": bool(exemption) and payable <= 0 and net > 0,
        "tax_rate": tax_rate,
        "tax_label": platform_settings.get(repo, "tax_label", "VAT"),
        "tax_amount": tax_amount,
        "total_amount": total,
        "quoted_at": at,
    }


def quote_lines(quoted):
    """A quote as the lines that go on an invoice and on a bill preview.

    Written once here so the invoice, the school's billing page and the
    console's preview all itemise a bill the same way.
    """
    lines = []
    if quoted["base_amount"]:
        lines.append({"kind": "subscription", "description":
                      f"{quoted['plan_name']} plan — {quoted['interval_label']}",
                      "quantity": 1, "unit_amount": quoted["base_amount"],
                      "amount": quoted["base_amount"], "sort_order": 1})
    if quoted["chargeable_students"] or quoted["price_per_student"]:
        lines.append({"kind": "per_student", "description":
                      f"{quoted['plan_name']} — {quoted['chargeable_students']} pupil"
                      f"{'' if quoted['chargeable_students'] == 1 else 's'} at "
                      f"{quoted['currency']} {quoted['price_per_student']:,.2f}",
                      "quantity": quoted["chargeable_students"],
                      "unit_amount": quoted["price_per_student"],
                      "amount": quoted["student_amount"], "sort_order": 2})
    if quoted["discount_amount"]:
        lines.append({"kind": "discount", "description": quoted["discount_detail"] or "Discount",
                      "quantity": 1, "unit_amount": -quoted["discount_amount"],
                      "amount": -quoted["discount_amount"], "sort_order": 3})
    if quoted["exemption_amount"]:
        lines.append({"kind": "exemption", "description": quoted["exemption_detail"] or "Exempt",
                      "quantity": 1, "unit_amount": -quoted["exemption_amount"],
                      "amount": -quoted["exemption_amount"], "sort_order": 4})
    if quoted["tax_amount"]:
        lines.append({"kind": "tax",
                      "description": f"{quoted['tax_label']} at {_plain(quoted['tax_rate'])}%",
                      "quantity": 1, "unit_amount": quoted["tax_amount"],
                      "amount": quoted["tax_amount"], "sort_order": 5})
    if not lines:
        lines.append({"kind": "subscription",
                      "description": f"{quoted['plan_name']} plan — {quoted['interval_label']}",
                      "quantity": 1, "unit_amount": 0, "amount": 0, "sort_order": 1})
    return lines


def estimate(repo, plan, students, tax_rate=None, currency=None):
    """The pricing page's sum: a plan and a pupil count, with no school.

    Deliberately separate from ``quote``: nobody has been identified, so there
    is no discount and no exemption to apply, and pretending otherwise on a
    public page would be quoting a price the visitor cannot have.
    """
    roll = max(0, int(students or 0))
    included = max(0, int(plan.get("included_students") or 0))
    chargeable = max(0, roll - included)
    per_student = money(plan.get("price_per_student"))
    base = money(plan.get("base_price"))
    gross = money(base + chargeable * per_student)
    rate = platform_settings.get_float(repo, "tax_rate", 0.0) if tax_rate is None else float(tax_rate)
    tax = money(gross * rate / 100.0) if rate else 0.0
    return {
        "plan_id": plan.get("plan_id"), "plan_name": plan.get("name"),
        "currency": currency or plan.get("currency") or platform_settings.get(repo, "currency", "GHS"),
        "students": roll, "chargeable_students": chargeable,
        "price_per_student": per_student, "base_amount": base,
        "gross_amount": gross, "tax_amount": tax, "total_amount": money(gross + tax),
        "interval_label": plan_lib.interval_label(plan.get("billing_interval")),
        "over_limit": (plan.get("max_students") is not None
                       and roll > int(plan["max_students"])),
        "max_students": plan.get("max_students"),
    }
