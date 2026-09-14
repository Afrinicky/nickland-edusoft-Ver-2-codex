"""Paystack.

The provider this platform already used, and the one whose wire details are
proven here rather than taken from a document: this adapter is a port of
`electron/server/gateways/paystack.js` and the Paystack half of
`app/school/payments.py`, both of which have been taking real money.

Cards, mobile money and bank in Ghana and Nigeria; signed webhooks; and — the
part that matters for subscriptions — it can charge an authorisation the payer
gave earlier, which is what makes a renewal possible without asking the school
for its card every month.
"""
import hashlib
import hmac

from .base import Field, Gateway, http_json, major, minor, ok

DEFAULT_BASE = "https://api.paystack.co"


class Paystack(Gateway):
    id = "paystack"
    name = "Paystack"
    tagline = "Cards, mobile money and bank. Ghana and Nigeria."
    country = "Ghana · Nigeria"
    docs_url = "https://paystack.com/docs/payments/accept-payments/"
    channels = ("card", "mobile_money", "bank")
    card_brands = ("visa", "mastercard", "verve")
    currencies = ("GHS", "NGN", "ZAR", "KES", "USD")
    supports_stored_charge = True
    signed_callbacks = True
    verified = True

    fields = (
        Field("secret_key", "Secret key", kind="password", secret=True,
              placeholder="sk_live_…",
              hint="Paystack dashboard → Settings → API Keys & Webhooks. "
                   "Starts sk_live_ for real money, sk_test_ while you are trying it."),
        Field("public_key", "Public key", required=False,
              placeholder="pk_live_…",
              hint="Safe to show in a browser. Used to open the payment window in the app."),
        Field("base_url", "API address", kind="url", required=False,
              default=DEFAULT_BASE,
              hint="Leave blank unless Paystack has told you otherwise."),
    )

    def _headers(self, cfg):
        return {"Authorization": f'Bearer {cfg.cred("secret_key")}'}

    def checkout(self, cfg, amount, reference, email="", metadata=None, callback_url="",
                 channels=()):
        body = {
            "amount": minor(amount),
            "email": email or "payments@nicklandedusoft.app",
            "reference": reference,
            "currency": cfg.currency,
            "metadata": metadata or {},
        }
        # Paystack shows every channel the merchant account has enabled unless
        # it is told otherwise. Told otherwise, it shows only these — which is
        # how a subscription setup asks for a card and gets a card, rather than
        # a mobile-money collection that cannot be charged again next month.
        if channels:
            body["channels"] = list(channels)
        target = callback_url or cfg.callback_url
        if target:
            body["callback_url"] = target
        response = http_json(f"{cfg.base(DEFAULT_BASE)}/transaction/initialize", "POST",
                             self._headers(cfg), body)
        payload = (response.get("json") or {})
        data = payload.get("data") or {}
        if ok(response) and payload.get("status") and data.get("authorization_url"):
            return {"ok": True, "authorization_url": data["authorization_url"],
                    "reference": data.get("reference") or reference,
                    "access_code": data.get("access_code")}
        return {"ok": False, "error": self._fail(response, "Paystack would not start the payment")}

    def verify(self, cfg, reference, token=""):
        response = http_json(
            f"{cfg.base(DEFAULT_BASE)}/transaction/verify/{reference}", "GET", self._headers(cfg))
        data = (response.get("json") or {}).get("data") or {}
        if not (ok(response) and data):
            return {"ok": False, "error": self._fail(response, "Paystack could not be asked")}
        authorization = data.get("authorization") or {}
        customer = data.get("customer") or {}
        return {
            "ok": True,
            "paid": data.get("status") == "success",
            "amount": major(data.get("amount")),
            "currency": data.get("currency") or cfg.currency,
            "gateway_status": data.get("status") or "",
            "reason": data.get("gateway_response") or "",
            "customer_id": str(customer.get("customer_code") or customer.get("id") or ""),
            "email": customer.get("email") or "",
            "method": {
                "reference": authorization.get("authorization_code") or "",
                "brand": authorization.get("brand") or authorization.get("card_type") or "",
                "last4": authorization.get("last4") or "",
                "exp_month": _int(authorization.get("exp_month")),
                "exp_year": _int(authorization.get("exp_year")),
                "kind": "mobile_money" if authorization.get("channel") == "mobile_money" else "card",
                "reusable": bool(authorization.get("reusable")),
            },
            "metadata": data.get("metadata") or {},
        }

    def verify_webhook(self, cfg, raw, headers):
        """HMAC-SHA512 over the RAW bytes. Not over a re-serialised body —
        a dictionary that has been through a JSON parser and back is a
        different sequence of bytes and will not match."""
        secret = cfg.cred("secret_key")
        signature = (headers or {}).get("x-paystack-signature") or ""
        if not secret or not signature:
            return False
        payload = raw.encode() if isinstance(raw, str) else (raw or b"")
        expected = hmac.new(secret.encode(), payload, hashlib.sha512).hexdigest()
        return hmac.compare_digest(expected, str(signature))

    def read_webhook(self, cfg, raw, headers):
        import json
        try:
            body = json.loads(raw) if raw else {}
        except ValueError:
            return {"event": "", "reference": "", "event_id": "", "status": ""}
        data = body.get("data") or {}
        event = str(body.get("event") or "")
        reference = str(data.get("reference") or "")
        return {
            "event": event,
            "reference": reference,
            # Paystack reuses its own event ids across deliveries of the same
            # event, which is exactly what an idempotency key should do.
            "event_id": f'{data.get("id") or ""}:{event}:{reference}',
            "status": "succeeded" if event == "charge.success"
                      else "failed" if event in ("charge.failed", "invoice.payment_failed")
                      else "refunded" if event == "refund.processed" else "",
            "reason": str(data.get("gateway_response") or ""),
            "metadata": data.get("metadata") or {},
        }

    def charge_stored(self, cfg, authorization, amount, reference, email="", metadata=None):
        response = http_json(
            f"{cfg.base(DEFAULT_BASE)}/transaction/charge_authorization", "POST",
            self._headers(cfg), {
                "authorization_code": authorization,
                "email": email or "payments@nicklandedusoft.app",
                "amount": minor(amount),
                "reference": reference,
                "currency": cfg.currency,
                "metadata": metadata or {},
            })
        data = (response.get("json") or {}).get("data") or {}
        if ok(response) and data.get("status") == "success":
            return {"ok": True, "reference": data.get("reference") or reference,
                    "amount": major(data.get("amount"))}
        return {"ok": False, "reference": reference,
                "error": str(data.get("gateway_response") or "")
                         or self._fail(response, "The card was declined")}

    def ping(self, cfg):
        """A read that costs nothing and needs a real key.

        The transaction list, one row. It touches no money, works on a brand
        new account with no transactions in it, and a wrong key fails it.
        """
        response = http_json(f"{cfg.base(DEFAULT_BASE)}/transaction?perPage=1", "GET",
                             self._headers(cfg))
        if ok(response) and (response.get("json") or {}).get("status") is not False:
            return {"ok": True, "detail": "Paystack accepted the key."}
        return {"ok": False, "error": self._fail(response, "Paystack refused the key")}


def _int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


gateway = Paystack()
