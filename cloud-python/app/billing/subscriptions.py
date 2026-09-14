"""The subscription lifecycle.

    TRIALING ──► ACTIVE ──► PAST_DUE ──► GRACE_PERIOD ──► SUSPENDED
        │           ▲           │             │              │
        │           └───────────┴─────────────┴──────────────┘
        │                    payment succeeds
        └──► CANCELLED ──► TERMINATED

Two things this module refuses to do, and they are the two that matter.

**It never deletes anything.** SUSPENDED is a door, not a bin. A school that
stops paying keeps every pupil, every mark and every receipt, and gets them all
back the moment it pays. The only thing suspension changes is what the
application will let somebody do today.

**It is the source of truth, not the payment provider.** Paystack is asked
about money and is never asked whether a school may open its register. A
webhook that never arrived, an account somebody closed by mistake, a provider
having a bad morning — none of those may lock a school out of its own records.
The provider's events move state through this module, and this module decides.
"""
from . import audit as billing_audit
from . import plans as plan_lib
from . import settings as platform_settings
from .repo import now_iso, parse_iso, shift

TRIALING = "TRIALING"
ACTIVE = "ACTIVE"
PAST_DUE = "PAST_DUE"
GRACE_PERIOD = "GRACE_PERIOD"
SUSPENDED = "SUSPENDED"
CANCELLED = "CANCELLED"
TERMINATED = "TERMINATED"

# A school holding any of these has a subscription. The database enforces one
# at a time (idx_subscriptions_one_live), which is the duplicate-subscription
# protection §24 asks for — a double-submitted checkout loses on the second
# insert rather than on somebody remembering to check first.
LIVE = (TRIALING, ACTIVE, PAST_DUE, GRACE_PERIOD, SUSPENDED)
ENDED = (CANCELLED, TERMINATED)

# What each status means for somebody trying to use the system. `full` is
# ordinary use; `read_only` opens everything and refuses every write;
# `blocked` admits nothing but billing and sign-out.
ACCESS = {
    TRIALING: "full",
    ACTIVE: "full",
    PAST_DUE: "full",          # they have been told; nothing is withheld yet
    GRACE_PERIOD: "full",      # louder warnings, same access
    SUSPENDED: None,           # from `suspended_access` — a platform setting
    CANCELLED: "read_only",    # their data is theirs; they can export and return
    TERMINATED: "blocked",
}

STATUS_LABELS = {
    TRIALING: "On trial", ACTIVE: "Active", PAST_DUE: "Payment due",
    GRACE_PERIOD: "Grace period", SUSPENDED: "Suspended",
    CANCELLED: "Cancelled", TERMINATED: "Closed",
}


def current(repo, school_id):
    """The school's live subscription, or None.

    Ordered newest-first so that a school whose subscription ended and who has
    since resubscribed gets the new one — and so a school with only ended ones
    gets None rather than a cancelled row that looks live enough to fool a
    caller reading `plan_id` off it.
    """
    for row in repo.find("subscriptions", {"school_id": school_id}, order_by="id", desc=True):
        if row.get("status") in LIVE:
            return row
    return None


def latest(repo, school_id):
    """The most recent subscription whatever its state — what the console's
    school page shows when a school has left."""
    return repo.find_one("subscriptions", {"school_id": school_id}, order_by="id", desc=True)


def history(repo, school_id):
    return repo.find("subscriptions", {"school_id": school_id}, order_by="id", desc=True)


def events(repo, school_id, limit=100):
    return repo.find("subscription_events", {"school_id": school_id},
                     order_by="id", desc=True, limit=limit)


# ── Starting one ────────────────────────────────────────────────────────────
def start(store, repo, school_id, plan_id, actor="platform", with_trial=None,
          provider=None, provider_customer_id=None, notes=""):
    """Subscribe a school. Refuses if it already has a live subscription.

    ``with_trial`` unset means "whatever the plan and the platform say"; a
    caller can force it off (an operator moving a school onto a paid plan
    immediately) but cannot force it on for a plan that has no trial.
    """
    plan = repo.get("subscription_plans", plan_id)
    if not plan:
        return {"ok": False, "status": 404, "error": "No such plan."}
    if not plan.get("is_active"):
        return {"ok": False, "status": 400, "error": f'The {plan["name"]} plan is not open for new subscriptions.'}
    existing = current(repo, school_id)
    if existing:
        return {"ok": False, "status": 409,
                "error": "This school already has a subscription.",
                "subscription_id": existing["id"]}

    platform_trial = platform_settings.get_bool(repo, "trial_enabled", True)
    trial_days = int(plan.get("trial_days") or 0)
    wants_trial = plan.get("trial_enabled") and platform_trial and trial_days > 0
    if with_trial is False:
        wants_trial = False

    started = now_iso()
    period_days = plan_lib.interval_days(plan.get("billing_interval"))
    if wants_trial:
        status, trial_ends = TRIALING, shift(started, trial_days)
        period_end = trial_ends
    else:
        status, trial_ends = ACTIVE, None
        period_end = shift(started, period_days)

    try:
        row = repo.insert("subscriptions", {
            "school_id": school_id,
            "plan_id": plan["plan_id"],
            "status": status,
            "currency": plan.get("currency") or platform_settings.get(repo, "currency", "GHS"),
            "billing_interval": plan.get("billing_interval") or "monthly",
            "trial_ends_at": trial_ends,
            "current_period_start": started,
            "current_period_end": period_end,
            "provider": provider,
            "provider_customer_id": provider_customer_id,
            "notes": str(notes or ""),
            "created_at": started,
            "updated_at": started,
        })
    except Exception as exc:
        # The unique index doing its job: two checkouts raced, and the second
        # one lost. That is the correct outcome and not an error worth showing
        # a school — they have a subscription, which is what they asked for.
        again = current(repo, school_id)
        if again:
            return {"ok": True, "subscription": again, "already": True}
        return {"ok": False, "status": 503, "error": f"The subscription could not be created: {exc}"}

    _record(repo, row, "subscription_started", None, status,
            f'Subscribed to {plan["name"]}'
            + (f" with a {trial_days}-day trial." if wants_trial else "."), actor)
    billing_audit.write(store, "subscription_started", school_id=school_id, actor=actor,
                        detail=f'{school_id} subscribed to {plan["name"]} ({status}).')
    return {"ok": True, "subscription": row, "trial": wants_trial}


def change_plan(store, repo, school_id, plan_id, actor="platform", note=""):
    """Move a school between plans. An upgrade takes effect at once; a
    downgrade does too, and both are recorded with who did it.

    Deliberately immediate in both directions. Deferring a downgrade to the
    period end is the more common SaaS behaviour and it is the wrong one here:
    a school on a Ghanaian budget that has decided to spend less needs it to be
    less now, and the proration question does not arise because the next
    invoice is computed from the plan at the time it is raised.
    """
    subscription = current(repo, school_id)
    if not subscription:
        return {"ok": False, "status": 404, "error": "This school has no subscription."}
    plan = repo.get("subscription_plans", plan_id)
    if not plan:
        return {"ok": False, "status": 404, "error": "No such plan."}
    if subscription["plan_id"] == plan["plan_id"]:
        return {"ok": False, "status": 400, "error": f'Already on {plan["name"]}.'}

    was = repo.get("subscription_plans", subscription["plan_id"]) or {}
    updated = repo.update("subscriptions", subscription["id"], {
        "plan_id": plan["plan_id"],
        "billing_interval": plan.get("billing_interval") or subscription["billing_interval"],
        # A plan's own price now applies; any negotiated price was agreed
        # against the OLD plan and does not follow the school to a new one.
        "base_price_override": None,
        "price_per_student_override": None,
        "updated_at": now_iso(),
    })
    _record(repo, updated, "plan_changed", subscription["status"], updated["status"],
            f'{was.get("name") or subscription["plan_id"]} → {plan["name"]}'
            + (f" — {note}" if note else ""), actor)
    billing_audit.write(store, "plan_changed", school_id=school_id, actor=actor,
                        detail=f'{school_id}: {was.get("name") or subscription["plan_id"]} → {plan["name"]}.')
    return {"ok": True, "subscription": updated}


def set_price_override(store, repo, school_id, base=None, per_student=None, actor="platform", note=""):
    """A negotiated price for one school (§31).

    On the subscription, never on the plan: one school's deal must not move
    anybody else's price. Clearing both returns the school to the plan's price.
    """
    subscription = current(repo, school_id)
    if not subscription:
        return {"ok": False, "status": 404, "error": "This school has no subscription."}
    patch = {}
    if base is not None:
        patch["base_price_override"] = None if base == "" else round(float(base), 2)
    if per_student is not None:
        patch["price_per_student_override"] = None if per_student == "" else round(float(per_student), 2)
    if not patch:
        return {"ok": False, "status": 400, "error": "Nothing to change."}
    for key, value in patch.items():
        if value is not None and value < 0:
            return {"ok": False, "status": 400, "error": "A negotiated price cannot be negative."}
    updated = repo.update("subscriptions", subscription["id"], {**patch, "updated_at": now_iso()})
    _record(repo, updated, "price_overridden", subscription["status"], updated["status"],
            note or "A negotiated price was set for this school.", actor)
    billing_audit.write(store, "price_overridden", school_id=school_id, actor=actor,
                        detail=f"{school_id}: negotiated price set ({patch}).")
    return {"ok": True, "subscription": updated}


def cancel(store, repo, school_id, actor="platform", at_period_end=True, reason=""):
    """End a subscription. The school keeps its data and can come back."""
    subscription = current(repo, school_id)
    if not subscription:
        return {"ok": False, "status": 404, "error": "This school has no subscription."}
    now = now_iso()
    if at_period_end:
        updated = repo.update("subscriptions", subscription["id"], {
            "cancel_at_period_end": True, "updated_at": now})
        _record(repo, updated, "cancellation_scheduled", subscription["status"],
                subscription["status"],
                f'Ends {str(subscription.get("current_period_end") or "")[:10]}'
                + (f" — {reason}" if reason else ""), actor)
    else:
        updated = repo.update("subscriptions", subscription["id"], {
            "status": CANCELLED, "cancelled_at": now, "ended_at": now,
            "cancel_at_period_end": False, "updated_at": now})
        _record(repo, updated, "subscription_cancelled", subscription["status"], CANCELLED,
                reason or "Cancelled.", actor)
    billing_audit.write(store, "subscription_cancelled", school_id=school_id, actor=actor,
                        detail=f"{school_id}: cancelled"
                               f'{" at period end" if at_period_end else " immediately"}.')
    return {"ok": True, "subscription": updated}


def reactivate(store, repo, school_id, actor="platform", plan_id=None):
    """Bring a school back — from suspension, or after it cancelled.

    A suspended subscription resumes; an ended one is replaced by a new
    subscription rather than resurrected, so its dates and its history stay
    honest about the gap.
    """
    subscription = current(repo, school_id)
    if subscription and subscription["status"] == SUSPENDED:
        now = now_iso()
        days = plan_lib.interval_days(subscription.get("billing_interval"))
        updated = repo.update("subscriptions", subscription["id"], {
            "status": ACTIVE, "grace_ends_at": None,
            "current_period_start": now, "current_period_end": shift(now, days),
            "updated_at": now})
        _record(repo, updated, "reactivated", SUSPENDED, ACTIVE, "Access restored.", actor)
        billing_audit.write(store, "subscription_reactivated", school_id=school_id,
                            actor=actor, detail=f"{school_id}: reactivated from suspension.")
        return {"ok": True, "subscription": updated}
    if subscription:
        return {"ok": False, "status": 400,
                "error": f"That subscription is {STATUS_LABELS.get(subscription['status'], subscription['status'])}, not suspended."}

    previous = latest(repo, school_id)
    wanted = plan_id or (previous or {}).get("plan_id") or platform_settings.get(repo, "default_plan", "pro")
    return start(store, repo, school_id, wanted, actor=actor, with_trial=False,
                 notes="Resubscribed.")


def suspend(store, repo, school_id, actor="platform", reason=""):
    subscription = current(repo, school_id)
    if not subscription:
        return {"ok": False, "status": 404, "error": "This school has no subscription."}
    if subscription["status"] == SUSPENDED:
        return {"ok": True, "subscription": subscription, "already": True}
    updated = repo.update("subscriptions", subscription["id"], {
        "status": SUSPENDED, "grace_ends_at": None, "updated_at": now_iso()})
    _record(repo, updated, "suspended", subscription["status"], SUSPENDED,
            reason or "Suspended.", actor)
    billing_audit.write(store, "subscription_suspended", school_id=school_id, actor=actor,
                        detail=f"{school_id}: suspended. {reason}".strip())
    return {"ok": True, "subscription": updated}


def set_status(store, repo, school_id, status, actor="platform", reason=""):
    """A Superadmin's manual override (§13, §31). Audited, always.

    Every override is written to the subscription's own event log AND to the
    platform audit trail, because an override is by definition a decision that
    the rules would not have reached on their own, and the only thing that
    makes those safe is that they are all findable afterwards.
    """
    if status not in (*LIVE, *ENDED):
        return {"ok": False, "status": 400, "error": f"Not a subscription status: {status}."}
    subscription = current(repo, school_id) or latest(repo, school_id)
    if not subscription:
        return {"ok": False, "status": 404, "error": "This school has no subscription."}
    if subscription["status"] == status:
        return {"ok": True, "subscription": subscription, "already": True}
    patch = {"status": status, "updated_at": now_iso()}
    if status in ENDED:
        patch["ended_at"] = now_iso()
    if status in (ACTIVE, TRIALING):
        patch["grace_ends_at"] = None
    updated = repo.update("subscriptions", subscription["id"], patch)
    _record(repo, updated, "status_overridden", subscription["status"], status,
            reason or "Set by an operator.", actor)
    billing_audit.write(store, "subscription_overridden", school_id=school_id, actor=actor,
                        detail=f"{school_id}: {subscription['status']} → {status}. {reason}".strip())
    return {"ok": True, "subscription": updated}


# ── What a failed payment does over time ────────────────────────────────────
def mark_past_due(store, repo, subscription, actor="system", reason=""):
    """A payment failed. Nothing is withheld yet; the clock starts."""
    if subscription["status"] not in (ACTIVE, TRIALING):
        return subscription
    grace_days = (platform_settings.get_int(repo, "past_due_days", 7)
                  + platform_settings.get_int(repo, "grace_period_days", 14))
    updated = repo.update("subscriptions", subscription["id"], {
        "status": PAST_DUE, "grace_ends_at": shift(now_iso(), grace_days),
        "updated_at": now_iso()})
    _record(repo, updated, "payment_failed", subscription["status"], PAST_DUE,
            reason or "A payment did not go through.", actor)
    billing_audit.write(store, "payment_failed", school_id=subscription["school_id"],
                        actor=actor, outcome="failed",
                        detail=f"{subscription['school_id']}: payment failed. {reason}".strip())
    return updated


def mark_paid(store, repo, subscription, actor="system", detail=""):
    """A payment succeeded. Whatever the school was, it is ACTIVE now, with a
    fresh period — including out of SUSPENDED, which is the point of §11."""
    now = now_iso()
    days = plan_lib.interval_days(subscription.get("billing_interval"))
    updated = repo.update("subscriptions", subscription["id"], {
        "status": ACTIVE, "grace_ends_at": None,
        "current_period_start": now, "current_period_end": shift(now, days),
        "trial_ends_at": None if subscription["status"] == TRIALING else subscription.get("trial_ends_at"),
        "updated_at": now})
    if subscription["status"] != ACTIVE:
        _record(repo, updated, "payment_succeeded", subscription["status"], ACTIVE,
                detail or "Payment received.", actor)
    return updated


def advance(store, repo, school_id=None, at=None):
    """Move subscriptions along, as the calendar requires.

    Called by the billing run and by the Superadmin's "run billing now". Four
    transitions, each of which is simply a date having passed:

      * a trial that has ended            → the plan it was configured to land on
      * a cancellation scheduled for the period end, whose period has ended
      * PAST_DUE whose grace has run out  → GRACE_PERIOD then SUSPENDED
      * a period that has ended, unpaid, with no invoice yet — left alone here;
        raising the invoice is `invoices.run_billing`'s job, not this one's.

    Idempotent: running it twice in a minute does nothing the second time,
    because every transition is guarded on a date that has already moved.
    """
    at = at or now_iso()
    when = parse_iso(at)
    moved = []
    scope = ({"school_id": school_id} if school_id else {})
    for subscription in repo.find("subscriptions", {**scope, "status": ("in", list(LIVE))}):
        status = subscription["status"]

        if status == TRIALING:
            ends = parse_iso(subscription.get("trial_ends_at"))
            if ends and when >= ends:
                plan = repo.get("subscription_plans", subscription["plan_id"]) or {}
                landing = plan.get("trial_to_plan") or subscription["plan_id"]
                target = repo.get("subscription_plans", landing) or plan
                days = plan_lib.interval_days(target.get("billing_interval"))
                updated = repo.update("subscriptions", subscription["id"], {
                    "plan_id": target.get("plan_id") or subscription["plan_id"],
                    "status": ACTIVE, "trial_ends_at": None,
                    "billing_interval": target.get("billing_interval") or subscription["billing_interval"],
                    "current_period_start": at, "current_period_end": shift(at, days),
                    "updated_at": at})
                _record(repo, updated, "trial_ended", TRIALING, ACTIVE,
                        f'The trial ended; the school moved to {target.get("name") or landing}.',
                        "system")
                billing_audit.write(store, "trial_ended", school_id=subscription["school_id"],
                                    actor="system",
                                    detail=f'{subscription["school_id"]}: trial ended → '
                                           f'{target.get("name") or landing}.')
                moved.append(updated)
                continue

        if subscription.get("cancel_at_period_end"):
            ends = parse_iso(subscription.get("current_period_end"))
            if ends and when >= ends:
                updated = repo.update("subscriptions", subscription["id"], {
                    "status": CANCELLED, "cancelled_at": at, "ended_at": at, "updated_at": at})
                _record(repo, updated, "subscription_cancelled", status, CANCELLED,
                        "The scheduled cancellation took effect.", "system")
                moved.append(updated)
                continue

        # The two unpaid steps, in one pass and not one per run. They are both
        # simply dates having passed, and a school whose grace period ran out a
        # fortnight ago should be suspended the first time anybody looks —
        # rather than merely entering the grace period it has already sat out,
        # and waiting for tomorrow's run to notice.
        if status == PAST_DUE:
            due_days = platform_settings.get_int(repo, "past_due_days", 7)
            since = parse_iso(subscription.get("updated_at")) or when
            if (when - since).days >= due_days:
                subscription = repo.update("subscriptions", subscription["id"],
                                           {"status": GRACE_PERIOD, "updated_at": at})
                _record(repo, subscription, "grace_period_started", status, GRACE_PERIOD,
                        "The payment is still outstanding.", "system")
                moved.append(subscription)
                status = GRACE_PERIOD

        if status in (PAST_DUE, GRACE_PERIOD):
            grace_end = parse_iso(subscription.get("grace_ends_at"))
            if grace_end and when >= grace_end:
                updated = repo.update("subscriptions", subscription["id"],
                                      {"status": SUSPENDED, "updated_at": at})
                _record(repo, updated, "suspended", status, SUSPENDED,
                        "The grace period ended with the bill unpaid. "
                        "No data has been removed.", "system")
                billing_audit.write(store, "subscription_suspended",
                                    school_id=subscription["school_id"], actor="system",
                                    detail=f'{subscription["school_id"]}: suspended — '
                                           "grace period ended unpaid.")
                moved.append(updated)
                continue

    return moved


def trial_ending_soon(repo, within_days=3, at=None):
    """Schools whose trial ends inside the window — what a notification run
    would read. Kept here rather than in the notifier so "when does a trial end"
    is answered in the module that decides what a trial is."""
    at = at or now_iso()
    when = parse_iso(at)
    out = []
    for subscription in repo.find("subscriptions", {"status": TRIALING}):
        ends = parse_iso(subscription.get("trial_ends_at"))
        if ends and 0 <= (ends - when).days <= int(within_days):
            out.append({**subscription, "days_left": (ends - when).days})
    return out


def _record(repo, subscription, event, from_status, to_status, detail, actor):
    repo.insert("subscription_events", {
        "subscription_id": subscription.get("id"),
        "school_id": subscription.get("school_id"),
        "at": now_iso(), "event": event,
        "from_status": from_status, "to_status": to_status,
        "detail": str(detail or "")[:500], "actor": str(actor or "system")[:80],
    })
