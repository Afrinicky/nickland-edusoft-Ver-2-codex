"""Signing in to the online system, and staying signed in.

A translation of ``electron/server/tokens.js`` and the sign-in half of
``electron/ipc/auth.js``, onto the very same table: ``api_tokens`` already
exists in the school's schema, because the offline schema is the online schema.
Nothing new had to be invented to hold a session.

What the online system adds, because it is reachable from the internet and the
offline one is not:

  * A shorter default life for a session, and a hard cap on it.
  * Failed sign-ins are counted per account AND written to the school's own
    audit log, so the school can see an attack on it rather than only its
    hosting provider.
  * A password change, a deactivation or a designation change revokes every
    session that account holds. On the desktop the machine is in a locked
    office; here a stolen phone is somebody else's hands on the school.

The raw token is shown to the client exactly once. Only its SHA-256 hash is
stored, so a database leak cannot hand anybody a usable session.
"""
import datetime
import hashlib
import secrets
import threading
import time

from . import scope as scope_lib
from . import security

# Sessions over the internet are shorter than sessions on the school Wi-Fi.
DEFAULT_TTL_DAYS = 14
MAX_TTL_DAYS = 30

# Throttling a sign-in, without handing anybody a way to lock a teacher out.
#
# The desktop counts wrong passwords per USERNAME and locks the account for a
# minute. On one machine in a locked office that is right. On the internet it
# is a denial of service anybody can arrange: guess five times at the head
# teacher's username every minute and the head teacher never gets in.
#
# So the count is per (account, source). An attacker guessing from one address
# locks out that address, and the real person signing in from their own phone
# is unaffected. A much higher per-account backstop still catches a guess
# distributed across many addresses, at a threshold no honest person reaches.
MAX_LOGIN_FAILURES = 5           # from one source, against one account
MAX_ACCOUNT_FAILURES = 50        # from anywhere, against one account
LOCKOUT_SECONDS = 60

_failures = {}
_failures_lock = threading.Lock()


def _sha256(s):
    return hashlib.sha256(str(s).encode()).hexdigest()


def _now_text():
    """The timestamp format the whole schema uses — SQLite's, kept so a row
    written online sorts and compares with one written on the desktop."""
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _iso(days=0):
    return (datetime.datetime.now(datetime.timezone.utc)
            + datetime.timedelta(days=days)).isoformat()


# ── passwords ───────────────────────────────────────────────────────────────
# Staff passwords are bcrypt on the desktop and are verified here as-is, so a
# school moving online re-enrols nobody.
def verify_password(password, stored):
    if not stored or not str(stored).startswith("$2"):
        return False
    try:
        import bcrypt
        return bcrypt.checkpw(str(password).encode(), str(stored).encode())
    except Exception:
        return False


def hash_password(password):
    import bcrypt
    return bcrypt.hashpw(str(password).encode(), bcrypt.gensalt(10)).decode()


# ── throttling ──────────────────────────────────────────────────────────────
def _locked(key, threshold=MAX_LOGIN_FAILURES):
    with _failures_lock:
        rec = _failures.get(key)
        if not rec or rec["count"] < threshold:
            return 0
        remaining = rec["until"] - time.time()
        if remaining <= 0:
            _failures.pop(key, None)
            return 0
        return int(remaining) + 1


def _record_failure(key):
    with _failures_lock:
        rec = _failures.get(key) or {"count": 0, "until": 0}
        rec["count"] += 1
        rec["until"] = time.time() + LOCKOUT_SECONDS
        _failures[key] = rec
        if len(_failures) > 2000:
            now = time.time()
            for k in [k for k, v in _failures.items() if v["until"] < now]:
                _failures.pop(k, None)
        return rec["count"]


def _clear_failures(key):
    with _failures_lock:
        _failures.pop(key, None)


def reset_throttle():
    """Clear every counter. For tests; nothing in the service calls it."""
    with _failures_lock:
        _failures.clear()


# ── sign in ─────────────────────────────────────────────────────────────────
def sign_in(db, username, password, device=None, platform=None, source=None):
    username = str(username or "").strip()
    # Two keys: this source against this account, and the account from
    # anywhere. See the note above MAX_LOGIN_FAILURES for why both.
    source_key = f"{db.school_id}:{username.lower()}:{source or 'unknown'}"
    account_key = f"{db.school_id}:{username.lower()}:*"
    wait = _locked(source_key) or _locked(account_key, MAX_ACCOUNT_FAILURES)
    if wait:
        return {"ok": False, "status": 429,
                "error": f"Too many attempts. Try again in {wait} seconds."}

    user = db.one(
        """SELECT u.id, u.username, u.full_name, u.password_hash, u.is_active,
                  u.staff_id, u.must_change_password, d.name AS designation
             FROM users u LEFT JOIN designations d ON d.id = u.designation_id
            WHERE lower(u.username) = lower(%s)""", (username,))

    if not user or not user["is_active"] or not verify_password(password, user["password_hash"]):
        _record_failure(account_key)
        count = _record_failure(source_key)
        security.audit(db, None, "security", None, "login_failed",
                       f'Failed sign-in for "{username}"',
                       "high" if count >= MAX_LOGIN_FAILURES else "normal")
        # One message whether the account exists or not. Saying "that username
        # exists but the password is wrong" tells an outsider which of a
        # school's accounts are real.
        return {"ok": False, "status": 401,
                "error": "Those details did not match an account. Check and try again."}

    # A correct password clears this source's count. The account-wide backstop
    # is left alone: if fifty wrong guesses are in flight against somebody, the
    # fact that one of them finally worked is not a reason to stop counting.
    _clear_failures(source_key)
    token = issue_token(db, user["id"], device=device, platform=platform)
    db.run("UPDATE users SET last_login = %s WHERE id = %s", (_now_text(), user["id"]))
    security.audit(db, {"user_id": user["id"]}, "security", user["id"], "login",
                   f'{user["username"]} signed in online')
    return {
        "ok": True, "token": token["token"], "expires_at": token["expires_at"],
        "user": {"id": user["id"], "username": user["username"],
                 "full_name": user["full_name"], "staff_id": user["staff_id"]},
        "designation": user["designation"],
        "must_change_password": bool(user["must_change_password"]),
    }


def issue_token(db, user_id, device=None, platform=None):
    raw = secrets.token_urlsafe(32)
    try:
        ttl = int(db.get_setting("online_token_ttl_days", str(DEFAULT_TTL_DAYS)) or DEFAULT_TTL_DAYS)
    except (TypeError, ValueError):
        ttl = DEFAULT_TTL_DAYS
    ttl = max(1, min(ttl, MAX_TTL_DAYS))
    expires = _iso(ttl)
    token_id = db.insert("api_tokens", {
        "token_hash": _sha256(raw), "subject_type": "user", "subject_id": user_id,
        "device_name": device, "platform": platform or "online", "expires_at": expires,
    })
    return {"token": raw, "id": token_id, "expires_at": expires}


def revoke_token(db, token_id):
    db.run("UPDATE api_tokens SET revoked = 1 WHERE id = %s", (token_id,))
    return {"ok": True}


def revoke_all_for_user(db, user_id):
    """Every session that account holds, gone.

    Called on a password change, a deactivation and a change of designation.
    Leaving a live session behind after any of those means the change did not
    actually happen until the token expired.
    """
    db.run("UPDATE api_tokens SET revoked = 1 WHERE subject_type = 'user' AND subject_id = %s",
           (user_id,))
    return {"ok": True}


# ── the signed-in person, resolved fresh on every request ───────────────────
def actor_for(db, raw_token):
    """Resolve a bearer token to who is acting, or None.

    Everything is re-read: the account, whether it is still active, its
    designation, its permissions and its teaching scope. A permission withdrawn
    in the office therefore takes effect on the next tap, not on the next
    sign-in — and a deactivated account's session dies on its next request
    rather than lasting until the token happens to expire.
    """
    if not raw_token:
        return None
    row = db.one(
        "SELECT id, subject_type, subject_id, revoked, expires_at FROM api_tokens WHERE token_hash = %s",
        (_sha256(raw_token),))
    if not row or row["revoked"] or row["subject_type"] != "user":
        return None
    if row["expires_at"] and str(row["expires_at"]) < _iso(0):
        return None

    user = db.one(
        """SELECT u.id, u.username, u.full_name, u.staff_id, u.is_active,
                  u.must_change_password, u.photo_path, d.name AS designation
             FROM users u LEFT JOIN designations d ON d.id = u.designation_id
            WHERE u.id = %s""", (row["subject_id"],))
    if not user or not user["is_active"]:
        return None

    try:
        db.run("UPDATE api_tokens SET last_used_at = %s WHERE id = %s", (_now_text(), row["id"]))
    except Exception:
        pass

    permissions = security.resolve_effective_permissions(db, user["id"])
    return {
        "user_id": user["id"], "token_id": row["id"],
        "username": user["username"], "full_name": user["full_name"],
        "staff_id": user["staff_id"], "designation": user["designation"],
        "is_admin": user["designation"] in security.ELEVATED,
        "is_super": user["designation"] == security.SUPER_ADMIN,
        "must_change_password": bool(user["must_change_password"]),
        "permissions": permissions,
        "scope": scope_lib.scope_for(db, user["id"], user["designation"]),
        # The shape app/portals.py reads.
        "role": "staff",
    }


# ── parents ─────────────────────────────────────────────────────────────────
# Parents get the same throttling, the same audit trail and the same revocable
# sessions as staff. The offline system gives them none of that — a parent
# password may be four characters there and a failed attempt is not recorded —
# which is defensible on one machine in a locked office and is not defensible
# on the internet. Same table, same rules, different subject type.

def parent_sign_in(db, identifier, password, device=None, platform=None, source=None):
    from . import parents as parents_lib

    identifier = str(identifier or "").strip()
    source_key = f"{db.school_id}:parent:{identifier.lower()}:{source or 'unknown'}"
    account_key = f"{db.school_id}:parent:{identifier.lower()}:*"
    wait = _locked(source_key) or _locked(account_key, MAX_ACCOUNT_FAILURES)
    if wait:
        return {"ok": False, "status": 429,
                "error": f"Too many attempts. Try again in {wait} seconds."}

    result = parents_lib.sign_in(db, identifier, password)
    if not result.get("ok"):
        _record_failure(account_key)
        count = _record_failure(source_key)
        security.audit(db, None, "security", None, "parent_login_failed",
                       f'Failed parent sign-in for "{identifier}"',
                       "high" if count >= MAX_LOGIN_FAILURES else "normal")
        return result

    _clear_failures(source_key)
    parent = result["parent"]
    raw = secrets.token_urlsafe(32)
    try:
        ttl = int(db.get_setting("online_token_ttl_days", str(DEFAULT_TTL_DAYS)) or DEFAULT_TTL_DAYS)
    except (TypeError, ValueError):
        ttl = DEFAULT_TTL_DAYS
    ttl = max(1, min(ttl, MAX_TTL_DAYS))
    expires = _iso(ttl)
    db.insert("api_tokens", {
        "token_hash": _sha256(raw), "subject_type": "parent", "subject_id": parent["id"],
        "device_name": device, "platform": platform or "online", "expires_at": expires,
    })
    db.run("UPDATE parents SET last_login = %s WHERE id = %s", (_now_text(), parent["id"]))
    return {"ok": True, "token": raw, "expires_at": expires, "parent": parent}


def parent_for(db, raw_token):
    """Resolve a bearer token to a parent, or None.

    Re-read on every request, exactly as a staff session is: an account the
    school deactivates stops working on its next call rather than when its
    token happens to expire.
    """
    if not raw_token:
        return None
    row = db.one(
        "SELECT id, subject_type, subject_id, revoked, expires_at FROM api_tokens WHERE token_hash = %s",
        (_sha256(raw_token),))
    if not row or row["revoked"] or row["subject_type"] != "parent":
        return None
    if row["expires_at"] and str(row["expires_at"]) < _iso(0):
        return None
    parent = db.one("""SELECT id, full_name, phone, email, is_active, must_change_password
                         FROM parents WHERE id = %s""", (row["subject_id"],))
    if not parent or not parent["is_active"]:
        return None
    try:
        db.run("UPDATE api_tokens SET last_used_at = %s WHERE id = %s", (_now_text(), row["id"]))
    except Exception:
        pass
    return {"parent_id": parent["id"], "token_id": row["id"], "full_name": parent["full_name"],
            "phone": parent["phone"], "email": parent["email"],
            "must_change_password": bool(parent["must_change_password"]), "role": "parent"}


def revoke_all_for_parent(db, parent_id):
    db.run("UPDATE api_tokens SET revoked = 1 WHERE subject_type = 'parent' AND subject_id = %s",
           (parent_id,))
    return {"ok": True}


def change_parent_password(db, parent_actor, current_password, new_password):
    from . import parents as parents_lib
    new_password = str(new_password or "")
    if len(new_password) < 8:
        return {"ok": False, "status": 400, "error": "A password must be at least 8 characters."}
    row = db.one("SELECT password_hash FROM parents WHERE id = %s", (parent_actor["parent_id"],))
    if not row or not parents_lib.verify_password(current_password, row["password_hash"]):
        return {"ok": False, "status": 400, "error": "That is not your current password."}
    db.run("UPDATE parents SET password_hash = %s, must_change_password = 0 WHERE id = %s",
           (parents_lib.hash_password(new_password), parent_actor["parent_id"]))
    # Every device this parent was signed in on is now signed out, including
    # the one that just changed the password. That is the point: "change your
    # password" has to mean something after a phone goes missing.
    revoke_all_for_parent(db, parent_actor["parent_id"])
    security.audit(db, None, "security", parent_actor["parent_id"], "parent_password_changed",
                   "Changed online; other sessions signed out")
    return {"ok": True, "signed_out_everywhere": True}


def change_own_password(db, actor, current_password, new_password):
    """A person changing their own password.

    No permission gate: an account is not a module, and everybody owns theirs.
    The current password is required even when the account is flagged
    must_change_password, because "somebody left this phone unlocked" is the
    case that flag exists for.
    """
    new_password = str(new_password or "")
    if len(new_password) < 8:
        return {"ok": False, "status": 400, "error": "A password must be at least 8 characters."}
    row = db.one("SELECT password_hash FROM users WHERE id = %s", (actor["user_id"],))
    if not row or not verify_password(current_password, row["password_hash"]):
        security.audit(db, actor, "security", actor["user_id"], "password_change_failed",
                       "Wrong current password", "high")
        return {"ok": False, "status": 400, "error": "That is not your current password."}
    if verify_password(new_password, row["password_hash"]):
        return {"ok": False, "status": 400, "error": "Choose a password you have not used here."}

    db.run("UPDATE users SET password_hash = %s, must_change_password = 0 WHERE id = %s",
           (hash_password(new_password), actor["user_id"]))
    # Every other session this account holds is now stale. Revoking them all
    # and re-issuing one is what makes "change your password" mean something
    # after a phone is lost.
    revoke_all_for_user(db, actor["user_id"])
    token = issue_token(db, actor["user_id"], platform="online")
    security.audit(db, actor, "security", actor["user_id"], "password_changed",
                   "Changed online; other sessions signed out")
    return {"ok": True, "token": token["token"], "expires_at": token["expires_at"]}
