"""Plans and features — the configurable half of the product.

A plan is a row. A feature is a row. Which plan holds which feature is a row.
Nothing in this module knows that a plan called "pro" exists, and nothing
anywhere else should either: the entitlement check asks whether THIS school's
plan holds `academics`, and the answer comes from the grid.

That indirection is the requirement (§6, §14) and it is also what makes the
console useful. Moving Payroll from Max to Pro is a click, takes effect on the
next request every school makes, and needs no deployment — because no code
anywhere was ever told which plan Payroll belonged to.
"""
from . import defaults, settings as platform_settings
from .repo import money, now_iso

INTERVALS = {
    # label, and how many days a period of it runs. A term is approximated at
    # a third of a year because Ghanaian terms are not a fixed length and
    # billing has to be able to say a date.
    "monthly": {"label": "per month", "days": 30, "short": "mo"},
    "termly": {"label": "per term", "days": 122, "short": "term"},
    "annual": {"label": "per year", "days": 365, "short": "yr"},
}


def interval_days(interval):
    return INTERVALS.get(str(interval or "monthly"), INTERVALS["monthly"])["days"]


def interval_label(interval):
    return INTERVALS.get(str(interval or "monthly"), INTERVALS["monthly"])["label"]


# ── Reading ─────────────────────────────────────────────────────────────────
def list_plans(repo, include_hidden=False, include_inactive=False):
    plans = repo.find("subscription_plans", order_by="sort_order")
    if not include_inactive:
        plans = [p for p in plans if p.get("is_active")]
    if not include_hidden:
        plans = [p for p in plans if p.get("is_public")]
    return [_decorate(repo, p) for p in plans]


def get_plan(repo, plan_id):
    plan = repo.get("subscription_plans", plan_id) if plan_id else None
    return _decorate(repo, plan) if plan else None


def list_features(repo):
    return repo.find("features", order_by="sort_order")


def feature_grid(repo):
    """Every plan against every feature — what the console's matrix draws."""
    features = list_features(repo)
    plans = repo.find("subscription_plans", order_by="sort_order")
    held = {}
    for row in repo.find("plan_features"):
        held[(row["plan_id"], row["feature_key"])] = row
    return {
        "features": features,
        "plans": [{"plan_id": p["plan_id"], "name": p["name"],
                   "is_active": p["is_active"], "is_public": p["is_public"]} for p in plans],
        "grid": [
            {
                "plan_id": p["plan_id"], "feature_key": f["feature_key"],
                # A core feature reads as held everywhere, because that is what
                # the enforcement point will do with it whatever the row says.
                "enabled": bool(f.get("is_core")) or bool(
                    (held.get((p["plan_id"], f["feature_key"])) or {}).get("enabled")),
                "is_core": bool(f.get("is_core")),
                "limit_value": (held.get((p["plan_id"], f["feature_key"])) or {}).get("limit_value"),
            }
            for p in plans for f in features
        ],
    }


def features_for_plan(repo, plan_id):
    """``{feature_key: True/False}`` for one plan, core features forced on.

    The single place the grid is turned into an answer. Everything that gates
    on a feature goes through here so there is one interpretation of a missing
    row (off) and one interpretation of a core feature (on, always).
    """
    out = {}
    core = set()
    for feature in list_features(repo):
        out[feature["feature_key"]] = False
        if feature.get("is_core"):
            core.add(feature["feature_key"])
    for row in repo.find("plan_features", {"plan_id": plan_id}):
        if row["feature_key"] in out:
            out[row["feature_key"]] = bool(row.get("enabled"))
    for key in core:
        out[key] = True
    return out


def limits_for_plan(repo, plan_id):
    """Numeric caps: the plan's own ``limits`` JSON, plus any per-feature
    ``limit_value``. Per-feature wins, being the more specific statement."""
    plan = repo.get("subscription_plans", plan_id) or {}
    out = dict(plan.get("limits") or {})
    if plan.get("max_students") is not None:
        out.setdefault("students", plan["max_students"])
    for row in repo.find("plan_features", {"plan_id": plan_id}):
        if row.get("limit_value") is not None:
            out[row["feature_key"]] = row["limit_value"]
    return out


def _decorate(repo, plan):
    """A plan as the website, console and checkout all want it: prices as
    floats, the interval said in words, and the features it holds."""
    features = features_for_plan(repo, plan["plan_id"])
    catalogue = {f["feature_key"]: f for f in list_features(repo)}
    return {
        **plan,
        "base_price": money(plan.get("base_price")),
        "price_per_student": money(plan.get("price_per_student")),
        "interval_label": interval_label(plan.get("billing_interval")),
        "interval_days": interval_days(plan.get("billing_interval")),
        "features": features,
        "feature_list": [
            {"feature_key": key, "name": catalogue[key]["name"],
             "category": catalogue[key]["category"], "description": catalogue[key]["description"]}
            for key in features if features[key] and key in catalogue
        ],
        "limits": dict(plan.get("limits") or {}),
    }


# ── Writing ─────────────────────────────────────────────────────────────────
_PLAN_FIELDS = {
    "name": str, "description": str, "tagline": str, "currency": str,
    "billing_interval": str, "base_price": float, "price_per_student": float,
    "included_students": int, "max_students": int, "trial_enabled": bool,
    "trial_days": int, "trial_to_plan": str, "requires_payment_method": bool,
    "is_active": bool, "is_public": bool, "sort_order": int, "limits": dict,
}

_PLAN_ID_OK = set("abcdefghijklmnopqrstuvwxyz0123456789-_")


def _coerce(field, value):
    kind = _PLAN_FIELDS[field]
    if value is None:
        # Only the genuinely optional columns may be cleared.
        return None if field in ("max_students", "trial_to_plan") else kind()
    if kind is bool:
        return str(value).strip().lower() in ("1", "true", "yes", "on") if not isinstance(value, bool) else value
    if kind is int:
        return int(float(value))
    if kind is float:
        return round(float(value), 2)
    if kind is dict:
        return value if isinstance(value, dict) else {}
    return str(value)


def create_plan(repo, data, actor="platform"):
    plan_id = str(data.get("plan_id") or "").strip().lower()
    if not plan_id or set(plan_id) - _PLAN_ID_OK or len(plan_id) > 40:
        return {"ok": False, "status": 400,
                "error": "A plan id is up to 40 lowercase letters, digits, dash or underscore."}
    if repo.get("subscription_plans", plan_id):
        return {"ok": False, "status": 409, "error": f'A plan called "{plan_id}" already exists.'}
    if not str(data.get("name") or "").strip():
        return {"ok": False, "status": 400, "error": "A plan needs a name."}

    row = {"plan_id": plan_id}
    for field in _PLAN_FIELDS:
        if field in data:
            row[field] = _coerce(field, data[field])
    row.setdefault("currency", platform_settings.get(repo, "currency", "GHS"))
    row.setdefault("billing_interval", "monthly")
    problem = _validate(row)
    if problem:
        return {"ok": False, "status": 400, "error": problem}

    created = repo.insert("subscription_plans", row)
    # Every feature gets a row, off by default. A plan whose grid was empty
    # would be indistinguishable from one whose features were all withheld,
    # and the console would have nothing to draw.
    for feature in list_features(repo):
        repo.insert("plan_features", {
            "plan_id": plan_id, "feature_key": feature["feature_key"],
            "enabled": bool(feature.get("is_core")), "limit_value": None})
    return {"ok": True, "plan": _decorate(repo, created)}


def update_plan(repo, plan_id, data):
    plan = repo.get("subscription_plans", plan_id)
    if not plan:
        return {"ok": False, "status": 404, "error": "No such plan."}
    patch = {}
    for field in _PLAN_FIELDS:
        if field in data:
            patch[field] = _coerce(field, data[field])
    if not patch:
        return {"ok": False, "status": 400, "error": "Nothing to change."}
    problem = _validate({**plan, **patch})
    if problem:
        return {"ok": False, "status": 400, "error": problem}
    patch["updated_at"] = now_iso()
    updated = repo.update("subscription_plans", plan_id, patch)
    return {"ok": True, "plan": _decorate(repo, updated)}


def _validate(row):
    if row.get("billing_interval") not in INTERVALS:
        return f"A billing interval is one of: {', '.join(INTERVALS)}."
    if float(row.get("base_price") or 0) < 0 or float(row.get("price_per_student") or 0) < 0:
        return "A price cannot be negative."
    if int(row.get("included_students") or 0) < 0:
        return "Included pupils cannot be negative."
    if row.get("max_students") is not None and int(row["max_students"]) < 0:
        return "A pupil ceiling cannot be negative."
    if row.get("trial_enabled") and int(row.get("trial_days") or 0) <= 0:
        return "A trial that is switched on needs a length in days."
    if len(str(row.get("currency") or "")) != 3:
        return "A currency is a three-letter code, such as GHS."
    return None


def set_plan_feature(repo, plan_id, feature_key, enabled, limit_value=None):
    if not repo.get("subscription_plans", plan_id):
        return {"ok": False, "status": 404, "error": "No such plan."}
    feature = repo.get("features", feature_key)
    if not feature:
        return {"ok": False, "status": 404, "error": "No such feature."}
    if feature.get("is_core") and not enabled:
        return {"ok": False, "status": 400,
                "error": f'"{feature["name"]}" is part of every plan and cannot be withheld.'}
    existing = repo.find_one("plan_features", {"plan_id": plan_id, "feature_key": feature_key})
    patch = {"enabled": bool(enabled),
             "limit_value": None if limit_value in (None, "") else int(limit_value)}
    if existing:
        repo.update_where("plan_features", {"plan_id": plan_id, "feature_key": feature_key}, patch)
    else:
        repo.insert("plan_features", {"plan_id": plan_id, "feature_key": feature_key, **patch})
    return {"ok": True, "plan_id": plan_id, "feature_key": feature_key, **patch}


def create_feature(repo, data):
    key = str(data.get("feature_key") or "").strip().lower()
    if not key or set(key) - set("abcdefghijklmnopqrstuvwxyz0123456789_"):
        return {"ok": False, "status": 400,
                "error": "A feature key is lowercase letters, digits and underscore."}
    if repo.get("features", key):
        return {"ok": False, "status": 409, "error": "That feature already exists."}
    if not str(data.get("name") or "").strip():
        return {"ok": False, "status": 400, "error": "A feature needs a name."}
    order = max([f.get("sort_order") or 0 for f in list_features(repo)] or [0]) + 1
    feature = repo.insert("features", {
        "feature_key": key, "name": str(data["name"]).strip(),
        "description": str(data.get("description") or ""),
        "category": str(data.get("category") or "Platform"),
        # A feature invented after launch is never core. Core means "no plan may
        # withhold this", and granting that retrospectively would silently open
        # something on every plan including Free.
        "is_core": False, "sort_order": order,
    })
    for plan in repo.find("subscription_plans"):
        repo.insert("plan_features", {"plan_id": plan["plan_id"], "feature_key": key,
                                      "enabled": False, "limit_value": None})
    return {"ok": True, "feature": feature}


def ensure_seeded(repo):
    """The defaults, if they are not there. Safe to call on every boot."""
    return defaults.seed(repo)
