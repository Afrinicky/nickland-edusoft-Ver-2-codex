"""Who may do what — a translation of the offline system's enforcement.

Three pieces, from three files on the desktop:

  * ``resolve_effective_permissions`` — electron/ipc/auth.js. Designation
    defaults, then per-user overrides, then the safety net that keeps a
    Proprietor or the Super Admin from ever being locked out of their own
    school by a missing row.
  * ``check_permission`` — electron/ipc/_security.js.
  * ``audit`` — the audit_log write the desktop's guard makes on every denial.

The online system enforces the SAME rules, resolved from the SAME tables, and
then adds one of its own: the portal (app/portals.py), which decides whether a
person is shown that a part of the system exists at all.

Nothing here trusts anything the client sent. The account is resolved from the
session token, the permissions from the account, and the designation from the
row — never from a header, a body or a projection.
"""
from . import access

_ACTION_KEY = {"view": "canView", "create": "canCreate", "edit": "canEdit", "delete": "canDelete"}

# The designations that may take destructive or controversial financial actions
# (voiding a bill, reversing a payment). Deliberately narrower than
# check_permission: an Accountant with fees:delete still cannot void a bill,
# because a voided bill rewrites what a parent was told they owed.
# Imported from app/portals.py rather than repeated, so "Super Admin" and its
# legacy spelling "Administrator" are recognised in one place.
from .. import portals as _portals

ELEVATED = _portals.ELEVATED_NAMES

# The Super Admin: overall control of the system itself. See app/portals.py.
SUPER_ADMIN = _portals.SUPER_ADMIN
SUPER_ADMIN_LEGACY = _portals.SUPER_ADMIN_LEGACY
is_super_admin_name = _portals.is_super_admin_name
is_elevated_name = _portals.is_elevated


def resolve_effective_permissions(db, user_id):
    result = {m: {"canView": False, "canCreate": False, "canEdit": False, "canDelete": False}
              for m in access.MODULE_KEYS}
    if not user_id:
        return result

    user = db.one(
        """SELECT u.id, u.designation_id, d.name AS designation_name
             FROM users u LEFT JOIN designations d ON d.id = u.designation_id
            WHERE u.id = %s""", (user_id,))
    if not user:
        return result

    # 1. Designation defaults.
    for p in db.all(
            """SELECT module, can_view, can_create, can_edit, can_delete
                 FROM designation_permissions WHERE designation_id = %s""",
            (user["designation_id"],)):
        if p["module"] in result:
            result[p["module"]] = {
                "canView": bool(p["can_view"]), "canCreate": bool(p["can_create"]),
                "canEdit": bool(p["can_edit"]), "canDelete": bool(p["can_delete"]),
            }

    # 2. Per-user overrides.
    for o in db.all(
            """SELECT module, can_view, can_create, can_edit, can_delete
                 FROM user_permission_overrides WHERE user_id = %s""", (user_id,)):
        if o["module"] in result:
            result[o["module"]] = {
                "canView": bool(o["can_view"]), "canCreate": bool(o["can_create"]),
                "canEdit": bool(o["can_edit"]), "canDelete": bool(o["can_delete"]),
            }

    # 3. The safety net. An administrator with no permissions at all is not a
    #    state this system should ever put a school in.
    if user.get("designation_name") in access.ALWAYS_FULL:
        for m in access.MODULE_KEYS:
            result[m] = {"canView": True, "canCreate": True, "canEdit": True, "canDelete": True}

    return result


def can(actor, module, action="view"):
    """May this signed-in account do this?

    ``actor`` is the resolved session: designation, permissions, and the flags
    derived from them. Everything in it came from the database on this request.
    """
    if not actor:
        return False
    if actor.get("is_admin"):
        return True
    p = (actor.get("permissions") or {}).get(module)
    return bool(p and p.get(_ACTION_KEY.get(action, "canView")))


def can_any(actor, pairs):
    return any(can(actor, m, a) for m, a in pairs)


def is_elevated(actor):
    return bool(actor) and is_elevated_name(actor.get("designation"))


def is_super_admin(actor):
    return bool(actor) and is_super_admin_name(actor.get("designation"))


def audit(db, actor, entity_type, entity_id, action, note="", severity="normal"):
    """Every write that reaches a school over the internet leaves a trace.

    Best-effort by design: auditing a write must never be the thing that fails
    it. The desktop's guard makes the same call and swallows the same errors.
    """
    try:
        db.run(
            """INSERT INTO audit_log (entity_type, entity_id, action, user_id, justification, severity)
                 VALUES (%s, %s, %s, %s, %s, %s)""",
            (entity_type, entity_id, action,
             (actor or {}).get("user_id"), str(note or "")[:500], severity))
    except Exception:
        pass


def deny(db, actor, what, message):
    """Record a refusal and describe it.

    Refusals are audited at high severity because a pattern of them is the
    earliest sign anybody gets that an account has been taken.
    """
    audit(db, actor, "security", None, "permission_denied", f"Denied {what}: {message}", "high")
    return {"ok": False, "error": message, "denied": True, "status": 403}
