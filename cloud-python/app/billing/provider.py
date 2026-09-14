"""Taking the platform's own money.

Careful distinction, because this service now has two completely separate
payment paths and confusing them would be expensive:

  * ``app/payments.py`` is a SCHOOL taking fees from a PARENT, with the
    school's own gateway key, which the school supplies.
  * this module is NICKLAND taking a subscription from a SCHOOL, with
    Nickland's own gateway credentials.

They never share a key, a reference, a webhook or a table.

What is stored here: a customer id, a payment-method reference, a transaction
reference. Never a card number, never a CVV, never anything that could be
replayed as an instrument — the provider holds the card and Edusoft holds the
handle (§21).

Both use the same adapter layer (`app/gateways/`), so Nickland can take
subscriptions through whichever provider suits it without that being a property
of the code — and a school on Hubtel and a platform on Paystack are not two
payment implementations.

Three properties the webhook path has to have, and does:

  * **Verified.** The delivery is checked against the provider's own rule —
    an HMAC for Paystack, a shared hash for Flutterwave — before a single field
    of the body is believed. A provider that does not sign at all cannot settle
    anything by itself; its delivery is a reason to go and ask.
  * **Idempotent.** Every event id is written to `billing_webhook_events`
    before it is acted on; a redelivery finds it there and stops. The
    signature proves a message is genuine — only this proves it is new.
  * **Not trusted about money.** The amount is re-read from the provider, never
    taken from the webhook body.

With no key configured the whole module answers "not available", the register
flow falls back to starting a trial without a card, and every other part of the
platform works exactly as it does with one. That is the right default for a
deployment that is not taking money yet, and it is not a silent one — the boot
report says so.
"""
import os
import secrets

from .. import gateways
from . import audit as billing_audit
from . import invoices as invoice_lib
from . import subscriptions as subs
from .repo import money, now_iso

# Nickland's own gateway, chosen in the console's System settings and stored in
# `platform_gateways` — the same adapter layer a school uses for its own fees,
# pointed at the other direction of money.
#
# The environment variables still work and still win. They are how this was
# configured before the console could do it, how a deployment that prefers
# secrets-in-the-environment keeps working, and the escape hatch when somebody
# has locked themselves out of the console.
ENV_SECRET = "PLATFORM_PAYSTACK_SECRET"
ENV_PUBLIC = "PLATFORM_PAYSTACK_PUBLIC"
ENV_BASE = "PLATFORM_PAYSTACK_BASE_URL"
DEFAULT_BASE = "https://api.paystack.co"


def _from_environment():
    """Paystack, from the variables. `(adapter, Config)` or `(None, None)`."""
    secret = os.environ.get(ENV_SECRET, "").strip()
    if not secret:
        return None, None
    adapter = gateways.get("paystack")
    credentials = {"secret_key": secret,
                   "public_key": os.environ.get(ENV_PUBLIC, "").strip(),
                   "base_url": (os.environ.get(ENV_BASE) or DEFAULT_BASE).strip()}
    return adapter, gateways.config_for("paystack", credentials, currency="GHS")


def _from_console(repo):
    """The gateway an operator set up in the console, if any is active."""
    if repo is None:
        return None, None
    try:
        row = repo.find_one("platform_gateways", {"is_active": True})
    except Exception:
        return None, None
    if not row:
        return None, None
    adapter = gateways.get(row.get("gateway"))
    if not adapter:
        return None, None
    settings = gateways.config_for(adapter.id, row.get("credentials") or {},
                                   currency=row.get("currency") or "GHS",
                                   callback_url=row.get("callback_url") or "")
    if adapter.missing(settings):
        return None, None
    return adapter, settings


def active(repo=None):
    """Nickland's gateway: `(adapter, Config)`, or `(None, None)`.

    The environment first, deliberately. A secret set on the service is a
    decision made by whoever can deploy it, and it should not be silently
    overridden by whoever can sign in to the console.
    """
    adapter, settings = _from_environment()
    if adapter:
        return adapter, settings
    return _from_console(repo)


def configured(repo=None):
    return active(repo)[0] is not None


def public_config(repo=None):
    """What a browser may know: which provider, and its publishable key.

    The secret is never in this dict and must never be.
    """
    adapter, settings = active(repo)
    if not adapter:
        return {"available": False, "provider": None, "public_key": None}
    return {
        "available": True,
        "provider": adapter.id,
        "provider_name": adapter.name,
        "public_key": settings.cred("public_key") or None,
        "channels": list(adapter.channels),
        # What a school may actually pay its subscription with, by name. The
        # website prints these rather than a hard-coded list, so a deployment
        # that moves provider does not leave a page promising Verve to schools
        # whose gateway has never heard of it.
        "card_brands": list(adapter.card_brands),
        "renewal_channels": [c for c in adapter.reusable_channels if c in adapter.channels],
        "supports_renewal": adapter.supports_stored_charge,
        "from_environment": bool(_from_environment()[0]),
    }


def _active_id(repo):
    """Which provider this actually was.

    These three places said "paystack" from when Paystack was the only one
    there could be. A Flutterwave authorisation filed under Paystack's name is
    a renewal nobody can trace when it fails, and a reconciliation against the
    wrong dashboard.
    """
    adapter = active(repo)[0]
    return adapter.id if adapter else ""


def _active_currency(repo):
    settings = active(repo)[1]
    return (settings.currency if settings else "GHS") or "GHS"


def new_reference(school_id, kind="sub"):
    """A reference that is unique, and that says what it was for when it turns
    up in a provider dashboard six months later."""
    clean = "".join(c for c in str(school_id) if c.isalnum() or c == "-")[:24]
    return f"edu-{kind}-{clean}-{secrets.token_hex(6)}"


# ── Starting a subscription ─────────────────────────────────────────────────
def start_checkout(store, repo, school_id, email, amount, kind="subscription",
                   invoice_id=None, callback_url=None, metadata=None, channels=None):
    """Ask the provider for somewhere to send the school's administrator.

    A trial charges nothing, and a zero-amount checkout is not a checkout: the
    provider is asked to authorise the card for a minimal amount instead, so
    the school has a payment method on file for when the trial ends. That is
    what §7 means by "provides valid payment details" while "amount charged =
    GHS 0" — the card is verified, not billed.

    **A setup checkout asks for a card and nothing else, on purpose.** Its whole
    job is to leave behind something chargeable at renewal, and on every
    provider here that is a card: Visa, Mastercard (and Verve on Paystack). A
    mobile-money collection is a one-off — the school would complete the trial
    thinking it had paid, and find at month end that there was never anything to
    charge. Offering it at that step is offering a dead end.

    A one-off payment — an invoice a school is settling now — is left
    unrestricted, because there the payer's own preference is the only thing
    that matters and mobile money is the commonest of them.
    """
    adapter, settings = active(repo)
    if not adapter:
        return {"ok": False, "status": 503,
                "error": "Card payments are not switched on for this deployment."}
    amount = money(amount)
    reference = new_reference(school_id, "sub" if kind == "subscription" else "card")
    # A trial charges nothing, and a zero-amount checkout is not a checkout, so
    # the card is authorised for a minimal amount instead.
    charge = amount if amount > 0 else 1.0

    wanted = list(channels) if channels else (
        list(adapter.reusable_channels) if kind == "setup" else [])
    # Never ask a provider for a channel it does not have: an unknown channel is
    # a refused checkout on Paystack and a silently ignored field elsewhere.
    wanted = [c for c in wanted if c in adapter.channels]

    started = adapter.checkout(
        settings, charge, reference,
        email=email or f"billing+{school_id}@nicklandedusoft.app",
        metadata={"school_id": school_id, "kind": kind, "invoice_id": invoice_id,
                  "description": "Edusoft subscription", **(metadata or {})},
        callback_url=callback_url or "",
        channels=wanted)
    if not started.get("ok"):
        return {"ok": False, "status": 502,
                "error": started.get("error") or "The payment provider could not be reached."}

    repo.insert("platform_payments", {
        "school_id": school_id, "invoice_id": invoice_id,
        "subscription_id": (subs.current(repo, school_id) or {}).get("id"),
        "provider": adapter.id, "provider_reference": reference,
        "amount": amount, "currency": settings.currency, "status": "pending", "kind": kind,
        "attempted_at": now_iso(), "created_at": now_iso(),
    })
    return {"ok": True, "reference": reference,
            "authorization_url": started.get("authorization_url"),
            "access_code": started.get("access_code"),
            "provider": adapter.id,
            "channels": wanted or list(adapter.channels),
            "card_brands": list(adapter.card_brands),
            "amount": amount, "verifying_card_only": amount <= 0}


def verify(reference, repo=None, token=""):
    """Ask the provider what actually happened.

    The only source of truth about money — never the webhook body, never the
    browser's callback.
    """
    adapter, settings = active(repo)
    if not adapter:
        return {"ok": False, "error": "not_configured"}
    result = adapter.verify(settings, reference, token=token)
    if not result.get("ok"):
        return {"ok": False, "error": result.get("error") or "verify_failed"}
    return {**result, "provider": adapter.id}


def charge_stored_method(store, repo, school_id, amount, invoice_id=None):
    """Bill a card the school has already authorised — what happens when a
    trial ends, and on every renewal after that (§7, §11)."""
    adapter, settings = active(repo)
    if not adapter:
        return {"ok": False, "status": 503, "error": "Card payments are not switched on."}
    if not adapter.supports_stored_charge:
        # Hubtel and ExpressPay cannot charge a saved authorisation. Said here,
        # once, rather than discovered as a failed renewal at month end.
        return {"ok": False, "status": 400,
                "error": f"{adapter.name} cannot charge a saved payment method, so a "
                         f"subscription on it has to be paid from the invoice each time."}
    method = repo.find_one("payment_methods",
                           {"school_id": school_id, "status": "active", "is_default": True})
    method = method or repo.find_one("payment_methods", {"school_id": school_id, "status": "active"})
    if not method or not method.get("provider_method_ref"):
        return {"ok": False, "status": 400,
                "error": "This school has no payment method on file."}

    reference = new_reference(school_id, "renew")
    charged = adapter.charge_stored(
        settings, method["provider_method_ref"], money(amount), reference,
        email=method.get("email") or f"billing+{school_id}@nicklandedusoft.app",
        metadata={"school_id": school_id, "invoice_id": invoice_id, "kind": "renewal"})

    repo.insert("platform_payments", {
        "school_id": school_id, "invoice_id": invoice_id,
        "subscription_id": (subs.current(repo, school_id) or {}).get("id"),
        "provider": adapter.id, "provider_reference": reference,
        "amount": money(amount), "currency": settings.currency,
        "status": "succeeded" if charged.get("ok") else "failed", "kind": "subscription",
        "gateway_status": "success" if charged.get("ok") else "failed",
        "failure_reason": "" if charged.get("ok") else str(charged.get("error") or "")[:400],
        "attempted_at": now_iso(), "settled_at": now_iso() if charged.get("ok") else None,
        "created_at": now_iso(),
    })

    if charged.get("ok"):
        settle(store, repo, school_id, reference, invoice_id=invoice_id, amount=money(amount))
        return {"ok": True, "reference": reference}

    subscription = subs.current(repo, school_id)
    if subscription:
        subs.mark_past_due(store, repo, subscription, actor="system",
                           reason=str(charged.get("error") or "The card was declined."))
    return {"ok": False, "status": 402,
            "error": str(charged.get("error") or "The card was declined."),
            "reference": reference}


# ── Settlement ──────────────────────────────────────────────────────────────
def settle(store, repo, school_id, reference, invoice_id=None, amount=None,
           method=None, customer_id=None, actor="system"):
    """Record a successful payment, once.

    Everything that can say "this payment worked" — the browser coming back,
    the webhook, an operator marking it by hand — comes through here, and the
    `provider_reference` is what makes the second and third callers no-ops.
    """
    from . import entitlements

    payment = repo.find_one("platform_payments", {"provider_reference": reference})
    if payment and payment.get("status") == "succeeded":
        return {"ok": True, "already": True, "payment": payment}

    amount = money(amount if amount is not None else (payment or {}).get("amount") or 0)
    if payment:
        payment = repo.update("platform_payments", payment["id"], {
            "status": "succeeded", "amount": amount, "settled_at": now_iso(),
            "invoice_id": invoice_id or payment.get("invoice_id"), "failure_reason": ""})
    else:
        payment = repo.insert("platform_payments", {
            "school_id": school_id, "invoice_id": invoice_id,
            "subscription_id": (subs.current(repo, school_id) or {}).get("id"),
            "provider": _active_id(repo), "provider_reference": reference,
            "amount": amount, "currency": _active_currency(repo), "status": "succeeded",
            "kind": "subscription", "attempted_at": now_iso(),
            "settled_at": now_iso(), "created_at": now_iso()})

    if method:
        remember_method(repo, school_id, method, customer_id)

    target = invoice_id or payment.get("invoice_id")
    if not target:
        # A payment with no invoice named: settle the school's oldest open one,
        # which is what a bank transfer against a statement would do.
        open_invoice = next(iter(sorted(
            [i for i in repo.find("invoices", {"school_id": school_id})
             if i["status"] in invoice_lib.OUTSTANDING],
            key=lambda i: str(i.get("issued_at") or ""))), None)
        target = open_invoice["id"] if open_invoice else None
    if target:
        invoice_lib.mark_paid(store, repo, target, amount=amount, actor=actor,
                              reference=reference)

    subscription = subs.current(repo, school_id)
    if subscription:
        subs.mark_paid(store, repo, subscription, actor=actor,
                       detail=f"Payment {reference} received.")
        if customer_id and not subscription.get("provider_customer_id"):
            repo.update("subscriptions", subscription["id"],
                        {"provider": _active_id(repo), "provider_customer_id": customer_id})

    billing_audit.write(store, "payment_succeeded", school_id=school_id, actor=actor,
                        detail=f"GHS {amount:,.2f} received ({reference}).")
    entitlements.invalidate(school_id)
    return {"ok": True, "payment": payment}


def record_failure(store, repo, school_id, reference, reason="", amount=0):
    from . import entitlements
    existing = repo.find_one("platform_payments", {"provider_reference": reference})
    if existing:
        if existing.get("status") == "succeeded":
            return {"ok": True, "already": True}
        repo.update("platform_payments", existing["id"],
                    {"status": "failed", "failure_reason": str(reason)[:400]})
    else:
        repo.insert("platform_payments", {
            "school_id": school_id, "provider": "paystack", "provider_reference": reference,
            "amount": money(amount), "currency": "GHS", "status": "failed",
            "kind": "subscription", "failure_reason": str(reason)[:400],
            "attempted_at": now_iso(), "created_at": now_iso()})
    subscription = subs.current(repo, school_id)
    if subscription:
        subs.mark_past_due(store, repo, subscription, actor="system", reason=reason)
    entitlements.invalidate(school_id)
    return {"ok": True}


def refund(store, repo, payment_id, actor="platform", reason=""):
    """Give a school its money back.

    Only Paystack among the four supports a refund over the API. For the others
    the refund is made in the provider's own dashboard and recorded here, which
    is honest about what happened rather than pretending an API call was made.
    """
    payment = repo.get("platform_payments", payment_id)
    if not payment:
        return {"ok": False, "status": 404, "error": "No such payment."}
    if payment["status"] != "succeeded":
        return {"ok": False, "status": 400, "error": "Only a successful payment can be refunded."}

    adapter, settings = active(repo)
    at_provider = False
    if adapter and adapter.id == "paystack":
        from ..gateways.base import http_json, ok as http_ok
        result = http_json(f'{settings.base("https://api.paystack.co")}/refund', "POST",
                           {"Authorization": f'Bearer {settings.cred("secret_key")}'},
                           {"transaction": payment["provider_reference"]})
        if not http_ok(result):
            return {"ok": False, "status": 502,
                    "error": (result.get("json") or {}).get("message")
                             or "The provider refused the refund."}
        at_provider = True

    updated = repo.update("platform_payments", payment_id,
                          {"status": "refunded", "refunded_at": now_iso()})
    billing_audit.write(store, "payment_refunded", school_id=payment["school_id"], actor=actor,
                        detail=f'{payment["provider_reference"]}: refunded '
                               f'{payment["currency"]} {money(payment["amount"]):,.2f}'
                               + ("." if at_provider else
                                  " — recorded here; make the refund in the provider's "
                                  "own dashboard.") + f" {reason}".rstrip())
    return {"ok": True, "payment": updated, "at_provider": at_provider}


def remember_method(repo, school_id, method, customer_id=None):
    """Keep the handle the provider gave us, and nothing more.

    A card that the provider says is not reusable is not stored at all: a
    reference that cannot be charged again would show a school a payment method
    on their billing page that silently fails at renewal.
    """
    if not method or not method.get("reference") or method.get("reusable") is False:
        return None
    existing = repo.find_one("payment_methods",
                             {"school_id": school_id,
                              "provider_method_ref": method["reference"]})
    if existing:
        return existing
    repo.update_where("payment_methods", {"school_id": school_id}, {"is_default": False})
    return repo.insert("payment_methods", {
        # The provider that actually issued this handle. It said "paystack"
        # from when Paystack was the only one there could be; a Flutterwave
        # authorisation filed under Paystack's name is a renewal nobody can
        # trace when it fails.
        "school_id": school_id, "provider": _active_id(repo),
        "provider_customer_id": customer_id or "",
        "provider_method_ref": method["reference"],
        "kind": method.get("kind") or "card",
        "brand": str(method.get("brand") or "")[:40],
        "last4": str(method.get("last4") or "")[:4],
        "exp_month": method.get("exp_month"), "exp_year": method.get("exp_year"),
        "email": str(method.get("email") or "")[:200],
        "is_default": True, "status": "active", "created_at": now_iso(),
    })


def methods_for(repo, school_id):
    return repo.find("payment_methods", {"school_id": school_id, "status": "active"},
                     order_by="id", desc=True)


def forget_method(repo, school_id, method_id):
    method = repo.get("payment_methods", method_id)
    if not method or str(method["school_id"]) != str(school_id):
        return {"ok": False, "status": 404, "error": "No such payment method."}
    repo.update("payment_methods", method_id, {"status": "removed", "is_default": False})
    return {"ok": True}


# ── The webhook ─────────────────────────────────────────────────────────────
def verify_signature(raw, signature, repo=None):
    """Whether a delivery is genuine, by the active provider's own rule."""
    adapter, settings = active(repo)
    if not adapter:
        return False
    return bool(adapter.verify_webhook(settings, raw, {"x-paystack-signature": signature,
                                                       "verif-hash": signature}))


def seen_event(repo, event_id, event=""):
    """True when this event has already been handled. Writes it down when it
    has not, so the answer is right for the redelivery that follows."""
    if not event_id:
        return False
    if repo.get("billing_webhook_events", event_id):
        return True
    try:
        repo.insert("billing_webhook_events", {
            "event_id": str(event_id)[:200], "provider": "paystack",
            "event": str(event or "")[:80], "received_at": now_iso()})
    except Exception:
        # The insert lost a race with a concurrent delivery of the same event.
        # That is exactly the case this function exists to catch.
        return True
    return False


def handle_webhook(store, repo, raw, signature):
    """One delivery from the provider, checked and then acted on.

    Returns `{"ok": True}` for anything genuine, including events this platform
    does not care about — a provider that gets a 4xx retries, and retrying an
    event nobody wanted forever is a self-inflicted outage.
    """
    from . import entitlements

    adapter, settings = active(repo)
    if not adapter:
        # 401 rather than 503. A deployment with no gateway configured should
        # not answer a stranger's POST by confirming that, and a provider that
        # gets a 5xx retries the same delivery for hours.
        return {"ok": False, "status": 401, "error": "Unauthorized"}

    headers = {"x-paystack-signature": signature, "verif-hash": signature}
    if adapter.signed_callbacks and not adapter.verify_webhook(settings, raw, headers):
        billing_audit.write(store, "billing_webhook_refused", actor="anonymous",
                            outcome="refused",
                            detail="A billing webhook arrived with a bad signature.")
        return {"ok": False, "status": 401, "error": "Unauthorized"}

    delivery = adapter.read_webhook(settings, raw, headers)
    reference = delivery.get("reference") or ""
    if seen_event(repo, delivery.get("event_id"), delivery.get("event")):
        return {"ok": True, "duplicate": True}

    school_id = str((delivery.get("metadata") or {}).get("school_id") or "")
    if not school_id and reference:
        known = repo.find_one("platform_payments", {"provider_reference": reference})
        school_id = (known or {}).get("school_id") or ""
    if not school_id:
        return {"ok": True, "ignored": "no school"}
    invoice_id = (delivery.get("metadata") or {}).get("invoice_id")

    # `succeeded` from a provider that signs, `check` from one that does not.
    # Both mean the same thing here: go and ask the provider.
    if delivery.get("status") in ("succeeded", "check") and reference:
        verified = verify(reference, repo, token=delivery.get("token", ""))
        if not verified.get("ok") or not verified.get("paid"):
            return {"ok": True, "ignored": "not confirmed by the provider"}
        settle(store, repo, school_id, reference, invoice_id=invoice_id,
               amount=verified["amount"], method=verified.get("method"),
               customer_id=verified.get("customer_id"), actor="webhook")
        return {"ok": True, "settled": reference}

    if delivery.get("status") == "failed" and reference:
        record_failure(store, repo, school_id, reference,
                       reason=delivery.get("reason") or "The payment failed.")
        return {"ok": True, "failed": reference}

    if delivery.get("status") == "refunded" and reference:
        payment = repo.find_one("platform_payments", {"provider_reference": reference})
        if payment and payment["status"] == "succeeded":
            repo.update("platform_payments", payment["id"],
                        {"status": "refunded", "refunded_at": now_iso()})
        return {"ok": True, "refunded": reference}

    entitlements.invalidate(school_id)
    return {"ok": True, "ignored": delivery.get("event") or "unknown"}
