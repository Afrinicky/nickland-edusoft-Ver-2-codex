"""The front door — what the public website talks to.

Five things, and nothing else:

    GET  /api/v1/public/config      what this platform is called, and its currency
    GET  /api/v1/public/plans       the plans, priced from the database (§16)
    GET  /api/v1/public/estimate    what N pupils would cost on a plan
    POST /api/v1/public/register    a school, an administrator, a subscription
    POST /api/v1/public/login       one sign-in, routed to the right school

Everything here is unauthenticated, which is why it is small and why each route
is deliberate about what it will not say. The plan list is the same rows the
checkout, the invoice and the console read — there is no second copy of the
pricing anywhere, so a price the Superadmin changes is live on the website on
the next page load (§16). And no route here will confirm whether an email
address or a school exists: the login answers the same way for a wrong password
and an unknown address, because a box that tells you which is which is a box
for enumerating a platform's customers.
"""
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from . import identity, platform_api, ratelimit
from .billing import engine, entitlements, plans as plan_lib
from .billing import provider as billing_provider
from .billing import settings as platform_settings
from .billing import subscriptions as subs
from .billing.repo import repo_for

router = APIRouter(prefix="/api/v1/public")


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


def _store(request):
    return request.app.state.store


def _client_addr(request):
    try:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()[:64]
        return request.client.host if request.client else None
    except Exception:
        return None


@router.get("/config")
def public_config(request: Request):
    """What the website needs before it can draw anything.

    Includes the payment gateway's PUBLIC key when there is one, and never the
    secret — the browser needs the first to open a checkout and must never see
    the second.
    """
    repo = repo_for(_store(request))
    return {
        "ok": True,
        **platform_settings.public_view(repo),
        "payments": billing_provider.public_config(),
        "base_domain": (platform_api.portal_base_domains() or [None])[0],
    }


@router.get("/plans")
def public_plans(request: Request, students: int = 0):
    """The pricing page, priced from the database.

    `students` is optional: given one, every plan comes back with what that
    school would actually pay, which is the number a head teacher is trying to
    work out and the reason a pricing page full of "per pupil" is unhelpful.
    """
    repo = repo_for(_store(request))
    roll = max(0, min(int(students or 0), 100000))
    out = []
    for plan in plan_lib.list_plans(repo):
        priced = {**plan}
        if roll:
            priced["estimate"] = engine.estimate(repo, plan, roll)
        out.append(priced)
    return {"ok": True, "plans": out, "features": plan_lib.list_features(repo),
            "currency": platform_settings.get(repo, "currency", "GHS"),
            "trial_enabled": platform_settings.get_bool(repo, "trial_enabled", True)}


@router.get("/estimate")
def public_estimate(request: Request, plan_id: str = "", students: int = 0):
    repo = repo_for(_store(request))
    plan = plan_lib.get_plan(repo, plan_id)
    if not plan or not plan.get("is_public"):
        return _err(404, "No such plan.")
    return {"ok": True, "estimate": engine.estimate(repo, plan, max(0, int(students or 0)))}


@router.post("/register")
async def public_register(request: Request):
    """Register a school. The long one; see app/identity.register."""
    body = await _json(request)
    # Throttled by source. Registration creates a Postgres schema with
    # eighty-one tables in it, so it is the most expensive unauthenticated
    # route on the platform and the one most worth a limit.
    if ratelimit.limited(request, "register", body.get("email")):
        return _err(429, "Too many attempts. Try again shortly.")
    result = identity.register(_store(request), body, actor="public",
                               remote_addr=_client_addr(request))
    return _send(result)


@router.post("/login")
async def public_login(request: Request):
    body = await _json(request)
    if ratelimit.limited(request, "public-login", body.get("email")):
        return _err(429, "Too many attempts. Try again shortly.")
    result = identity.sign_in(_store(request), email=body.get("email"),
                              password=body.get("password"),
                              school_id=body.get("school_id"),
                              source=_client_addr(request))
    if not result.get("ok") and result.get("choose"):
        # Not an error the browser should treat as a failure — it is a
        # question. 300 rather than 4xx so a client can tell the two apart.
        return JSONResponse(status_code=300, content={
            "ok": False, "choose": True, "error": result["error"],
            "schools": result["schools"]})
    return _send(result)


@router.post("/checkout")
async def public_checkout(request: Request):
    """Take the payment details a trial needs before it starts (§7).

    The school is already registered and signed in by this point — the token it
    was given at registration is what authorises this — so the route is not
    open, despite its address. A trial charges nothing; the provider is asked
    to authorise the card so that there is a payment method on file when the
    trial ends.
    """
    body = await _json(request)
    store = _store(request)
    repo = repo_for(store)
    school_id = _school_from_token(request, body)
    if not school_id:
        return _err(401, "Please sign in.")
    if not billing_provider.configured():
        return _err(503, "Card payments are not switched on for this deployment.")

    subscription = subs.current(repo, school_id)
    if not subscription:
        return _err(404, "This school has no subscription.")
    identities = identity.directory_entry(store, school_id)
    email = str(body.get("email") or (identities[0]["email"] if identities else "")).strip()

    amount = 0.0
    if subscription["status"] != subs.TRIALING:
        plan = repo.get("subscription_plans", subscription["plan_id"]) or {}
        from .billing import usage as usage_lib
        counted = usage_lib.count_students(store, repo, school_id)
        amount = engine.quote(repo, school_id, plan, counted["billable_students"],
                              subscription=subscription)["total_amount"]

    return _send(billing_provider.start_checkout(
        store, repo, school_id, email, amount,
        kind="subscription" if amount > 0 else "setup",
        callback_url=str(body.get("callback_url") or "") or None))


@router.get("/checkout/{reference}")
def public_checkout_status(reference: str, request: Request):
    """Where the browser comes back to. It does not take the browser's word for
    it — the provider is asked, and the webhook settles it regardless of
    whether this is ever called."""
    store = _store(request)
    repo = repo_for(store)
    school_id = _school_from_token(request, {})
    payment = repo.find_one("platform_payments", {"provider_reference": reference})
    if not payment or (school_id and str(payment["school_id"]) != str(school_id)):
        return _err(404, "No such payment.")

    verified = billing_provider.verify(reference)
    if verified.get("ok") and verified.get("paid"):
        billing_provider.settle(store, repo, payment["school_id"], reference,
                                invoice_id=payment.get("invoice_id"),
                                amount=verified["amount"], method=verified.get("method"),
                                customer_id=verified.get("customer_id"), actor="callback")
        return {"ok": True, "paid": True,
                "entitlement": entitlements.summary(
                    entitlements.for_school(store, payment["school_id"], fresh=True))}
    return {"ok": True, "paid": False,
            "status": verified.get("gateway_status") or payment.get("status")}


def _school_from_token(request, body):
    """The school this caller is signed in as, from the `<school_id>.<token>`
    credential the cloud application already issues.

    The token is verified against that school's own schema, so a school id
    typed into the header by hand resolves to nothing.
    """
    from .school import db as sdb, session as school_session
    header = request.headers.get("authorization") or ""
    raw = header[7:] if header.startswith("Bearer ") else str(body.get("token") or "")
    if "." not in raw:
        return None
    school_id, _, token = raw.partition(".")
    try:
        actor = school_session.actor_for(sdb.SchoolDb(school_id), token)
    except Exception:
        return None
    return school_id if actor else None
