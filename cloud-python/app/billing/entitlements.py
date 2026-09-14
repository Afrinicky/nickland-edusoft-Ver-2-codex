"""What a school may do today — the one question the application asks.

Everything else in `app/billing` decides what a school's subscription IS. This
module turns that into an answer the school application can act on:

    {"access": "full" | "read_only" | "blocked",
     "features": {"academics": True, "payroll": False, …},
     "limits":   {"students": 100, …},
     "status":   "TRIALING", "plan": {...}, "notice": "…"}

It is enforced in `app/school_api.py`, at `require()` — the one place every
guarded route already goes through to resolve who is calling. Frontend
restrictions are decoration; this is the fence (§14, §24).

Three decisions worth stating outright, because each of them is the difference
between a platform a school can trust and one it cannot:

**Grandfathering (§28).** A school that has NEVER had a subscription keeps full
access. Not a grace period — indefinitely, until somebody deliberately
subscribes it. Introducing billing must never be the reason a school that was
working yesterday cannot open its register this morning. The setting that turns
this off exists, and turning it off is a decision an operator makes with their
eyes open, on a day they have told the schools about.

**Failing open, on OUR faults.** If the billing tables cannot be read — a
database asleep, a migration half applied, a bug in this file — the answer is
full access. A school locked out of its pupils' records because Nickland's
platform had a bad morning is a far worse outcome than a school getting a day
of Payroll it had not paid for. Enforcement is for schools that have decided
not to pay, not for schools we have failed.

**Suspension never blocks by default.** `suspended_access` defaults to
`read_only`: the school can see everything it owns and can reach its billing
page to settle. Nothing is ever deleted, and the door reopens on payment.

Answers are cached for a few seconds per school. The enforcement point runs on
every request to the school application, and a database round trip per request
to ask a question whose answer changes a few times a year is not a thing to
ship. Short enough that a Superadmin suspending a school sees it take effect
while they are still looking at the screen.
"""
import threading
import time

from . import plans as plan_lib
from . import settings as platform_settings
from . import subscriptions as subs
from .repo import parse_iso, now_iso, repo_for

_TTL_SECONDS = 15
_cache = {}
_cache_lock = threading.Lock()

# Actions that change something. Everything else is a read, and a read-only
# school may do all of them.
WRITE_ACTIONS = ("create", "edit", "delete")


def invalidate(school_id=None):
    """Forget what was cached. Every subscription, discount, exemption and
    settings write calls this, so a change is live on the next request."""
    with _cache_lock:
        if school_id is None:
            _cache.clear()
        else:
            for key in [k for k in _cache if k[1] == school_id]:
                _cache.pop(key, None)


def for_school(store, school_id, fresh=False):
    """This school's entitlements. Cheap, cached, and never raises."""
    repo = repo_for(store)
    key = (id(store), str(school_id))
    if not fresh:
        with _cache_lock:
            entry = _cache.get(key)
            if entry and entry["expires"] > time.monotonic():
                return entry["value"]
    try:
        value = _resolve(store, repo, school_id)
    except Exception as exc:
        # Our fault, not theirs. See the module docstring.
        value = _open_platform(f"The billing service could not be read ({exc.__class__.__name__}).")
    with _cache_lock:
        _cache[key] = {"value": value, "expires": time.monotonic() + _TTL_SECONDS}
        if len(_cache) > 4000:                          # pragma: no cover — a very large platform
            _cache.clear()
    return value


def _open_platform(reason, plan=None, status="UNMANAGED"):
    """Full access, with the reason said out loud rather than implied."""
    return {
        "access": "full", "status": status, "status_label": "Not billed",
        "plan": plan, "plan_id": (plan or {}).get("plan_id"),
        "features": None,                 # None means "every feature", see `has_feature`
        "limits": {}, "notice": reason, "notice_level": "info",
        "subscription": None, "trial_days_left": None, "managed": False,
        "checked_at": now_iso(),
    }


def _resolve(store, repo, school_id):
    subscription = subs.current(repo, school_id)

    if not subscription:
        ever = subs.latest(repo, school_id)
        if not ever:
            if platform_settings.get_bool(repo, "grandfather_existing", True):
                plan_id = platform_settings.get(repo, "grandfather_plan", "max")
                plan = plan_lib.get_plan(repo, plan_id)
                return {**_open_platform(
                    "This school is not on a subscription. It has full access.",
                    plan=plan),
                    "features": (plan or {}).get("features"),
                    "limits": plan_lib.limits_for_plan(repo, plan_id) if plan else {}}
            return {
                "access": "blocked", "status": "NONE", "status_label": "No subscription",
                "plan": None, "plan_id": None, "features": {}, "limits": {},
                "notice": "This school has no subscription. "
                          "Choose a plan to carry on using Edusoft.",
                "notice_level": "blocked", "subscription": None,
                "trial_days_left": None, "managed": True, "checked_at": now_iso(),
            }
        # It had one and it ended. Their records stay readable so they can get
        # their data out and come back; nothing is deleted, ever.
        return {
            "access": "read_only", "status": ever["status"],
            "status_label": subs.STATUS_LABELS.get(ever["status"], ever["status"]),
            "plan": plan_lib.get_plan(repo, ever["plan_id"]), "plan_id": ever["plan_id"],
            "features": plan_lib.features_for_plan(repo, ever["plan_id"]),
            "limits": plan_lib.limits_for_plan(repo, ever["plan_id"]),
            "notice": "This subscription has ended. Everything here is still yours to "
                      "read and export; subscribe again to carry on working.",
            "notice_level": "blocked", "subscription": ever,
            "trial_days_left": None, "managed": True, "checked_at": now_iso(),
        }

    status = subscription["status"]
    plan = plan_lib.get_plan(repo, subscription["plan_id"])
    access = subs.ACCESS.get(status) or platform_settings.get(repo, "suspended_access", "read_only")
    if access not in ("full", "read_only", "blocked"):
        access = "read_only"

    trial_days_left = None
    if status == subs.TRIALING and subscription.get("trial_ends_at"):
        ends = parse_iso(subscription["trial_ends_at"])
        if ends:
            trial_days_left = max(0, (ends - parse_iso(now_iso())).days)

    return {
        "access": access,
        "status": status,
        "status_label": subs.STATUS_LABELS.get(status, status),
        "plan": plan,
        "plan_id": subscription["plan_id"],
        "features": plan_lib.features_for_plan(repo, subscription["plan_id"]),
        "limits": plan_lib.limits_for_plan(repo, subscription["plan_id"]),
        "notice": _notice(status, subscription, trial_days_left),
        "notice_level": _notice_level(status),
        "subscription": subscription,
        "trial_days_left": trial_days_left,
        "managed": True,
        "checked_at": now_iso(),
    }


def _notice(status, subscription, trial_days_left):
    if status == subs.TRIALING:
        if trial_days_left == 0:
            return "Your trial ends today. Your subscription starts tomorrow."
        if trial_days_left is not None and trial_days_left <= 7:
            return (f"Your trial ends in {trial_days_left} day"
                    f"{'' if trial_days_left == 1 else 's'}.")
        return "You are on a free trial."
    if status == subs.PAST_DUE:
        return ("A payment did not go through. Nothing has changed yet — please "
                "settle it from Billing.")
    if status == subs.GRACE_PERIOD:
        ends = str(subscription.get("grace_ends_at") or "")[:10]
        return (f"This subscription is unpaid. Access will be limited"
                f"{f' after {ends}' if ends else ' shortly'} until it is settled. "
                "Nothing will be deleted.")
    if status == subs.SUSPENDED:
        return ("This subscription is suspended for non-payment. Everything is still "
                "here — settle the outstanding invoice from Billing to restore it.")
    if status == subs.CANCELLED:
        return "This subscription has been cancelled."
    return ""


def _notice_level(status):
    return {
        subs.TRIALING: "info", subs.ACTIVE: "none", subs.PAST_DUE: "warn",
        subs.GRACE_PERIOD: "warn", subs.SUSPENDED: "blocked",
        subs.CANCELLED: "blocked", subs.TERMINATED: "blocked",
    }.get(status, "none")


# ── Asking the questions the application asks ───────────────────────────────
def has_feature(entitlement, feature_key):
    """Is this capability entitled here?

    `features` of None means "unmanaged — everything", which is what a
    grandfathered school and a failed-open platform both look like. An empty
    dict means the opposite, and the difference matters: `{}` is a school with
    a plan that grants nothing, `None` is a school we are not billing.
    """
    if not entitlement:
        return True
    features = entitlement.get("features")
    if features is None:
        return True
    return bool(features.get(feature_key, False))


def check(entitlement, module=None, action="view"):
    """The gate. Returns None when the request may proceed, or a refusal.

    A refusal is a dict with a message written for the person reading it and a
    `reason` the app can branch on — `subscription` or `feature` — because
    "your plan does not include Payroll" and "your subscription is suspended"
    lead to two completely different screens.
    """
    if not entitlement:
        return None

    access = entitlement.get("access", "full")
    if access == "blocked":
        return {"reason": "subscription", "status": entitlement.get("status"),
                "message": entitlement.get("notice")
                           or "This school's subscription does not allow access."}
    if access == "read_only" and action in WRITE_ACTIONS:
        return {"reason": "subscription", "status": entitlement.get("status"),
                "read_only": True,
                "message": entitlement.get("notice")
                           or "This school's subscription is read-only. "
                              "Nothing can be changed until it is settled."}

    if module and not has_feature(entitlement, module):
        plan_name = (entitlement.get("plan") or {}).get("name") or "this plan"
        return {"reason": "feature", "feature": module, "plan": plan_name,
                "message": f"{plan_name} does not include this part of Edusoft. "
                           "Ask your administrator to change the school's plan."}
    return None


def within_limit(entitlement, key, current_value):
    """A numeric cap, if the plan sets one. True when there is room."""
    limits = (entitlement or {}).get("limits") or {}
    cap = limits.get(key)
    if cap in (None, "", 0):
        return True
    try:
        return int(current_value) < int(cap)
    except (TypeError, ValueError):
        return True


def summary(entitlement):
    """The short form the app carries around and the banner draws from."""
    if not entitlement:
        return {"managed": False, "access": "full"}
    plan = entitlement.get("plan") or {}
    return {
        "managed": entitlement.get("managed", True),
        "access": entitlement.get("access"),
        "status": entitlement.get("status"),
        "status_label": entitlement.get("status_label"),
        "plan_id": entitlement.get("plan_id"),
        "plan_name": plan.get("name"),
        "features": entitlement.get("features"),
        "limits": entitlement.get("limits"),
        "trial_days_left": entitlement.get("trial_days_left"),
        "notice": entitlement.get("notice"),
        "notice_level": entitlement.get("notice_level"),
        # The three dates everything downstream counts from — the offline
        # licence's expiry, the reminder schedule, the banner that says how
        # long is left. Read off the subscription here so that each of them is
        # not separately re-deriving "when does this end", and disagreeing.
        **_dates(entitlement.get("subscription") or {}),
    }


def _dates(subscription):
    return {
        "trial_ends_at": subscription.get("trial_ends_at") or "",
        "current_period_end": subscription.get("current_period_end") or "",
        "grace_ends_at": subscription.get("grace_ends_at") or "",
    }
