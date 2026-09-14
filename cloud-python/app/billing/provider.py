"""Taking the platform's own money.

Careful distinction, because this service now has two completely separate
payment paths and confusing them would be expensive:

  * ``app/payments.py`` is a SCHOOL taking fees from a PARENT, with the
    school's own gateway key, which the school supplies.
  * this module is NICKLAND taking a subscription from a SCHOOL, with
    Nickland's gateway key, which comes from the environment.

They never share a key, a reference, a webhook or a table.

What is stored here: a customer id, a payment-method reference, a transaction
reference. Never a card number, never a CVV, never anything that could be
replayed as an instrument — the provider holds the card and Edusoft holds the
handle (§21).

Three properties the webhook path has to have, and does:

  * **Verified.** The signature is checked over the RAW bytes against
    Nickland's secret before a single field of the body is believed.
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
import hashlib
import hmac
import json
import os
import secrets
import urllib.error
import urllib.request

from . import audit as billing_audit
from . import invoices as invoice_lib
from . import subscriptions as subs
from .repo import money, now_iso

ENV_SECRET = "PLATFORM_PAYSTACK_SECRET"
ENV_PUBLIC = "PLATFORM_PAYSTACK_PUBLIC"
ENV_BASE = "PLATFORM_PAYSTACK_BASE_URL"
DEFAULT_BASE = "https://api.paystack.co"


def configured():
    return bool(os.environ.get(ENV_SECRET, "").strip())


def public_config():
    """What a browser may know: the public key, and whether there is a gateway
    at all. The secret is never in this dict and must never be."""
    return {
        "available": configured(),
        "provider": "paystack" if configured() else None,
        "public_key": os.environ.get(ENV_PUBLIC, "").strip() or None,
    }


def _secret():
    return os.environ.get(ENV_SECRET, "").strip()


def _base():
    return (os.environ.get(ENV_BASE) or DEFAULT_BASE).rstrip("/")


def _http_json(url, method="GET", body=None, timeout=20):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("Content-Type", "application/json")
    request.add_header("Authorization", f"Bearer {_secret()}")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return {"status": response.status, "json": json.loads(response.read().decode() or "{}")}
    except urllib.error.HTTPError as err:
        try:
            return {"status": err.code, "json": json.loads(err.read().decode() or "{}")}
        except Exception:
            return {"status": err.code, "json": None}
    except Exception as err:
        return {"status": 0, "error": str(err)}


def new_reference(school_id, kind="sub"):
    """A reference that is unique, and that says what it was for when it turns
    up in a provider dashboard six months later."""
    clean = "".join(c for c in str(school_id) if c.isalnum() or c == "-")[:24]
    return f"edu-{kind}-{clean}-{secrets.token_hex(6)}"


# ── Starting a subscription ─────────────────────────────────────────────────
def start_checkout(store, repo, school_id, email, amount, kind="subscription",
                   invoice_id=None, callback_url=None, metadata=None):
    """Ask the provider for somewhere to send the school's administrator.

    A trial charges nothing, and a zero-amount checkout is not a checkout: the
    provider is asked to authorise the card for a minimal amount instead, so
    the school has a payment method on file for when the trial ends. That is
    what §7 means by "provides valid payment details" while "amount charged =
    GHS 0" — the card is verified, not billed.
    """
    if not configured():
        return {"ok": False, "status": 503,
                "error": "Card payments are not switched on for this deployment."}
    amount = money(amount)
    reference = new_reference(school_id, "sub" if kind == "subscription" else "card")
    charge = amount if amount > 0 else 1.0        # a card check, refunded by the provider's void

    body = {
        "amount": int(round(charge * 100)),
        "email": email or f"billing+{school_id}@nicklandedusoft.app",
        "reference": reference,
        "currency": "GHS",
        "channels": ["card", "mobile_money", "bank"],
        "metadata": {"school_id": school_id, "kind": kind,
                     "invoice_id": invoice_id, **(metadata or {})},
    }
    if callback_url:
        body["callback_url"] = callback_url

    result = _http_json(f"{_base()}/transaction/initialize", "POST", body)
    payload = result.get("json") or {}
    if not (200 <= result.get("status", 0) < 300 and payload.get("status") and payload.get("data")):
        return {"ok": False, "status": 502,
                "error": payload.get("message") or result.get("error")
                         or "The payment provider could not be reached."}

    repo.insert("platform_payments", {
        "school_id": school_id, "invoice_id": invoice_id,
        "subscription_id": (subs.current(repo, school_id) or {}).get("id"),
        "provider": "paystack", "provider_reference": reference,
        "amount": amount, "currency": "GHS", "status": "pending", "kind": kind,
        "attempted_at": now_iso(), "created_at": now_iso(),
    })
    return {"ok": True, "reference": reference,
            "authorization_url": payload["data"].get("authorization_url"),
            "access_code": payload["data"].get("access_code"),
            "amount": amount, "verifying_card_only": amount <= 0}


def verify(reference):
    """Ask the provider what actually happened. The only source of truth about
    money — never the webhook body, never the browser's callback."""
    if not configured():
        return {"ok": False, "error": "not_configured"}
    result = _http_json(f"{_base()}/transaction/verify/{reference}")
    payload = (result.get("json") or {}).get("data") or {}
    if not (200 <= result.get("status", 0) < 300 and payload):
        return {"ok": False, "error": (result.get("json") or {}).get("message")
                                      or result.get("error") or "verify_failed"}
    authorization = payload.get("authorization") or {}
    customer = payload.get("customer") or {}
    return {
        "ok": True,
        "paid": payload.get("status") == "success",
        "amount": money((payload.get("amount") or 0) / 100.0),
        "currency": payload.get("currency") or "GHS",
        "gateway_status": payload.get("status") or "",
        "customer_id": str(customer.get("customer_code") or customer.get("id") or ""),
        "email": customer.get("email") or "",
        "method": {
            "reference": authorization.get("authorization_code") or "",
            "brand": authorization.get("brand") or authorization.get("card_type") or "",
            "last4": authorization.get("last4") or "",
            "exp_month": _as_int(authorization.get("exp_month")),
            "exp_year": _as_int(authorization.get("exp_year")),
            "kind": "mobile_money" if authorization.get("channel") == "mobile_money" else "card",
            "reusable": bool(authorization.get("reusable")),
        },
        "metadata": payload.get("metadata") or {},
    }


def _as_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def charge_stored_method(store, repo, school_id, amount, invoice_id=None):
    """Bill a card the school has already authorised — what happens when a
    trial ends, and on every renewal after that (§7, §11)."""
    if not configured():
        return {"ok": False, "status": 503, "error": "Card payments are not switched on."}
    method = repo.find_one("payment_methods",
                           {"school_id": school_id, "status": "active", "is_default": True})
    method = method or repo.find_one("payment_methods", {"school_id": school_id, "status": "active"})
    if not method or not method.get("provider_method_ref"):
        return {"ok": False, "status": 400,
                "error": "This school has no payment method on file."}

    reference = new_reference(school_id, "renew")
    result = _http_json(f"{_base()}/transaction/charge_authorization", "POST", {
        "authorization_code": method["provider_method_ref"],
        "email": method.get("email") or f"billing+{school_id}@nicklandedusoft.app",
        "amount": int(round(money(amount) * 100)),
        "reference": reference,
        "currency": "GHS",
        "metadata": {"school_id": school_id, "invoice_id": invoice_id, "kind": "renewal"},
    })
    payload = (result.get("json") or {}).get("data") or {}
    succeeded = 200 <= result.get("status", 0) < 300 and payload.get("status") == "success"

    repo.insert("platform_payments", {
        "school_id": school_id, "invoice_id": invoice_id,
        "subscription_id": (subs.current(repo, school_id) or {}).get("id"),
        "provider": "paystack", "provider_reference": reference,
        "amount": money(amount), "currency": "GHS",
        "status": "succeeded" if succeeded else "failed", "kind": "subscription",
        "gateway_status": str(payload.get("status") or ""),
        "failure_reason": "" if succeeded else str(
            payload.get("gateway_response") or (result.get("json") or {}).get("message")
            or result.get("error") or "The card was declined."),
        "attempted_at": now_iso(), "settled_at": now_iso() if succeeded else None,
        "created_at": now_iso(),
    })

    if succeeded:
        settle(store, repo, school_id, reference, invoice_id=invoice_id, amount=money(amount))
        return {"ok": True, "reference": reference}

    subscription = subs.current(repo, school_id)
    if subscription:
        subs.mark_past_due(store, repo, subscription, actor="system",
                           reason="The card on file was declined.")
    return {"ok": False, "status": 402, "error": "The card on file was declined.",
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
            "provider": "paystack", "provider_reference": reference,
            "amount": amount, "currency": "GHS", "status": "succeeded",
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
                        {"provider": "paystack", "provider_customer_id": customer_id})

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
    payment = repo.get("platform_payments", payment_id)
    if not payment:
        return {"ok": False, "status": 404, "error": "No such payment."}
    if payment["status"] != "succeeded":
        return {"ok": False, "status": 400, "error": "Only a successful payment can be refunded."}
    if configured():
        result = _http_json(f"{_base()}/refund", "POST",
                            {"transaction": payment["provider_reference"]})
        if not 200 <= result.get("status", 0) < 300:
            return {"ok": False, "status": 502,
                    "error": (result.get("json") or {}).get("message")
                             or "The provider refused the refund."}
    updated = repo.update("platform_payments", payment_id,
                          {"status": "refunded", "refunded_at": now_iso()})
    billing_audit.write(store, "payment_refunded", school_id=payment["school_id"], actor=actor,
                        detail=f'{payment["provider_reference"]}: refunded '
                               f'{payment["currency"]} {money(payment["amount"]):,.2f}. {reason}'.strip())
    return {"ok": True, "payment": updated}


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
        "school_id": school_id, "provider": "paystack",
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
def verify_signature(raw, signature):
    """HMAC-SHA512 over the raw bytes, as Paystack sends it."""
    secret = _secret()
    if not secret or not signature:
        return False
    expected = hmac.new(secret.encode(), raw.encode() if isinstance(raw, str) else raw,
                        hashlib.sha512).hexdigest()
    return hmac.compare_digest(expected, str(signature))


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
    if not verify_signature(raw, signature):
        billing_audit.write(store, "billing_webhook_refused", actor="anonymous",
                            outcome="refused",
                            detail="A billing webhook arrived with a bad signature.")
        return {"ok": False, "status": 401, "error": "Unauthorized"}
    try:
        body = json.loads(raw) if raw else {}
    except ValueError:
        return {"ok": True, "ignored": "unreadable"}

    event = str(body.get("event") or "")
    data = body.get("data") or {}
    reference = str(data.get("reference") or "")
    event_id = str(data.get("id") or "") + ":" + event + ":" + reference
    if seen_event(repo, event_id, event):
        return {"ok": True, "duplicate": True}

    school_id = str((data.get("metadata") or {}).get("school_id") or "")
    if not school_id and reference:
        known = repo.find_one("platform_payments", {"provider_reference": reference})
        school_id = (known or {}).get("school_id") or ""
    if not school_id:
        return {"ok": True, "ignored": "no school"}

    invoice_id = (data.get("metadata") or {}).get("invoice_id")

    if event == "charge.success" and reference:
        # The body is not believed about money. Ask the provider.
        verified = verify(reference)
        if not verified.get("ok") or not verified.get("paid"):
            return {"ok": True, "ignored": "not confirmed by the provider"}
        settle(store, repo, school_id, reference, invoice_id=invoice_id,
               amount=verified["amount"], method=verified.get("method"),
               customer_id=verified.get("customer_id"), actor="webhook")
        return {"ok": True, "settled": reference}

    if event in ("charge.failed", "invoice.payment_failed") and reference:
        record_failure(store, repo, school_id, reference,
                       reason=str(data.get("gateway_response") or "The payment failed."))
        return {"ok": True, "failed": reference}

    if event == "refund.processed" and reference:
        payment = repo.find_one("platform_payments", {"provider_reference": reference})
        if payment and payment["status"] == "succeeded":
            repo.update("platform_payments", payment["id"],
                        {"status": "refunded", "refunded_at": now_iso()})
        return {"ok": True, "refunded": reference}

    return {"ok": True, "ignored": event or "unknown"}
