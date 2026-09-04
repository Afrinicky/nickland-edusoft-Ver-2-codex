"""Portals — which part of the system a person is handed.

A translation of ``electron/ipc/_portals.js``, which is the original, and the
twin of ``cloud/src/portals.js``. Kept literal: same portals, same order, same
answers. Nothing here grants anything — every request is still checked against
the projected permission map. This only decides what the app is told exists.
"""

PORTALS = [
    {"key": "parent",  "label": "Parent",         "rank": 0, "home": "/parent",  "tagline": "Your children"},
    {"key": "teacher", "label": "Teaching",       "rank": 1, "home": "/staff",   "tagline": "The working day"},
    {"key": "finance", "label": "Finance",        "rank": 2, "home": "/finance", "tagline": "The school’s money"},
    {"key": "admin",   "label": "Administration", "rank": 3, "home": "/admin",   "tagline": "Running the school"},
    {"key": "system",  "label": "System",         "rank": 4, "home": "/system",  "tagline": "The system itself"},
]

# The Super Admin: the one account with overall control of the system itself.
# A designation, not a permission tick. Not the Proprietor — they own the
# school and are elevated over its money, but running the system is a different
# job on purpose. See electron/ipc/_portals.js.
#
# It was called "Administrator" for the first two releases, which was the wrong
# word: every school has administrators, and naming the one account with total
# authority the same thing made a user list unreadable. The old name is still
# ACCEPTED and always will be — a projection pushed up before a school upgraded,
# a database restored from an older backup, a phone a release behind.
SUPER_ADMIN = "Super Admin"
SUPER_ADMIN_LEGACY = "Administrator"


def _norm(name):
    """Case- and space-insensitive: a school that typed "superadmin" by hand
    meant this, and a missing space is not a rule worth defending."""
    return "".join(str(name or "").split()).lower()


_SUPER_NAMES = {_norm(SUPER_ADMIN), _norm(SUPER_ADMIN_LEGACY)}

# The designations held back nowhere. One list, imported by access, scope and
# security, so "who is unrestricted" cannot be answered three different ways.
ELEVATED_NAMES = ["Proprietor", SUPER_ADMIN, SUPER_ADMIN_LEGACY]


def is_super_admin_name(name):
    return _norm(name) in _SUPER_NAMES


def is_elevated(name):
    return name == "Proprietor" or is_super_admin_name(name)


def is_super_admin(profile):
    return bool(profile) and (
        profile.get("is_super") is True or is_super_admin_name(profile.get("designation"))
    )


_BY_KEY = {p["key"]: p for p in PORTALS}
_ACTION_KEY = {"view": "canView", "create": "canCreate", "edit": "canEdit", "delete": "canDelete"}


def allows(profile, module, action="view"):
    if not profile:
        return False
    if profile.get("is_admin"):
        return True
    p = (profile.get("permissions") or {}).get(module)
    return bool(p and p.get(_ACTION_KEY.get(action, "canView")))


def _any_of(profile, pairs):
    return any(allows(profile, m, a) for m, a in pairs)


def _all_of(profile, pairs):
    return all(allows(profile, m, a) for m, a in pairs)


def portals_for(profile):
    if not profile:
        return []
    if profile.get("role") == "parent":
        return ["parent"]
    out = []
    # The working day belongs to people who teach or who run the canteen — not
    # to everybody on the payroll. A bursar handed a register they may open and
    # not use is the failure the whole product is written against.
    if allows(profile, "academics", "view") or allows(profile, "canteen", "create"):
        out.append("teacher")
    if _any_of(profile, [("fees", "view"), ("finance", "view"), ("payroll", "view")]):
        out.append("finance")
    if _all_of(profile, [("staff", "view"), ("students", "edit")]) or allows(profile, "settings", "view"):
        out.append("admin")
    if is_super_admin(profile):
        out.append("system")
    # An account with no module at all still has a payslip and a password.
    if not out:
        out.append("teacher")
    return sorted(out, key=lambda k: _BY_KEY[k]["rank"])


def home_portal(profile):
    held = portals_for(profile)
    if not held:
        return None
    daily = [k for k in held if k != "system"] or held
    return max(daily, key=lambda k: _BY_KEY[k]["rank"])


def portal_list_for(profile):
    return [
        {"key": p["key"], "label": p["label"], "home": p["home"], "tagline": p["tagline"], "rank": p["rank"]}
        for p in (_BY_KEY[k] for k in portals_for(profile))
    ]


def has_portal(profile, key):
    return key in portals_for(profile)
