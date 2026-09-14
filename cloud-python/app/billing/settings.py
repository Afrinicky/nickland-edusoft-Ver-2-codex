"""The platform's own configuration, read from the database.

Every SaaS rule that is not a plan lives here: the currency, the tax rate, how
long a school keeps working after a payment fails, whether trials are on at
all, what a suspended school may still do. All of it is rows, all of it is the
Superadmin's, and none of it needs a deployment to change.

Reads are typed and always answer something. A setting deleted by hand, emptied
by a bad form post, or simply never seeded falls back to the value in
``defaults.SETTINGS`` rather than raising — because the alternative is a
platform whose billing engine stops because a row is missing, which is a worse
failure than billing at the default rate for an hour.
"""
from . import defaults
from .repo import now_iso

# Cached per repo, because entitlement checks read these on every request to
# the school application and a database round trip per setting per request is
# not a thing to ship. Short-lived on purpose: a Superadmin changing the grace
# period should see it take effect while they are still looking at the screen,
# not after a redeploy.
_TTL_SECONDS = 30
_cache = {}


def _now():
    import time
    return time.monotonic()


def invalidate(repo=None):
    """Forget what was cached. Called by every write, so a change made in the
    console is live on the next request rather than up to _TTL_SECONDS later."""
    if repo is None:
        _cache.clear()
    else:
        _cache.pop(id(repo), None)


def all_settings(repo):
    """Every setting, defaults filled in for anything missing."""
    entry = _cache.get(id(repo))
    if entry and entry["expires"] > _now():
        return entry["values"]
    values = dict(defaults.SETTINGS)
    try:
        for row in repo.find("platform_settings"):
            if row.get("value") not in (None, ""):
                values[row["key"]] = row["value"]
            else:
                # An empty row is not a value. It is usually a form that posted
                # a blank field, and honouring it would set the currency to ""
                # or the grace period to zero days.
                values.setdefault(row["key"], defaults.SETTINGS.get(row["key"], ""))
    except Exception:
        # A database that is briefly unreachable must not stop a school from
        # signing in. The defaults are a safe platform, not a broken one.
        pass
    _cache[id(repo)] = {"values": values, "expires": _now() + _TTL_SECONDS}
    return values


def get(repo, key, fallback=None):
    value = all_settings(repo).get(key)
    if value in (None, ""):
        return defaults.SETTINGS.get(key, fallback)
    return value


def get_int(repo, key, fallback=0):
    try:
        return int(float(get(repo, key, fallback)))
    except (TypeError, ValueError):
        return fallback


def get_float(repo, key, fallback=0.0):
    try:
        return float(get(repo, key, fallback))
    except (TypeError, ValueError):
        return fallback


def get_bool(repo, key, fallback=False):
    value = get(repo, key, "1" if fallback else "0")
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def get_list(repo, key, fallback=()):
    raw = get(repo, key, "")
    items = [part.strip() for part in str(raw or "").split(",") if part.strip()]
    return items or list(fallback)


def set_many(repo, patch, actor="platform"):
    """Write settings. Unknown keys are refused rather than stored.

    Refused rather than accepted because this table is read by name from a
    dozen places: a typo stored happily would produce a setting that exists,
    is shown in the console, and changes nothing — which is the kind of bug
    that gets diagnosed by someone reading the source six months later.
    """
    known = set(defaults.SETTINGS)
    unknown = [k for k in (patch or {}) if k not in known]
    if unknown:
        return {"ok": False, "status": 400,
                "error": f"Not a platform setting: {', '.join(sorted(unknown))}."}
    written = {}
    for key, value in (patch or {}).items():
        text = "" if value is None else str(value)
        if repo.get("platform_settings", key):
            repo.update("platform_settings", key, {"value": text, "updated_at": now_iso()})
        else:
            repo.insert("platform_settings", {"key": key, "value": text,
                                              "updated_at": now_iso()})
        written[key] = text
    invalidate(repo)
    return {"ok": True, "settings": written}


def public_view(repo):
    """What the public website may know.

    A deliberate allowlist rather than "everything except the secrets", because
    the safe direction for a list like this to drift is shorter.
    """
    values = all_settings(repo)
    return {
        "currency": values.get("currency", "GHS"),
        "company_name": values.get("company_name", ""),
        "product_name": values.get("product_name", "Nickland Edusoft"),
        "support_email": values.get("support_email", ""),
        "support_phone": values.get("support_phone", ""),
        "trial_enabled": str(values.get("trial_enabled", "1")).strip() in ("1", "true", "yes"),
        "tax_label": values.get("tax_label", ""),
        "tax_rate": float(values.get("tax_rate") or 0),
    }
