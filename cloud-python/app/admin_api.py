"""The Superadmin console's API — Nickland's own view of the platform.

The brief's §13, and the note at the end of it: *the superadmin has the overall
access to the platform*. Everything here reaches every school, which is exactly
why the way in is narrow and every act is written down.

── Two ways in, on purpose ─────────────────────────────────────────────────
**A person signs in.** `platform_users` holds operator accounts with their own
passwords, and the console signs in with one. That is what makes the audit
trail say *who* granted an exemption rather than "platform".

**A machine presents the key.** `PLATFORM_ADMIN_KEY` still works as a header,
unchanged, because scripts and the existing `/api/v1/platform/*` routes depend
on it — and because it is how the FIRST operator account is created on a fresh
deployment. A platform with no operator account and no key configured has no
console at all; it does not fall back to something weaker.

── What the console can and cannot do ──────────────────────────────────────
It can do everything the brief asks: schools, plans, features, subscriptions,
discounts, exemptions, payments, invoices, usage, reporting and settings.

It cannot read a school's pupils, marks, fees or parents. Not because of an
oversight — because the operator of a platform has no business in a child's
record, and "the superadmin has overall access" means overall access to the
PLATFORM. Suspending a school, seeing that it has 412 pupils and billing it are
all here; opening one of those 412 is not, and there is no route that does.
"""
import hashlib
import hmac
import os

from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse

from . import identity, platform_api, portal_auth, ratelimit
from .billing import adjustments, engine, entitlements, invoices as invoice_lib
from .billing import audit as billing_audit
from .billing import plans as plan_lib
from .billing import provider as billing_provider
from .billing import settings as platform_settings
from .billing import subscriptions as subs
from .billing import usage as usage_lib
from .billing.repo import money, now_iso, repo_for

router = APIRouter(prefix="/api/v1/admin")

MIN_PASSWORD = 10          # longer than a school's: this account reaches everything
SESSION_HOURS = 12


def _err(code, message, **extra):
    return JSONResponse(status_code=code, content={"ok": False, "error": message, **extra})


def _send(result):
    if isinstance(result, dict) and not result.get("ok"):
        return JSONResponse(
            status_code=result.get("status", 400),
            content={"ok": False, "error": result.get("error", "That did not work."),
                     **{k: v for k, v in result.items() if k not in ("ok", "status", "error")}})
    return result


async def _json(request: Request):
    try:
        return await request.json()
    except Exception:
        return {}


class Denied(Exception):
    def __init__(self, response):
        self.response = response


# ── Who is at the console ───────────────────────────────────────────────────
def _guard(request, authorization=None, platform_key=None):
    """The operator making this request, or a refusal.

    Returns a dict with a `label` that goes into every audit line. The key-based
    caller is labelled `platform:key`, which is deliberately distinguishable
    from a named person: an operator reading the log six months later needs to
    know whether a decision was made by somebody or by a script.
    """
    store = request.app.state.store
    repo = repo_for(store)

    token = authorization[7:] if authorization and authorization.startswith("Bearer ") else None
    claims = portal_auth.verify_token(token) if token else None
    if claims and claims.get("platform_user_id"):
        user = repo.get("platform_users", claims["platform_user_id"])
        if user and user.get("is_active"):
            return {"id": user["id"], "email": user["email"], "name": user["full_name"],
                    "role": user["role"], "label": f'operator:{user["email"]}',
                    "store": store, "repo": repo}
        raise Denied(_err(401, "That console session is no longer valid."))

    if platform_key and platform_api.check_key(platform_key):
        return {"id": None, "email": None, "name": "Platform key", "role": "superadmin",
                "label": "platform:key", "store": store, "repo": repo}

    if not platform_api.platform_enabled() and not repo.find("platform_users"):
        # No key configured and no operator account: there is no console on
        # this deployment. 404 rather than 401, because admitting the surface
        # exists is itself information.
        raise Denied(_err(404, "This service has no platform administration configured."))
    raise Denied(_err(401, "Please sign in."))


def _hash_password(password):
    """scrypt, salted, with the same parameters the parent portal uses.

    Reusing `portal_auth`'s format rather than inventing a second one means one
    piece of password code to get right, and it is already the one that has
    been reviewed.
    """
    return portal_auth.hash_password(password)


def _verify_password(password, stored):
    return portal_auth.verify_password(password, stored)


# ── Sign in ─────────────────────────────────────────────────────────────────
@router.post("/login")
async def admin_login(request: Request):
    body = await _json(request)
    email = identity.norm_email(body.get("email"))
    password = str(body.get("password") or "")
    if ratelimit.limited(request, "admin-login", email):
        return _err(429, "Too many attempts. Try again shortly.")
    repo = repo_for(request.app.state.store)
    user = repo.find_one("platform_users", {"email": email}) if email else None
    if not user or not user.get("is_active") or not _verify_password(password, user["password_hash"]):
        billing_audit.write(request.app.state.store, "console_login_refused",
                            actor=email or "anonymous", outcome="refused",
                            detail="A console sign-in was refused.")
        return _err(401, "Those details did not match an account.")
    repo.update("platform_users", user["id"], {"last_login_at": now_iso()})
    billing_audit.write(request.app.state.store, "console_login",
                        actor=f'operator:{user["email"]}',
                        detail=f'{user["email"]} signed in to the console.')
    return {
        "ok": True,
        "token": portal_auth.sign_token({"platform_user_id": user["id"], "role": user["role"]},
                                        ttl_seconds=SESSION_HOURS * 3600),
        "user": {"id": user["id"], "email": user["email"],
                 "full_name": user["full_name"], "role": user["role"]},
    }


@router.get("/me")
def admin_me(request: Request, authorization: str = Header(None),
             x_platform_key: str = Header(None)):
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    return {"ok": True, "operator": {"id": operator["id"], "email": operator["email"],
                                     "name": operator["name"], "role": operator["role"]}}


@router.get("/operators")
def admin_operators(request: Request, authorization: str = Header(None),
                    x_platform_key: str = Header(None)):
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    return {"ok": True, "operators": [
        {k: row[k] for k in ("id", "email", "full_name", "role", "is_active",
                             "created_at", "last_login_at")}
        for row in operator["repo"].find("platform_users", order_by="id")]}


@router.post("/operators")
async def admin_create_operator(request: Request, authorization: str = Header(None),
                                x_platform_key: str = Header(None)):
    """Create an operator account.

    The FIRST one may be created with the platform key alone, which is how a
    fresh deployment gets a console at all. Every one after that needs an
    operator already signed in — a bootstrap that stayed open would make the
    environment variable a permanent back door onto the whole platform.
    """
    repo = repo_for(request.app.state.store)
    first = not repo.find("platform_users")
    if not (first and x_platform_key and platform_api.check_key(x_platform_key)):
        try:
            _guard(request, authorization, x_platform_key)
        except Denied as denied:
            return denied.response

    body = await _json(request)
    email = identity.norm_email(body.get("email"))
    password = str(body.get("password") or "")
    if not identity.valid_email(email):
        return _err(400, "Enter a valid email address.")
    if len(password) < MIN_PASSWORD:
        return _err(400, f"A console password is at least {MIN_PASSWORD} characters.")
    if repo.find_one("platform_users", {"email": email}):
        return _err(409, "There is already an operator with that email address.")
    role = str(body.get("role") or "superadmin")
    if role not in ("superadmin", "support"):
        return _err(400, "A console account is either a superadmin or support.")

    user = repo.insert("platform_users", {
        "email": email, "full_name": str(body.get("full_name") or "").strip()[:120],
        "password_hash": _hash_password(password), "role": role,
        "is_active": True, "created_at": now_iso()})
    billing_audit.write(request.app.state.store, "console_operator_created",
                        actor="platform:key" if first else "operator",
                        detail=f'{email} was given a {role} console account.')
    return {"ok": True, "operator": {"id": user["id"], "email": user["email"],
                                     "role": user["role"]}, "first": first}


@router.post("/operators/{operator_id}/status")
async def admin_operator_status(operator_id: int, request: Request,
                                authorization: str = Header(None),
                                x_platform_key: str = Header(None)):
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    body = await _json(request)
    repo = operator["repo"]
    target = repo.get("platform_users", operator_id)
    if not target:
        return _err(404, "No such operator.")
    active = body.get("is_active") is not False
    if not active and operator["id"] == target["id"]:
        return _err(400, "You cannot deactivate the account you are signed in with.")
    if not active and len([u for u in repo.find("platform_users")
                           if u["is_active"] and u["id"] != target["id"]]) == 0:
        return _err(400, "That is the last active console account.")
    repo.update("platform_users", operator_id, {"is_active": active})
    billing_audit.write(operator["store"], "console_operator_changed", actor=operator["label"],
                        detail=f'{target["email"]} was '
                               f'{"reactivated" if active else "deactivated"}.')
    return {"ok": True}


# ── The dashboard ───────────────────────────────────────────────────────────
@router.get("/dashboard")
def admin_dashboard(request: Request, authorization: str = Header(None),
                    x_platform_key: str = Header(None)):
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    store, repo = operator["store"], operator["repo"]

    schools = platform_api.list_schools(store)
    by_status = {}
    trialing = active = suspended = 0
    pupils = 0
    for school in schools:
        subscription = subs.current(repo, school["school_id"])
        status = (subscription or {}).get("status") or "NONE"
        by_status[status] = by_status.get(status, 0) + 1
        trialing += status == subs.TRIALING
        active += status == subs.ACTIVE
        suspended += status == subs.SUSPENDED
        newest = repo.find_one("usage_snapshots", {"school_id": school["school_id"]},
                               order_by="captured_at", desc=True)
        pupils += int((newest or {}).get("billable_students") or 0)

    return {
        "ok": True,
        "schools": {"total": len(schools),
                    "complete": sum(1 for s in schools if s["complete"]),
                    "incomplete": sum(1 for s in schools if not s["complete"]),
                    "trialing": trialing, "active": active, "suspended": suspended,
                    "by_status": by_status},
        "pupils": pupils,
        "revenue": invoice_lib.revenue_report(repo),
        "plans": [{"plan_id": p["plan_id"], "name": p["name"],
                   "schools": repo.count("subscriptions",
                                         {"plan_id": p["plan_id"],
                                          "status": ("in", list(subs.LIVE))})}
                  for p in plan_lib.list_plans(repo, include_hidden=True, include_inactive=True)],
        "trials_ending": subs.trial_ending_soon(repo, within_days=7),
        "overdue": [i for i in invoice_lib.list_invoices(repo, status=invoice_lib.PAST_DUE,
                                                         limit=25)],
        "payments_available": billing_provider.configured(repo),
        "recent": billing_audit.read(store, limit=25),
    }


# ── Schools ─────────────────────────────────────────────────────────────────
@router.get("/schools")
def admin_schools(request: Request, authorization: str = Header(None),
                  x_platform_key: str = Header(None)):
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    store, repo = operator["store"], operator["repo"]
    out = []
    for school in platform_api.list_schools(store):
        subscription = subs.current(repo, school["school_id"])
        newest = repo.find_one("usage_snapshots", {"school_id": school["school_id"]},
                               order_by="captured_at", desc=True)
        discount = engine.active_discount(repo, school["school_id"])
        exemption = engine.active_exemption(repo, school["school_id"])
        out.append({
            **school,
            "status": (subscription or {}).get("status") or "NONE",
            "status_label": subs.STATUS_LABELS.get((subscription or {}).get("status"),
                                                   "No subscription"),
            "plan_id": (subscription or {}).get("plan_id"),
            "trial_ends_at": (subscription or {}).get("trial_ends_at"),
            "next_billing_date": (subscription or {}).get("current_period_end"),
            "students": int((newest or {}).get("billable_students") or 0),
            "has_discount": bool(discount),
            "is_exempt": bool(exemption),
            "outstanding": money(sum(
                float(i["total_amount"] or 0)
                for i in invoice_lib.list_invoices(repo, school_id=school["school_id"])
                if i["status"] in invoice_lib.OUTSTANDING)),
        })
    return {"ok": True, "schools": out}


@router.post("/schools")
async def admin_create_school(request: Request, authorization: str = Header(None),
                              x_platform_key: str = Header(None)):
    """Enrol a school from the console — the operator-driven twin of the public
    registration form, for a school that signed up over the phone."""
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    body = await _json(request)
    store, repo = operator["store"], operator["repo"]
    if body.get("email"):
        # With an administrator's details, it is a full registration: tenant,
        # account, identity and subscription, exactly as the website does it.
        return _send(identity.register(store, body, actor=operator["label"]))

    name = str(body.get("name") or body.get("school_name") or "").strip()
    if not name:
        return _err(400, "A school name is required.")
    result = platform_api.provision_school(store, name,
                                           school_id=body.get("school_id") or None,
                                           seed=body.get("seed") is not False)
    if result.get("ok") and body.get("plan_id"):
        subs.start(store, repo, result["school_id"], body["plan_id"], actor=operator["label"])
    return _send(result)


@router.get("/schools/{school_id}")
def admin_school(school_id: str, request: Request, authorization: str = Header(None),
                 x_platform_key: str = Header(None)):
    """One school, everything the platform knows about it — and nothing the
    school knows about its pupils."""
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    store, repo = operator["store"], operator["repo"]
    record = next((s for s in platform_api.list_schools(store)
                   if s["school_id"] == school_id), None)
    if not record:
        return _err(404, "No such school.")

    subscription = subs.current(repo, school_id) or subs.latest(repo, school_id)
    counted = usage_lib.count_students(store, repo, school_id)
    plan = plan_lib.get_plan(repo, (subscription or {}).get("plan_id"))
    quoted = engine.quote(repo, school_id, plan, counted["billable_students"],
                          subscription=subscription) if plan else None
    return {
        "ok": True,
        "school": record,
        "subscription": subscription,
        "status_label": subs.STATUS_LABELS.get((subscription or {}).get("status"),
                                               "No subscription"),
        "plan": plan,
        "quote": quoted,
        "lines": engine.quote_lines(quoted) if quoted else [],
        "usage": counted,
        "usage_history": usage_lib.history(repo, school_id, limit=30),
        "discounts": adjustments.list_discounts(repo, school_id),
        "exemptions": adjustments.list_exemptions(repo, school_id),
        "invoices": invoice_lib.list_invoices(repo, school_id=school_id, limit=100),
        "payments": repo.find("platform_payments", {"school_id": school_id},
                              order_by="id", desc=True, limit=50),
        "payment_methods": billing_provider.methods_for(repo, school_id),
        # How the SCHOOL takes fees from ITS parents — which is not Nickland's
        # business to change, and very much Nickland's business to see when a
        # school rings to say parents cannot pay.
        "school_gateway": _school_gateway(school_id),
        "administrators": identity.directory_entry(store, school_id),
        "events": subs.events(repo, school_id, limit=60),
        "history": subs.history(repo, school_id),
        "audit": billing_audit.read(store, limit=60, school_id=school_id),
        "entitlement": entitlements.summary(entitlements.for_school(store, school_id, fresh=True)),
        "portal_hosts": platform_api.portal_hosts(school_id),
    }


def _school_gateway(school_id):
    """A school's own payment setup, as the console may see it.

    Read-only and redacted. An operator helping a bursar over the telephone
    needs to know whether a gateway is configured, which one, and whether its
    last test passed — and has no business being able to read the key or change
    it. Support is not the same permission as control.
    """
    try:
        from .school import db as sdb, integrations as school_integrations
        db = sdb.SchoolDb(school_id)
        if not db.exists():
            return None
        view = school_integrations.overview(db)
        return {"payments": view["payments"], "sms": view["sms"]}
    except Exception:
        return None


@router.post("/schools/{school_id}/lifecycle")
async def admin_school_lifecycle(school_id: str, request: Request,
                                 authorization: str = Header(None),
                                 x_platform_key: str = Header(None)):
    """Suspend, reactivate or archive a school (§13).

    Archiving does not delete anything and there is no route that does. A
    school that has left keeps its database until an operator removes it
    deliberately, with psql, having decided to — which is a decision that
    should cost somebody a deliberate act rather than a click.
    """
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    body = await _json(request)
    store, repo = operator["store"], operator["repo"]
    action = str(body.get("action") or "").lower()
    reason = str(body.get("reason") or "")[:300]

    if action == "suspend":
        result = subs.suspend(store, repo, school_id, actor=operator["label"], reason=reason)
    elif action in ("reactivate", "activate"):
        result = subs.reactivate(store, repo, school_id, actor=operator["label"],
                                 plan_id=body.get("plan_id"))
    elif action == "archive":
        result = subs.set_status(store, repo, school_id, subs.TERMINATED,
                                 actor=operator["label"],
                                 reason=reason or "The school was archived.")
    else:
        return _err(400, "An action is suspend, reactivate or archive.")

    _set_lifecycle(store, school_id, action, reason)
    entitlements.invalidate(school_id)
    return _send(result)


def _set_lifecycle(store, school_id, action, note=""):
    """The registry's own note about a school. Best effort — an older database
    may not have the column yet, and a suspension must not fail over a label."""
    lifecycle = {"suspend": "suspended", "reactivate": "active",
                 "activate": "active", "archive": "archived"}.get(action)
    if not lifecycle or getattr(store, "kind", "") != "pg":
        return False
    try:
        store._q("UPDATE schools SET lifecycle = %s, lifecycle_note = %s WHERE school_id = %s",
                 (lifecycle, note, school_id))
    except Exception:
        return False
    return True


@router.post("/schools/{school_id}/rotate-key")
def admin_rotate_key(school_id: str, request: Request, authorization: str = Header(None),
                     x_platform_key: str = Header(None)):
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    return _send(platform_api.rotate_key(operator["store"], school_id))


# ── Subscriptions ───────────────────────────────────────────────────────────
@router.get("/subscriptions")
def admin_subscriptions(request: Request, status: str = "", authorization: str = Header(None),
                        x_platform_key: str = Header(None)):
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    repo = operator["repo"]
    where = {"status": status} if status else {}
    rows = repo.find("subscriptions", where, order_by="id", desc=True, limit=500)
    names = {s["school_id"]: s["name"] for s in platform_api.list_schools(operator["store"])}
    return {"ok": True, "subscriptions": [
        {**row, "school_name": names.get(row["school_id"], row["school_id"]),
         "status_label": subs.STATUS_LABELS.get(row["status"], row["status"])}
        for row in rows]}


@router.post("/schools/{school_id}/subscription")
async def admin_set_subscription(school_id: str, request: Request,
                                 authorization: str = Header(None),
                                 x_platform_key: str = Header(None)):
    """Every subscription act an operator can take, in one route.

    `action` is one of: subscribe, plan, status, cancel, reactivate, price.
    One route rather than six because they are one screen and one permission,
    and because every one of them writes the same audit line — which is easier
    to guarantee when there is one place that writes it.
    """
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    body = await _json(request)
    store, repo, who = operator["store"], operator["repo"], operator["label"]
    action = str(body.get("action") or "").lower()
    reason = str(body.get("reason") or "")[:300]

    if action == "subscribe":
        result = subs.start(store, repo, school_id, str(body.get("plan_id") or ""),
                            actor=who, with_trial=body.get("trial"),
                            notes=reason)
    elif action == "plan":
        result = subs.change_plan(store, repo, school_id, str(body.get("plan_id") or ""),
                                  actor=who, note=reason)
    elif action == "status":
        result = subs.set_status(store, repo, school_id, str(body.get("status") or "").upper(),
                                 actor=who, reason=reason)
    elif action == "cancel":
        result = subs.cancel(store, repo, school_id, actor=who,
                             at_period_end=body.get("immediately") is not True, reason=reason)
    elif action == "reactivate":
        result = subs.reactivate(store, repo, school_id, actor=who,
                                 plan_id=body.get("plan_id"))
    elif action == "price":
        result = subs.set_price_override(store, repo, school_id,
                                         base=body.get("base_price"),
                                         per_student=body.get("price_per_student"),
                                         actor=who, note=reason)
    else:
        return _err(400, "An action is subscribe, plan, status, cancel, reactivate or price.")
    entitlements.invalidate(school_id)
    return _send(result)


# ── Plans and features ──────────────────────────────────────────────────────
@router.get("/plans")
def admin_plans(request: Request, authorization: str = Header(None),
                x_platform_key: str = Header(None)):
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    repo = operator["repo"]
    return {"ok": True,
            "plans": plan_lib.list_plans(repo, include_hidden=True, include_inactive=True),
            "grid": plan_lib.feature_grid(repo),
            "intervals": [{"key": k, **v} for k, v in plan_lib.INTERVALS.items()]}


@router.post("/plans")
async def admin_create_plan(request: Request, authorization: str = Header(None),
                            x_platform_key: str = Header(None)):
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    body = await _json(request)
    result = plan_lib.create_plan(operator["repo"], body, actor=operator["label"])
    if result.get("ok"):
        billing_audit.write(operator["store"], "plan_created", actor=operator["label"],
                            detail=f'Plan "{result["plan"]["plan_id"]}" was created.')
        entitlements.invalidate()
    return _send(result)


@router.patch("/plans/{plan_id}")
@router.post("/plans/{plan_id}")
async def admin_update_plan(plan_id: str, request: Request, authorization: str = Header(None),
                            x_platform_key: str = Header(None)):
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    body = await _json(request)
    before = operator["repo"].get("subscription_plans", plan_id) or {}
    result = plan_lib.update_plan(operator["repo"], plan_id, body)
    if result.get("ok"):
        changed = [f'{k}: {before.get(k)} → {v}' for k, v in body.items()
                   if k in before and str(before.get(k)) != str(v)]
        billing_audit.write(operator["store"], "plan_changed", actor=operator["label"],
                            detail=f'Plan "{plan_id}" changed. ' + "; ".join(changed[:8]))
        # Every school on this plan is affected, so no cached entitlement
        # anywhere may survive the change.
        entitlements.invalidate()
    return _send(result)


@router.get("/features")
def admin_features(request: Request, authorization: str = Header(None),
                   x_platform_key: str = Header(None)):
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    return {"ok": True, "features": plan_lib.list_features(operator["repo"]),
            "grid": plan_lib.feature_grid(operator["repo"])}


@router.post("/features")
async def admin_create_feature(request: Request, authorization: str = Header(None),
                               x_platform_key: str = Header(None)):
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    result = plan_lib.create_feature(operator["repo"], await _json(request))
    if result.get("ok"):
        billing_audit.write(operator["store"], "feature_created", actor=operator["label"],
                            detail=f'Feature "{result["feature"]["feature_key"]}" was created.')
    return _send(result)


@router.post("/plan-features")
async def admin_set_plan_feature(request: Request, authorization: str = Header(None),
                                 x_platform_key: str = Header(None)):
    """Move a feature onto or off a plan. Takes effect on every school on that
    plan, on their next request — no deployment, no restart (§14)."""
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    body = await _json(request)
    result = plan_lib.set_plan_feature(operator["repo"], str(body.get("plan_id") or ""),
                                       str(body.get("feature_key") or ""),
                                       body.get("enabled") is not False,
                                       body.get("limit_value"))
    if result.get("ok"):
        billing_audit.write(
            operator["store"], "plan_feature_changed", actor=operator["label"],
            detail=f'{body.get("plan_id")}: {body.get("feature_key")} '
                   f'{"granted" if result["enabled"] else "withheld"}.')
        entitlements.invalidate()
    return _send(result)


# ── Discounts and exemptions ────────────────────────────────────────────────
@router.get("/discounts")
def admin_discounts(request: Request, school_id: str = "", authorization: str = Header(None),
                    x_platform_key: str = Header(None)):
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    return {"ok": True,
            "discounts": adjustments.list_discounts(operator["repo"], school_id or None)}


@router.post("/discounts")
async def admin_grant_discount(request: Request, authorization: str = Header(None),
                               x_platform_key: str = Header(None)):
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    body = await _json(request)
    school_id = str(body.get("school_id") or "")
    if not operator["store"].get_school(school_id):
        return _err(404, "No such school.")
    return _send(adjustments.grant_discount(operator["store"], operator["repo"],
                                            school_id, body, actor=operator["label"]))


@router.delete("/discounts/{discount_id}")
@router.post("/discounts/{discount_id}/revoke")
async def admin_revoke_discount(discount_id: int, request: Request,
                                authorization: str = Header(None),
                                x_platform_key: str = Header(None)):
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    body = await _json(request)
    return _send(adjustments.revoke_discount(operator["store"], operator["repo"], discount_id,
                                             actor=operator["label"],
                                             reason=str(body.get("reason") or "")[:300]))


@router.get("/exemptions")
def admin_exemptions(request: Request, school_id: str = "", authorization: str = Header(None),
                     x_platform_key: str = Header(None)):
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    return {"ok": True,
            "exemptions": adjustments.list_exemptions(operator["repo"], school_id or None)}


@router.post("/exemptions")
async def admin_grant_exemption(request: Request, authorization: str = Header(None),
                                x_platform_key: str = Header(None)):
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    body = await _json(request)
    school_id = str(body.get("school_id") or "")
    if not operator["store"].get_school(school_id):
        return _err(404, "No such school.")
    return _send(adjustments.grant_exemption(operator["store"], operator["repo"],
                                             school_id, body, actor=operator["label"]))


@router.delete("/exemptions/{exemption_id}")
@router.post("/exemptions/{exemption_id}/revoke")
async def admin_revoke_exemption(exemption_id: int, request: Request,
                                 authorization: str = Header(None),
                                 x_platform_key: str = Header(None)):
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    body = await _json(request)
    return _send(adjustments.revoke_exemption(operator["store"], operator["repo"], exemption_id,
                                              actor=operator["label"],
                                              reason=str(body.get("reason") or "")[:300]))


# ── Invoices, payments and the billing run ──────────────────────────────────
@router.get("/invoices")
def admin_invoices(request: Request, school_id: str = "", status: str = "",
                   authorization: str = Header(None), x_platform_key: str = Header(None)):
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    return {"ok": True, "invoices": invoice_lib.list_invoices(
        operator["repo"], school_id=school_id or None, status=status or None, limit=500)}


@router.get("/invoices/{invoice_id}")
def admin_invoice(invoice_id: int, request: Request, authorization: str = Header(None),
                  x_platform_key: str = Header(None)):
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    invoice = invoice_lib.get_invoice(operator["repo"], invoice_id)
    return {"ok": True, "invoice": invoice} if invoice else _err(404, "No such invoice.")


@router.post("/invoices")
async def admin_raise_invoice(request: Request, authorization: str = Header(None),
                              x_platform_key: str = Header(None)):
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    body = await _json(request)
    return _send(invoice_lib.raise_invoice(operator["store"], operator["repo"],
                                           str(body.get("school_id") or ""),
                                           actor=operator["label"]))


@router.post("/invoices/{invoice_id}/{action}")
async def admin_invoice_action(invoice_id: int, action: str, request: Request,
                               authorization: str = Header(None),
                               x_platform_key: str = Header(None)):
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    body = await _json(request)
    store, repo, who = operator["store"], operator["repo"], operator["label"]
    reason = str(body.get("reason") or "")[:300]
    if action == "pay":
        return _send(invoice_lib.mark_paid(store, repo, invoice_id, amount=body.get("amount"),
                                           actor=who, reference=reason or "Recorded by hand."))
    if action == "void":
        return _send(invoice_lib.void(store, repo, invoice_id, actor=who, reason=reason))
    if action == "exempt":
        return _send(invoice_lib.mark_exempt(store, repo, invoice_id, actor=who, reason=reason))
    return _err(400, "An invoice action is pay, void or exempt.")


@router.get("/payments")
def admin_payments(request: Request, school_id: str = "", status: str = "",
                   authorization: str = Header(None), x_platform_key: str = Header(None)):
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    where = {}
    if school_id:
        where["school_id"] = school_id
    if status:
        where["status"] = status
    return {"ok": True, "payments": operator["repo"].find(
        "platform_payments", where, order_by="id", desc=True, limit=500)}


@router.post("/payments/{payment_id}/refund")
async def admin_refund(payment_id: int, request: Request, authorization: str = Header(None),
                       x_platform_key: str = Header(None)):
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    body = await _json(request)
    return _send(billing_provider.refund(operator["store"], operator["repo"], payment_id,
                                         actor=operator["label"],
                                         reason=str(body.get("reason") or "")[:300]))


@router.post("/billing-run")
async def admin_billing_run(request: Request, authorization: str = Header(None),
                            x_platform_key: str = Header(None)):
    """Run the billing cycle now.

    The same function a scheduler calls, reachable by hand so an operator can
    close a month without waiting for a cron — and so that what the scheduled
    run does can be seen rather than inferred from its effects.
    """
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    body = await _json(request)
    report = invoice_lib.run_billing(operator["store"], operator["repo"],
                                     school_id=body.get("school_id") or None)
    billing_audit.write(operator["store"], "billing_run", actor=operator["label"],
                        detail=f'Billing run: {len(report["invoiced"])} invoiced, '
                               f'{len(report["exempt"])} exempt, '
                               f'{len(report["advanced"])} moved, '
                               f'{len(report["errors"])} failed.')
    entitlements.invalidate()
    return {"ok": True, "report": report}


# ── Usage and reporting ─────────────────────────────────────────────────────
@router.get("/usage")
def admin_usage(request: Request, refresh: bool = False, authorization: str = Header(None),
                x_platform_key: str = Header(None)):
    """Pupil counts across the platform. `refresh=1` re-counts from every
    school's own database rather than reading the last snapshot — slower, and
    the truth."""
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    store, repo = operator["store"], operator["repo"]
    rows = []
    for school in platform_api.list_schools(store):
        subscription = subs.current(repo, school["school_id"])
        if refresh:
            counted = usage_lib.count_students(store, repo, school["school_id"])
            usage_lib.snapshot(store, repo, school["school_id"],
                               (subscription or {}).get("plan_id") or "")
        else:
            newest = repo.find_one("usage_snapshots", {"school_id": school["school_id"]},
                                   order_by="captured_at", desc=True)
            counted = {"billable_students": int((newest or {}).get("billable_students") or 0),
                       "total_students": int((newest or {}).get("total_students") or 0),
                       "staff_count": int((newest or {}).get("staff_count") or 0),
                       "source": "snapshot", "as_of": (newest or {}).get("captured_at")}
        plan = plan_lib.get_plan(repo, (subscription or {}).get("plan_id"))
        rows.append({
            "school_id": school["school_id"], "name": school["name"],
            "plan_id": (subscription or {}).get("plan_id"),
            "status": (subscription or {}).get("status") or "NONE",
            **counted,
            "ceiling": (plan or {}).get("max_students"),
            "over_ceiling": bool(plan and plan.get("max_students") is not None
                                 and counted["billable_students"] > int(plan["max_students"])),
        })
    rows.sort(key=lambda r: r["billable_students"], reverse=True)
    return {"ok": True, "usage": rows,
            "billable_statuses": usage_lib.billable_statuses(repo),
            "total": sum(r["billable_students"] for r in rows)}


@router.get("/reports/revenue")
def admin_revenue(request: Request, since: str = "", school_id: str = "",
                  authorization: str = Header(None), x_platform_key: str = Header(None)):
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    repo = operator["repo"]
    return {"ok": True,
            "totals": invoice_lib.revenue_report(repo, school_id=school_id or None,
                                                 since=since or None),
            # Per school, so the waterfall can be opened up rather than only
            # totalled — which is what an operator asking "who is exempt and
            # what is that costing us" actually needs.
            "schools": sorted(
                [{"school_id": s["school_id"], "name": s["name"],
                  **invoice_lib.revenue_report(repo, school_id=s["school_id"],
                                               since=since or None)}
                 for s in platform_api.list_schools(operator["store"])],
                key=lambda r: r["net_billed"], reverse=True)}


# ── Settings and the audit trail ────────────────────────────────────────────
@router.get("/settings")
def admin_settings(request: Request, authorization: str = Header(None),
                   x_platform_key: str = Header(None)):
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    from .billing import defaults
    values = platform_settings.all_settings(operator["repo"])
    return {"ok": True, "settings": values,
            "known": sorted(defaults.SETTINGS),
            "payments": billing_provider.public_config(operator["repo"])}


@router.post("/settings")
async def admin_set_settings(request: Request, authorization: str = Header(None),
                             x_platform_key: str = Header(None)):
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    body = await _json(request)
    before = platform_settings.all_settings(operator["repo"])
    result = platform_settings.set_many(operator["repo"], body, actor=operator["label"])
    if result.get("ok"):
        changed = [f"{k}: {before.get(k)} → {v}" for k, v in result["settings"].items()
                   if str(before.get(k)) != str(v)]
        if changed:
            billing_audit.write(operator["store"], "platform_settings_changed",
                                actor=operator["label"], detail="; ".join(changed[:10]))
        entitlements.invalidate()
    return _send(result)


# ── Nickland's own gateway ──────────────────────────────────────────────────
@router.get("/gateways")
def admin_gateways(request: Request, authorization: str = Header(None),
                   x_platform_key: str = Header(None)):
    """The providers available, and which one the platform is charging through.

    Credentials come back redacted — `••••` and the last four characters. There
    is no route here that returns a secret, and there must never be one, for the
    same reason a school's own screen does not get one: an operator account is
    a credential, not a vault.
    """
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    from . import gateways as gateway_lib
    repo = operator["repo"]
    rows = repo.find("platform_gateways", order_by="gateway")
    return {
        "ok": True,
        "catalogue": gateway_lib.catalogue(),
        "configured": [
            {"gateway": row["gateway"],
             "credentials": gateway_lib.redact(row["gateway"], row.get("credentials")),
             "currency": row.get("currency"), "is_active": row.get("is_active"),
             "verified": bool(row.get("verified_at")), "verified_at": row.get("verified_at"),
             "verified_detail": row.get("verified_detail")}
            for row in rows],
        "active": billing_provider.public_config(repo),
    }


@router.post("/gateways")
async def admin_save_gateway(request: Request, authorization: str = Header(None),
                             x_platform_key: str = Header(None)):
    """Store Nickland's credentials for one provider. Never makes it active."""
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    from . import gateways as gateway_lib
    body = await _json(request)
    repo = operator["repo"]
    chosen = str(body.get("gateway") or "").strip().lower()
    adapter = gateway_lib.get(chosen)
    if not adapter:
        return _err(400, "That is not a payment provider we support.")

    existing = repo.get("platform_gateways", chosen) or {}
    credentials, problems = gateway_lib.clean(chosen, body.get("credentials"),
                                              existing.get("credentials"))
    if problems:
        return _err(400, " ".join(problems))
    currency = str(body.get("currency") or existing.get("currency") or "GHS").upper()
    if currency not in adapter.currencies:
        return _err(400, f"{adapter.name} does not take {currency}.")

    changed = credentials != (existing.get("credentials") or {})
    patch = {"credentials": credentials, "currency": currency,
             "callback_url": str(body.get("callback_url") or existing.get("callback_url") or ""),
             "updated_at": now_iso()}
    if changed:
        # Untested credentials cannot be the live ones, here as for a school.
        patch.update({"verified_at": None, "verified_detail": "", "is_active": False})
    if existing:
        repo.update("platform_gateways", chosen, patch)
    else:
        repo.insert("platform_gateways", {"gateway": chosen, "is_active": False, **patch})
    billing_audit.write(operator["store"], "platform_gateway_saved", actor=operator["label"],
                        detail=f"{adapter.name} credentials stored"
                               + (" (changed)" if changed else "") + ".")
    return {"ok": True, "gateway": chosen, "verified": not changed and bool(existing.get("verified_at"))}


@router.post("/gateways/{gateway_id}/test")
def admin_test_gateway(gateway_id: str, request: Request, authorization: str = Header(None),
                       x_platform_key: str = Header(None)):
    """Ask the provider whether Nickland's credentials are real.

    The same rule the schools are held to: a gateway that has not answered a
    test cannot be made the live one.
    """
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    from . import gateways as gateway_lib
    repo = operator["repo"]
    row = repo.get("platform_gateways", gateway_id)
    adapter = gateway_lib.get(gateway_id)
    if not row or not adapter:
        return _err(404, "That gateway has not been set up.")
    settings = gateway_lib.config_for(gateway_id, row.get("credentials") or {},
                                      currency=row.get("currency") or "GHS")
    missing = adapter.missing(settings)
    if missing:
        return _err(400, "Still needed: " + ", ".join(missing) + ".")
    try:
        result = adapter.ping(settings)
    except Exception as exc:
        result = {"ok": False,
                  "error": f"{adapter.name} could not be reached ({exc.__class__.__name__})."}
    if result.get("ok"):
        repo.update("platform_gateways", gateway_id,
                    {"verified_at": now_iso(),
                     "verified_detail": str(result.get("detail") or "")[:300]})
        billing_audit.write(operator["store"], "platform_gateway_tested",
                            actor=operator["label"], detail=f"{adapter.name}: passed")
        return {"ok": True, "detail": result.get("detail")}
    repo.update("platform_gateways", gateway_id,
                {"verified_at": None, "verified_detail": "", "is_active": False})
    billing_audit.write(operator["store"], "platform_gateway_tested", actor=operator["label"],
                        outcome="failed", detail=f'{adapter.name}: failed — {result.get("error")}')
    return _err(400, result.get("error") or f"{adapter.name} refused the credentials.")


@router.post("/gateways/{gateway_id}/activate")
def admin_activate_gateway(gateway_id: str, request: Request,
                           authorization: str = Header(None),
                           x_platform_key: str = Header(None)):
    """Make one provider the live one. Exactly one at a time."""
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    from . import gateways as gateway_lib
    repo = operator["repo"]
    row = repo.get("platform_gateways", gateway_id)
    adapter = gateway_lib.get(gateway_id)
    if not row or not adapter:
        return _err(404, "That gateway has not been set up.")
    if not row.get("verified_at"):
        return _err(400, "Test the connection first. A provider that has not "
                         "answered cannot be made the live one.")
    # Stood down first, then the new one raised. The database enforces one
    # active row; doing it in this order means the constraint is never the
    # thing that fails.
    repo.update_where("platform_gateways", {"is_active": True}, {"is_active": False})
    repo.update("platform_gateways", gateway_id, {"is_active": True})
    billing_audit.write(operator["store"], "platform_gateway_activated",
                        actor=operator["label"],
                        detail=f"Subscriptions are now charged through {adapter.name}.")
    return {"ok": True, "active": billing_provider.public_config(repo)}


@router.get("/audit")
def admin_audit(request: Request, limit: int = 200, school_id: str = "", refused: bool = False,
                authorization: str = Header(None), x_platform_key: str = Header(None)):
    try:
        operator = _guard(request, authorization, x_platform_key)
    except Denied as denied:
        return denied.response
    return {"ok": True, "audit": billing_audit.read(operator["store"], limit=limit,
                                                    school_id=school_id or None,
                                                    refused_only=refused)}


# ── A scheduler's way in ────────────────────────────────────────────────────
# The billing run has to happen on a schedule, and a deployment's scheduler is
# usually a cron service with a URL and nothing else. This gives it one, with
# its own secret, so a cron does not have to hold the console's key.
ENV_CRON_SECRET = "BILLING_CRON_SECRET"


def _cron_guard(request, presented):
    """The scheduler's own credential, checked in constant time.

    Its own secret rather than the console's, so a cron service holds a key
    that can start a run and nothing else. Under 16 characters there is no
    scheduled anything on this service and the routes answer 404 — a half-set
    variable should not leave a door ajar.
    """
    secret = os.environ.get(ENV_CRON_SECRET, "").strip()
    if len(secret) < 16:
        return _err(404, "Nothing scheduled is configured on this service.")
    if not presented or not hmac.compare_digest(
            hashlib.sha256(str(presented).encode()).hexdigest(),
            hashlib.sha256(secret.encode()).hexdigest()):
        billing_audit.write(request.app.state.store, "cron_refused",
                            actor="anonymous", outcome="refused",
                            detail="A scheduled run was refused.")
        return _err(401, "Unauthorized")
    return None


@router.post("/cron/notifications")
async def cron_notifications(request: Request, x_cron_key: str = Header(None)):
    """Deliver the messages hosted schools have queued.

    A school running the desktop drains its own queue; a school that is only
    hosted has nothing to drain it, and its messages sat in the table forever.
    This is that missing half, on the same schedule secret as the billing run —
    a cron service should hold one credential, not two.

    Every message goes out through the SCHOOL's own Arkesel key and is charged
    to the school's own Arkesel account, which is why a school with no key
    configured is skipped rather than failed.
    """
    problem = _cron_guard(request, x_cron_key)
    if problem:
        return problem
    from .school import notify
    report = notify.drain_all()
    if report["sent"] or report["failed"] or report["errors"]:
        billing_audit.write(request.app.state.store, "notifications_run", actor="scheduler",
                            detail=f'{report["sent"]} sent, {report["failed"]} failed, '
                                   f'across {report["schools"]} school(s).')
    return {"ok": True, "report": report}


@router.post("/cron/billing-run")
async def cron_billing_run(request: Request, x_cron_key: str = Header(None)):
    problem = _cron_guard(request, x_cron_key)
    if problem:
        return problem
    store = request.app.state.store
    report = invoice_lib.run_billing(store, repo_for(store))
    billing_audit.write(store, "billing_run", actor="scheduler",
                        detail=f'Scheduled run: {len(report["invoiced"])} invoiced, '
                               f'{len(report["exempt"])} exempt, '
                               f'{len(report["errors"])} failed.')
    entitlements.invalidate()
    return {"ok": True, "report": report}
