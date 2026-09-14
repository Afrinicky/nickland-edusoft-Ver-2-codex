"""A school's own billing section (§12).

Everything a school administrator needs to understand what they are paying and
why: the plan, the status, the trial, the roll they are billed on, the price
per pupil, the discount, the exemption, the final amount, the next billing
date, the payment method, the invoices and the history.

Two rules, and both are load-bearing.

**A school sees its own billing and nobody else's.** The tenant is taken from
the token, never from a parameter, so there is no id a caller could change to
look at another school. Every read below is filtered by that same school_id,
including the ones that take an invoice id — an invoice number is a small
integer and therefore guessable.

**These routes are NOT gated on the subscription.** That is deliberate and it
is the whole reason this is a separate router rather than more handlers in
`school_api`. A suspended school has to be able to reach the screen that tells
it it is suspended and the button that fixes it; gating billing behind the
subscription would be a lock whose key is inside the box.

Who may see it: the people who run the school — Proprietor, Super Admin — and
anybody the school has given Fees at view or above. Not every teacher: what a
school pays Nickland is not the staff room's business.
"""
from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse

from . import identity, portals
from .billing import adjustments, engine, entitlements, invoices as invoice_lib
from .billing import plans as plan_lib
from .billing import provider as billing_provider
from .billing import devices as device_lib
from .billing import reminders
from .billing import settings as platform_settings
from .billing import subscriptions as subs
from .billing import usage as usage_lib
from .billing.repo import money, repo_for
from .school import db as sdb, security, session as school_session

router = APIRouter(prefix="/api/v1/school/billing")


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


def _caller(authorization, need_manage=False):
    """Who is asking, and whether billing is theirs to see.

    Returns `(school_id, db, actor)`. Raises `Denied` otherwise — never a
    different message for "no such school" and "wrong password", because this
    route is reachable from the internet with a guessable tenant id.
    """
    raw = authorization[7:] if authorization and authorization.startswith("Bearer ") else ""
    if "." not in raw:
        raise Denied(_err(401, "Please sign in."))
    school_id, _, token = raw.partition(".")
    try:
        db = sdb.SchoolDb(school_id)
        actor = school_session.actor_for(db, token)
    except Exception:
        raise Denied(_err(401, "Please sign in."))
    if not actor:
        raise Denied(_err(401, "Please sign in."))

    elevated = bool(actor.get("is_admin")) or portals.is_super_admin(actor)
    if need_manage:
        # Changing the plan or the card is the owner's decision, not the
        # bursar's — it commits the school to money.
        if not elevated:
            security.deny(db, actor, "billing:manage",
                          "Only the school's owner or Super Admin can change the subscription.")
            raise Denied(_err(403, "Only the school's owner or Super Admin can "
                                   "change the subscription."))
    elif not (elevated or security.can(actor, "fees", "view")):
        security.deny(db, actor, "billing:view", "Access denied.")
        raise Denied(_err(403, "Access denied."))
    return school_id, db, actor


@router.get("")
@router.get("/")
def billing_overview(request: Request, authorization: str = Header(None)):
    """Everything §12 asks for, in one call.

    One call rather than six because this is one screen, and six round trips
    from a phone on a Ghanaian mobile connection is the difference between a
    page that appears and a page that assembles itself in front of you.
    """
    try:
        school_id, db, actor = _caller(authorization)
    except Denied as denied:
        return denied.response

    store = request.app.state.store
    repo = repo_for(store)
    subscription = subs.current(repo, school_id) or subs.latest(repo, school_id)
    entitlement = entitlements.for_school(store, school_id)
    counted = usage_lib.count_students(store, repo, school_id)

    plan = plan_lib.get_plan(repo, (subscription or {}).get("plan_id")
                             or entitlement.get("plan_id")
                             or platform_settings.get(repo, "default_plan", "pro"))
    quoted = engine.quote(repo, school_id, plan, counted["billable_students"],
                          subscription=subscription) if plan else None

    discount = engine.active_discount(repo, school_id)
    exemption = engine.active_exemption(repo, school_id)
    all_invoices = invoice_lib.list_invoices(repo, school_id=school_id, limit=50)
    outstanding = [i for i in all_invoices if i["status"] in invoice_lib.OUTSTANDING]

    return {
        "ok": True,
        "school": {"id": school_id, "name": db.get_setting("school_name", school_id)},
        "managed": entitlement.get("managed", True),
        "status": entitlement.get("status"),
        "status_label": entitlement.get("status_label"),
        "notice": entitlement.get("notice"),
        "notice_level": entitlement.get("notice_level"),
        "access": entitlement.get("access"),
        "plan": plan,
        "subscription": subscription,
        "trial": identity.trial_summary(repo, subscription),
        "next_billing_date": (subscription or {}).get("current_period_end"),
        "usage": counted,
        # The waterfall, itemised, so a school can check the figure rather than
        # take it on trust — which is the entire point of §12.
        "quote": quoted,
        "lines": engine.quote_lines(quoted) if quoted else [],
        "discount": adjustments.with_state(discount) if discount else None,
        "exemption": adjustments.with_state(exemption) if exemption else None,
        "payment_methods": [_safe_method(m) for m in billing_provider.methods_for(repo, school_id)],
        "payments": [_safe_payment(p) for p in repo.find(
            "platform_payments", {"school_id": school_id}, order_by="id", desc=True, limit=25)],
        "invoices": all_invoices,
        "outstanding": {"count": len(outstanding),
                        "amount": money(sum(float(i["total_amount"] or 0) for i in outstanding))},
        "history": subs.history(repo, school_id),
        "events": subs.events(repo, school_id, limit=40),
        "can_manage": bool(actor.get("is_admin")) or portals.is_super_admin(actor),
        "payments_available": billing_provider.configured(repo),
        "payment_channels": billing_provider.public_config(repo),
        "currency": platform_settings.get(repo, "currency", "GHS"),
        # What the school has been told and when — the same reminders that went
        # out by email and SMS, shown here so a bursar who deleted the text can
        # still find out what it said.
        "reminders": reminders.unread_for(repo, school_id, limit=10),
        # The machines this school has activated, and how many it may. The
        # school manages these itself — an operator should never be the one
        # freeing a seat because somebody's laptop was stolen.
        "seats": device_lib.summary(repo, school_id),
        "renew": renewal_quote(store, repo, school_id, subscription, plan, counted),
    }


def renewal_quote(store, repo, school_id, subscription, plan, counted):
    """What renewing would cost, and whether it is worth offering.

    A school renews EARLY — before the period ends — as often as it renews
    late, and both go through the same door. The figure is this school's own
    quote at its current roll, not the plan's list price, so the number on the
    Renew button is the number that gets charged.
    """
    if not (subscription and plan):
        return {"available": False}
    quoted = engine.quote(repo, school_id, plan, counted["billable_students"],
                          subscription=subscription)
    outstanding = [i for i in invoice_lib.list_invoices(repo, school_id=school_id)
                   if i["status"] in invoice_lib.OUTSTANDING]
    outstanding.sort(key=lambda i: str(i.get("issued_at") or ""))
    return {
        "available": subscription.get("status") in subs.LIVE,
        # An unpaid invoice is what renewal means for a school that has fallen
        # behind; a school that is up to date is paying for the period ahead.
        "invoice_id": outstanding[0]["id"] if outstanding else None,
        "amount": money(outstanding[0]["total_amount"]) if outstanding
                  else quoted["total_amount"],
        "settles_arrears": bool(outstanding),
        "period_end": subscription.get("current_period_end") or "",
        "status": subscription.get("status"),
        "currency": platform_settings.get(repo, "currency", "GHS"),
    }


@router.post("/renew")
async def billing_renew(request: Request, authorization: str = Header(None)):
    """Renew this subscription — the button every reminder points at.

    Deliberately NOT restricted to a card. §7's card check exists because a
    subscription that renews ITSELF needs something chargeable next month; a
    school renewing by hand needs no such thing, and in Ghana the way most
    schools pay is mobile money. Refusing it here would mean a reminder whose
    button a bursar cannot use.

    Nothing about the lifecycle moves here. The payment is started; the period
    is extended when the money actually arrives, by the same `settle()` every
    other payment goes through — so a checkout somebody abandons costs the
    school nothing and grants it nothing.
    """
    try:
        school_id, _db, _actor = _caller(authorization, need_manage=True)
    except Denied as denied:
        return denied.response

    store = request.app.state.store
    repo = repo_for(store)
    if not billing_provider.configured(repo):
        return _err(503, "Online payment is not switched on for this deployment.")

    body = await _json(request)
    subscription = subs.current(repo, school_id)
    if not subscription:
        return _err(404, "This school has no subscription to renew.")

    counted = usage_lib.count_students(store, repo, school_id)
    plan = plan_lib.get_plan(repo, subscription["plan_id"])
    quote = renewal_quote(store, repo, school_id, subscription, plan, counted)
    amount = money(body.get("amount") or quote["amount"])
    if amount <= 0:
        return _err(400, "There is nothing to pay.")

    identities = identity.directory_entry(store, school_id)
    email = str(body.get("email") or (identities[0]["email"] if identities else "")).strip()
    started = billing_provider.start_checkout(
        store, repo, school_id, email, amount, kind="subscription",
        invoice_id=quote.get("invoice_id"),
        callback_url=str(body.get("callback_url") or "") or None,
        # Whatever the school wants to pay with. See the docstring.
        channels=body.get("channels") or None)
    return _send(started)


@router.delete("/devices/{device_id}")
def billing_deactivate_device(device_id: int, request: Request,
                              authorization: str = Header(None)):
    """Free a seat. The school's own button, not an operator's.

    Takes effect at that machine's very next request, because its credential is
    its own and resolving it checks the seat (see main.require_school). The
    machine then falls back to its stored lease and, when that runs out,
    read-only — the same door every other lapse goes through.
    """
    try:
        school_id, _db, _actor = _caller(authorization, need_manage=True)
    except Denied as denied:
        return denied.response
    store = request.app.state.store
    return _send(device_lib.deactivate(store, repo_for(store), school_id, device_id,
                                       actor="school"))


@router.post("/reminders/read")
async def billing_reminders_read(request: Request, authorization: str = Header(None)):
    """Mark the in-app reminders seen, so the banner stops shouting."""
    try:
        school_id, _db, _actor = _caller(authorization)
    except Denied as denied:
        return denied.response
    body = await _json(request)
    repo = repo_for(request.app.state.store)
    return _send(reminders.mark_read(repo, school_id, body.get("id")))


@router.get("/plans")
def billing_plans(request: Request, authorization: str = Header(None)):
    """The plans this school could move to, priced against its actual roll.

    The same rows the public pricing page reads, but quoted for THIS school —
    so a school with a discount sees what it would really pay on Max, not the
    list price.
    """
    try:
        school_id, _db, _actor = _caller(authorization)
    except Denied as denied:
        return denied.response
    store = request.app.state.store
    repo = repo_for(store)
    counted = usage_lib.count_students(store, repo, school_id)
    subscription = subs.current(repo, school_id)
    out = []
    for plan in plan_lib.list_plans(repo):
        out.append({**plan,
                    "quote": engine.quote(repo, school_id, plan,
                                          counted["billable_students"],
                                          subscription=subscription),
                    "current": bool(subscription and subscription["plan_id"] == plan["plan_id"])})
    return {"ok": True, "plans": out, "students": counted["billable_students"]}


@router.post("/plan")
async def billing_change_plan(request: Request, authorization: str = Header(None)):
    try:
        school_id, _db, actor = _caller(authorization, need_manage=True)
    except Denied as denied:
        return denied.response
    body = await _json(request)
    store = request.app.state.store
    repo = repo_for(store)
    result = subs.change_plan(store, repo, school_id, str(body.get("plan_id") or ""),
                              actor=f'school:{actor["username"]}',
                              note="Changed by the school.")
    entitlements.invalidate(school_id)
    return _send(result)


@router.post("/subscribe")
async def billing_subscribe(request: Request, authorization: str = Header(None)):
    """Start a subscription for a school that has none — a grandfathered school
    choosing to come onto a plan, or one that cancelled and is coming back."""
    try:
        school_id, _db, actor = _caller(authorization, need_manage=True)
    except Denied as denied:
        return denied.response
    body = await _json(request)
    store = request.app.state.store
    repo = repo_for(store)
    plan_id = str(body.get("plan_id") or "") or platform_settings.get(repo, "default_plan", "pro")
    result = subs.start(store, repo, school_id, plan_id,
                        actor=f'school:{actor["username"]}')
    entitlements.invalidate(school_id)
    return _send(result)


@router.post("/cancel")
async def billing_cancel(request: Request, authorization: str = Header(None)):
    try:
        school_id, _db, actor = _caller(authorization, need_manage=True)
    except Denied as denied:
        return denied.response
    body = await _json(request)
    store = request.app.state.store
    result = subs.cancel(store, repo_for(store), school_id,
                         actor=f'school:{actor["username"]}',
                         at_period_end=body.get("immediately") is not True,
                         reason=str(body.get("reason") or "")[:300])
    entitlements.invalidate(school_id)
    return _send(result)


@router.get("/invoices/{invoice_id}")
def billing_invoice(invoice_id: int, request: Request, authorization: str = Header(None)):
    try:
        school_id, _db, _actor = _caller(authorization)
    except Denied as denied:
        return denied.response
    invoice = invoice_lib.get_invoice(repo_for(request.app.state.store), invoice_id,
                                      school_id=school_id)
    if not invoice:
        return _err(404, "No such invoice.")
    return {"ok": True, "invoice": invoice}


@router.post("/pay")
async def billing_pay(request: Request, authorization: str = Header(None)):
    """Settle an outstanding invoice, or put a card on file.

    Named invoice or oldest outstanding; a school with nothing outstanding gets
    a card-authorisation checkout instead, which is how a trialing school adds
    the payment method its trial will need at the end.
    """
    try:
        school_id, _db, actor = _caller(authorization, need_manage=True)
    except Denied as denied:
        return denied.response
    # `store` first. This read used to come BEFORE the assignment below, which
    # makes `store` a local that does not exist yet — so every call to this
    # route raised UnboundLocalError and no school could ever pay from the
    # portal. Nothing caught it because the route had no test that got this far.
    store = request.app.state.store
    repo = repo_for(store)
    if not billing_provider.configured(repo):
        return _err(503, "Card payments are not switched on for this deployment.")
    body = await _json(request)

    invoice = None
    if body.get("invoice_id"):
        invoice = invoice_lib.get_invoice(repo, body["invoice_id"], school_id=school_id)
        if not invoice:
            return _err(404, "No such invoice.")
        if invoice["status"] not in invoice_lib.OUTSTANDING:
            return _err(400, "That invoice has nothing outstanding.")
    else:
        open_ones = [i for i in invoice_lib.list_invoices(repo, school_id=school_id)
                     if i["status"] in invoice_lib.OUTSTANDING]
        open_ones.sort(key=lambda i: str(i.get("issued_at") or ""))
        invoice = open_ones[0] if open_ones else None

    identities = identity.directory_entry(store, school_id)
    email = str(body.get("email") or (identities[0]["email"] if identities else "")).strip()
    amount = money(invoice["total_amount"]) if invoice else 0.0
    return _send(billing_provider.start_checkout(
        store, repo, school_id, email, amount,
        kind="subscription" if amount > 0 else "setup",
        invoice_id=invoice["id"] if invoice else None,
        callback_url=str(body.get("callback_url") or "") or None))


@router.delete("/payment-methods/{method_id}")
def billing_forget_method(method_id: int, request: Request, authorization: str = Header(None)):
    try:
        school_id, _db, _actor = _caller(authorization, need_manage=True)
    except Denied as denied:
        return denied.response
    return _send(billing_provider.forget_method(repo_for(request.app.state.store),
                                                school_id, method_id))


@router.get("/usage")
def billing_usage(request: Request, authorization: str = Header(None)):
    try:
        school_id, _db, _actor = _caller(authorization)
    except Denied as denied:
        return denied.response
    store = request.app.state.store
    repo = repo_for(store)
    return {"ok": True,
            "now": usage_lib.count_students(store, repo, school_id),
            "billable_statuses": usage_lib.billable_statuses(repo),
            "history": usage_lib.history(repo, school_id, limit=60)}


# ── What a school may be told about its own payment records ─────────────────
# The provider's customer id and authorisation code are credentials in every
# way that matters — anything holding one can charge the card. They are not
# served, here or anywhere, and the four digits and the brand are what a bursar
# actually needs to recognise which of their cards is on file.
def _safe_method(method):
    return {
        "id": method["id"], "kind": method.get("kind"), "brand": method.get("brand"),
        "last4": method.get("last4"), "exp_month": method.get("exp_month"),
        "exp_year": method.get("exp_year"), "is_default": method.get("is_default"),
        "added": str(method.get("created_at") or "")[:10],
        "expired": _method_expired(method),
    }


def _method_expired(method):
    import datetime
    year, month = method.get("exp_year"), method.get("exp_month")
    if not year or not month:
        return False
    today = datetime.datetime.now(datetime.timezone.utc)
    return (int(year), int(month)) < (today.year, today.month)


def _safe_payment(payment):
    return {
        "id": payment["id"], "amount": money(payment.get("amount")),
        "currency": payment.get("currency"), "status": payment.get("status"),
        "kind": payment.get("kind"), "failure_reason": payment.get("failure_reason"),
        "at": payment.get("settled_at") or payment.get("attempted_at"),
        "invoice_id": payment.get("invoice_id"),
        # The provider's reference IS shown: it is what a school quotes to its
        # bank or to Nickland's support when a payment is disputed, and it
        # authorises nothing on its own.
        "reference": payment.get("provider_reference"),
    }
