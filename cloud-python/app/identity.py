"""One account, three interfaces.

§17 and §18: a school registers on the public website, creates an administrator
account there, and is then signed in to the cloud application. It must not have
to make a second account, and the two must not be two accounts that happen to
share a password.

The way that is achieved here is deliberately small, because the alternative
was not:

  * **The password does not move.** It stays exactly where it has always been —
    in the school's own `users` table, inside the school's own Postgres schema,
    bcrypt-hashed by the same `app/school/session.py` the desktop uses. Nothing
    about how a school authenticates its staff changes, which means a school
    that has been running for two years is not re-enrolled and the offline
    system and the online one still agree about who somebody is.
  * **One table is added, holding a signpost.** Given an email typed into a box
    at `www.edusoft…`, which school's schema should that password be checked
    against? Scanning every tenant would be slow and would let anybody
    enumerate the platform's schools. `platform_identities` answers that one
    question — email → school — and holds no password, no permission and no
    session.

Registration is therefore one act with several parts, and it is written as one
function so that a half-registered school is a state that gets cleaned up
rather than a state somebody discovers later:

    tenant schema → administrator account → registry row → identity →
    subscription → (payment method) → signed-in token
"""
import datetime
import re

from . import platform_api
from .billing import audit as billing_audit
from .billing import entitlements, plans as plan_lib, settings as platform_settings
from .billing import subscriptions as subs
from .billing.repo import now_iso, repo_for
from .school import db as sdb, session as school_session

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$")
USERNAME_RE = re.compile(r"^[a-z0-9._-]{3,32}$")
MIN_PASSWORD = 8


def norm_email(value):
    return str(value or "").strip().lower()


def valid_email(value):
    return bool(EMAIL_RE.match(norm_email(value)))


# ── The directory ───────────────────────────────────────────────────────────
def schools_for_email(repo, email):
    """Which schools this email is an account at. Usually one; sometimes two,
    for a proprietor who owns two schools."""
    return repo.find("platform_identities", {"email": norm_email(email)}, order_by="id")


def remember_identity(repo, email, school_id, username, role="school_admin"):
    email = norm_email(email)
    existing = repo.find_one("platform_identities", {"email": email, "school_id": school_id})
    if existing:
        return repo.update("platform_identities", existing["id"],
                           {"username": username, "role": role})
    return repo.insert("platform_identities", {
        "email": email, "school_id": school_id, "username": username,
        "role": role, "created_at": now_iso()})


def forget_identity(repo, email, school_id):
    return repo.delete_where("platform_identities",
                             {"email": norm_email(email), "school_id": school_id})


# ── Signing in from the front door ──────────────────────────────────────────
def sign_in(store, email=None, password="", school_id=None, source=None):
    """Sign in with an email address, without being told which school.

    Where the email belongs to exactly one school, it signs in there. Where it
    belongs to several, and no school was named, the caller is asked which —
    with the schools listed, because a proprietor with two schools knows their
    names and does not know their tenant ids.

    The password is checked by the school's own code. This function never sees
    a hash and never compares one.
    """
    repo = repo_for(store)
    email = norm_email(email)
    if not email or not password:
        return {"ok": False, "status": 400, "error": "Enter your email address and password."}

    candidates = schools_for_email(repo, email)
    if school_id:
        candidates = [c for c in candidates if str(c["school_id"]) == str(school_id)]
    if not candidates:
        # The same answer as a wrong password, deliberately. Saying "no account
        # with that email" turns this box into a way to find out which schools
        # and which people are on the platform.
        return {"ok": False, "status": 401,
                "error": "Those details did not match an account. Check and try again."}

    if len(candidates) > 1 and not school_id:
        return {"ok": False, "status": 300, "choose": True,
                "error": "This email is an account at more than one school. Choose one.",
                "schools": [{"school_id": c["school_id"],
                             "name": _school_name(store, c["school_id"])} for c in candidates]}

    identity = candidates[0]
    try:
        db = sdb.SchoolDb(identity["school_id"])
        result = school_session.sign_in(db, identity["username"], password,
                                        platform="web", source=source)
    except Exception:
        return {"ok": False, "status": 503,
                "error": "That school could not be reached just now. Try again shortly."}
    if not result.get("ok"):
        return result

    entitlement = entitlements.for_school(store, identity["school_id"])
    return {
        "ok": True,
        "school_id": identity["school_id"],
        "school": {"id": identity["school_id"],
                   "name": db.get_setting("school_name", identity["school_id"])},
        # The same `<school_id>.<token>` credential the cloud application
        # already uses, so the browser can carry it straight there. One
        # sign-in, one token, no second account (§17).
        "token": f'{identity["school_id"]}.{result["token"]}',
        "expires_at": result["expires_at"],
        "user": result["user"],
        "designation": result["designation"],
        "must_change_password": result["must_change_password"],
        "entitlement": entitlements.summary(entitlement),
        "app_url": app_url_for(identity["school_id"]),
    }


def _school_name(store, school_id):
    try:
        record = store.get_school(school_id)
        if record and record.get("name"):
            return record["name"]
    except Exception:
        pass
    return school_id


def app_url_for(school_id):
    """Where this school's cloud application lives.

    A school's tenant id IS its subdomain (see platform_api.allocate_school_id),
    so this is string work and not a lookup — a school enrolled a second ago is
    reachable immediately. None on a deployment with no domain configured,
    which is a real state and not an error: the app is then on the same origin
    the visitor is already looking at.
    """
    host = platform_api.portal_host(school_id)
    return f"https://{host}" if host else None


# ── Registering a school ────────────────────────────────────────────────────
def register(store, data, actor="public", remote_addr=None):
    """The whole of §17, as one call.

    Everything that can fail before anything is written is checked first —
    which matters, because the expensive irreversible part is creating a
    Postgres schema with eighty-one tables in it, and doing that for a
    registration that was going to be rejected for a short password is a way to
    fill a database with rubbish.
    """
    repo = repo_for(store)

    school_name = str(data.get("school_name") or "").strip()
    full_name = str(data.get("full_name") or "").strip()
    email = norm_email(data.get("email"))
    password = str(data.get("password") or "")
    username = str(data.get("username") or "").strip().lower() or _username_from(email)
    plan_id = str(data.get("plan_id") or "").strip() or platform_settings.get(repo, "default_plan", "pro")

    if len(school_name) < 3:
        return {"ok": False, "status": 400, "error": "Enter the school's name."}
    if not full_name:
        return {"ok": False, "status": 400, "error": "Enter your name."}
    if not valid_email(email):
        return {"ok": False, "status": 400, "error": "Enter a valid email address."}
    if len(password) < MIN_PASSWORD:
        return {"ok": False, "status": 400,
                "error": f"Choose a password of at least {MIN_PASSWORD} characters."}
    if not USERNAME_RE.match(username):
        return {"ok": False, "status": 400,
                "error": "A username is 3–32 letters, numbers, dot, dash or underscore."}

    plan = repo.get("subscription_plans", plan_id)
    if not plan or not plan.get("is_active"):
        return {"ok": False, "status": 400, "error": "Choose a plan."}

    # One school per registration, and one registration per school per email.
    # Somebody double-clicking Register must not end up with two schools.
    if repo.find_one("platform_identities", {"email": email}) and not data.get("allow_second_school"):
        return {"ok": False, "status": 409,
                "error": "There is already an Edusoft account with that email address. "
                         "Sign in instead, or use another address."}

    provisioned = platform_api.provision_school(store, school_name, seed=True)
    if not provisioned.get("ok"):
        return provisioned
    school_id = provisioned["school_id"]

    try:
        db = sdb.SchoolDb(school_id)
        _create_administrator(db, username, password, full_name, email)
        _record_contact(db, school_name, email, data)
    except Exception as exc:
        # The tenant exists and has no administrator — which is a school nobody
        # can sign in to. Retiring it is the right cleanup: nothing of the
        # school's is in it yet, the registration failed, and leaving it behind
        # would burn the name the school asked for.
        _rollback(store, school_id, f"the administrator account failed: {exc}")
        return {"ok": False, "status": 503,
                "error": "The school was created but its administrator account could "
                         "not be. Nothing has been kept; please try again."}

    remember_identity(repo, email, school_id, username, role="school_admin")
    try:
        store_contact = {"contact_email": email,
                         "contact_phone": str(data.get("phone") or "")[:40],
                         "region": str(data.get("region") or "")[:80]}
        _update_school_row(store, school_id, store_contact)
    except Exception:
        pass                                    # contact details are not worth failing on

    started = subs.start(store, repo, school_id, plan_id, actor=f"registration:{email}",
                         notes=f"Registered at {now_iso()} by {full_name}.")
    if not started.get("ok"):
        # The school exists and can be used; it simply has no subscription yet,
        # and the grandfathering rule means it still works. Reported rather
        # than rolled back — deleting a school because the subscription row
        # failed would be losing the customer to save the paperwork.
        billing_audit.write(store, "registration_without_subscription", school_id=school_id,
                            actor=actor, outcome="failed",
                            detail=f'{school_id} registered but the subscription failed: '
                                   f'{started.get("error")}')

    signed_in = school_session.sign_in(db, username, password, platform="web",
                                       source=remote_addr)
    entitlement = entitlements.for_school(store, school_id, fresh=True)
    subscription = started.get("subscription") or subs.current(repo, school_id)

    billing_audit.write(store, "school_registered", school_id=school_id, actor=actor,
                        remote_addr=remote_addr,
                        detail=f'"{school_name}" registered on {plan["name"]} by {email}.')

    return {
        "ok": True,
        "school_id": school_id,
        "school": {"id": school_id, "name": school_name},
        "portal_host": provisioned.get("portal_host"),
        "app_url": app_url_for(school_id),
        # Shown once, and only here. It is the school's sync key for a desktop
        # they may install later; it is stored as a hash and is reissued rather
        # than recovered.
        "sync_key": provisioned.get("api_key"),
        "administrator": {"username": username, "full_name": full_name, "email": email},
        "token": f'{school_id}.{signed_in["token"]}' if signed_in.get("ok") else None,
        "expires_at": signed_in.get("expires_at"),
        "subscription": subscription,
        "plan": plan_lib.get_plan(repo, (subscription or {}).get("plan_id") or plan_id),
        "trial": bool(started.get("trial")),
        "trial_ends_at": (subscription or {}).get("trial_ends_at"),
        "entitlement": entitlements.summary(entitlement),
    }


def _username_from(email):
    """A username from an email address, when the person did not choose one.

    Most school administrators do not want to invent a second name at a
    registration form. The local part is usable far more often than not, and
    anything it cannot make is caught by the validation above rather than
    silently mangled.
    """
    local = norm_email(email).split("@")[0]
    cleaned = re.sub(r"[^a-z0-9._-]", "", local)[:32]
    return cleaned if len(cleaned) >= 3 else f"admin{cleaned}"


def _create_administrator(db, username, password, full_name, email):
    """The school's first account: a Super Admin, inside the school's own schema.

    `must_change_password` is 0, and that is the difference between this and
    `admin.create_user`: there, somebody else chose the password and the owner
    has to replace it. Here the person typed their own at the registration form
    thirty seconds ago, and asking them to change it immediately is the kind of
    thing that makes a product feel like it was not written for a person.
    """
    row = db.one("SELECT id FROM designations WHERE name = 'Super Admin'")
    designation_id = row["id"] if row else None
    user_id = db.insert("users", {
        "username": username,
        "password_hash": school_session.hash_password(password),
        "full_name": full_name,
        "designation_id": designation_id,
        "is_active": 1,
        "must_change_password": 0,
    })
    # The administrator's own email is deliberately NOT written into the
    # school's `users` table. That table is the offline system's, column for
    # column, and adding to it would make the desktop schema and the online one
    # two different things — which is the one thing this product has been
    # careful not to do. The email lives in `platform_identities`, which is
    # where the front door needs it anyway.
    return user_id


def _record_contact(db, school_name, email, data):
    """What the school told us at registration, in the school's own settings —
    so the first screen it opens already says its own name."""
    db.set_setting("school_name", school_name, "school")
    if email:
        db.set_setting("school_email", email, "school")
    for key, setting in (("phone", "school_phone_1"), ("address", "school_address"),
                         ("region", "school_location"), ("school_type", "school_type")):
        value = str(data.get(key) or "").strip()
        if value:
            db.set_setting(setting, value, "school")


def _update_school_row(store, school_id, patch):
    """Contact details on the platform's registry row. Best effort: the columns
    were added with the billing schema and an older database may not have run
    it yet."""
    if getattr(store, "kind", "") != "pg":
        return False
    sets = ", ".join(f'"{k}" = %s' for k in patch)
    store._q(f"UPDATE schools SET {sets} WHERE school_id = %s",
             (*patch.values(), school_id))
    return True


def _rollback(store, school_id, why):
    """Undo a registration that failed part way through.

    Only ever called before the school has any data of its own — between
    creating the schema and creating the account that can sign in to it. It is
    written down either way, because a schema that failed to drop is a name
    nobody can register again and somebody has to know.
    """
    billing_audit.write(store, "registration_rolled_back", school_id=school_id,
                        actor="public", outcome="failed",
                        detail=f"{school_id} was removed: {why}")
    try:
        sdb.drop(school_id)
    except Exception:
        pass
    try:
        if getattr(store, "kind", "") == "pg":
            store._q("DELETE FROM schools WHERE school_id = %s", (school_id,))
        else:
            store._schools.pop(school_id, None)
    except Exception:
        pass


def directory_entry(store, school_id):
    """Who administers a school, for the console's school page."""
    repo = repo_for(store)
    return repo.find("platform_identities", {"school_id": school_id}, order_by="id")


def trial_summary(repo, subscription):
    """"Your trial ends on the 14th — 6 days." Said once, here, so the website,
    the app banner and the billing page cannot word it three ways."""
    if not subscription or subscription.get("status") != subs.TRIALING:
        return None
    ends = subscription.get("trial_ends_at")
    if not ends:
        return None
    when = datetime.datetime.fromisoformat(str(ends).replace("Z", "+00:00"))
    left = max(0, (when - datetime.datetime.now(datetime.timezone.utc)).days)
    return {"ends_at": ends, "days_left": left,
            "text": "Your trial ends today." if left == 0
                    else f"Your trial ends in {left} day{'' if left == 1 else 's'}."}
