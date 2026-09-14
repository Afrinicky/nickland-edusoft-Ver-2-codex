"""Flutterwave (v3).

Written against Flutterwave's published v3 contract. It has NOT been exercised
against a live Flutterwave account from inside this repository — see
`verified = False`, which is what the setup screen says out loud, and why the
Test button has to pass before a school can switch it on.

Two things about Flutterwave that are unlike Paystack and worth knowing before
reading the code:

  * **Its webhook is not an HMAC.** Flutterwave sends a `verif-hash` header
    whose value is a secret string the merchant typed into their own dashboard,
    and the merchant compares it. That is a shared secret, not a signature over
    the body, so it proves the sender and says nothing about the payload —
    which is fine here, because settlement re-asks Flutterwave for the amount
    regardless. The field is `secret_hash`, and it must match the dashboard.
  * **Its reference is `tx_ref`**, ours, and the provider also mints an `id` of
    its own. We verify by ours, so a delivery that arrives before we have seen
    the provider's id is still answerable.
"""
import hmac

from .base import Field, Gateway, http_json, ok

DEFAULT_BASE = "https://api.flutterwave.com/v3"


class Flutterwave(Gateway):
    id = "flutterwave"
    name = "Flutterwave"
    tagline = "Cards, mobile money and bank transfer across Africa."
    country = "Ghana · Nigeria · Kenya · and more"
    docs_url = "https://developer.flutterwave.com/docs/collecting-payments/standard/"
    channels = ("card", "mobile_money", "bank")
    card_brands = ("visa", "mastercard")
    currencies = ("GHS", "NGN", "KES", "UGX", "TZS", "ZAR", "USD")
    supports_stored_charge = True
    signed_callbacks = True          # a shared secret rather than an HMAC; see above

    fields = (
        Field("secret_key", "Secret key", kind="password", secret=True,
              placeholder="FLWSECK-…",
              hint="Flutterwave dashboard → Settings → API. The live key starts FLWSECK-."),
        Field("public_key", "Public key", required=False, placeholder="FLWPUBK-…",
              hint="Safe to show in a browser."),
        Field("secret_hash", "Webhook secret hash", kind="password", secret=True, required=False,
              hint="Settings → Webhooks → 'Secret hash'. Type the SAME text here and there, "
                   "or Flutterwave's notifications will be refused."),
        Field("base_url", "API address", kind="url", required=False, default=DEFAULT_BASE,
              hint="Leave blank unless Flutterwave has told you otherwise."),
    )

    def _headers(self, cfg):
        return {"Authorization": f'Bearer {cfg.cred("secret_key")}'}

    # Flutterwave spells them differently from everyone else, and the spelling
    # is not optional — an unrecognised option is ignored rather than refused,
    # which would silently give back the unrestricted checkout this is trying
    # to avoid.
    PAYMENT_OPTIONS = {"card": "card", "mobile_money": "mobilemoneyghana",
                       "bank": "banktransfer"}

    def checkout(self, cfg, amount, reference, email="", metadata=None, callback_url="",
                 channels=()):
        body = {
            "tx_ref": reference,
            "amount": str(round(float(amount or 0), 2)),
            "currency": cfg.currency,
            "redirect_url": callback_url or cfg.callback_url or "",
            "customer": {"email": email or "payments@nicklandedusoft.app"},
            "customizations": {"title": "School fees"},
            "meta": metadata or {},
        }
        wanted = [self.PAYMENT_OPTIONS[c] for c in channels if c in self.PAYMENT_OPTIONS]
        if wanted:
            body["payment_options"] = ",".join(wanted)
        response = http_json(f"{cfg.base(DEFAULT_BASE)}/payments", "POST",
                             self._headers(cfg), body)
        payload = response.get("json") or {}
        link = (payload.get("data") or {}).get("link")
        if ok(response) and payload.get("status") == "success" and link:
            return {"ok": True, "authorization_url": link, "reference": reference}
        return {"ok": False,
                "error": self._fail(response, "Flutterwave would not start the payment")}

    def verify(self, cfg, reference, token=""):
        """By OUR reference, not Flutterwave's id.

        `verify_by_reference` exists for exactly this: the merchant knows what
        it called the transaction, and does not have to have stored whatever
        the provider called it before it can ask about it.
        """
        response = http_json(
            f"{cfg.base(DEFAULT_BASE)}/transactions/verify_by_reference"
            f"?tx_ref={reference}", "GET", self._headers(cfg))
        payload = response.get("json") or {}
        data = payload.get("data") or {}
        if not (ok(response) and data):
            return {"ok": False, "error": self._fail(response, "Flutterwave could not be asked")}
        card = data.get("card") or {}
        customer = data.get("customer") or {}
        return {
            "ok": True,
            "paid": str(data.get("status") or "").lower() == "successful",
            "amount": round(float(data.get("amount") or 0), 2),
            "currency": data.get("currency") or cfg.currency,
            "gateway_status": str(data.get("status") or ""),
            "reason": str(data.get("processor_response") or ""),
            "customer_id": str(customer.get("id") or ""),
            "email": customer.get("email") or "",
            "method": {
                "reference": card.get("token") or "",
                "brand": card.get("type") or "",
                "last4": card.get("last_4digits") or "",
                "exp_month": _int((card.get("expiry") or "/").split("/")[0]),
                "exp_year": _int((card.get("expiry") or "/").split("/")[-1]),
                "kind": "card" if card.get("token") else "mobile_money",
                "reusable": bool(card.get("token")),
            },
            "metadata": data.get("meta") or {},
        }

    def verify_webhook(self, cfg, raw, headers):
        expected = cfg.cred("secret_hash")
        presented = (headers or {}).get("verif-hash") or ""
        if not expected:
            # No hash configured means every delivery is anonymous, and an
            # anonymous delivery is not evidence of anything. Refused rather
            # than waved through — settlement has other ways to find out.
            return False
        return hmac.compare_digest(str(expected), str(presented))

    def read_webhook(self, cfg, raw, headers):
        import json
        try:
            body = json.loads(raw) if raw else {}
        except ValueError:
            return {"event": "", "reference": "", "event_id": "", "status": ""}
        data = body.get("data") or body
        event = str(body.get("event") or body.get("event.type") or "")
        reference = str(data.get("tx_ref") or data.get("txRef") or "")
        state = str(data.get("status") or "").lower()
        return {
            "event": event,
            "reference": reference,
            "event_id": f'{data.get("id") or ""}:{event}:{reference}',
            "status": "succeeded" if state == "successful"
                      else "failed" if state in ("failed", "cancelled") else "",
            "reason": str(data.get("processor_response") or ""),
            "metadata": data.get("meta") or {},
        }

    def charge_stored(self, cfg, authorization, amount, reference, email="", metadata=None):
        response = http_json(f"{cfg.base(DEFAULT_BASE)}/tokenized-charges", "POST",
                             self._headers(cfg), {
                                 "token": authorization,
                                 "currency": cfg.currency,
                                 "amount": round(float(amount or 0), 2),
                                 "email": email or "payments@nicklandedusoft.app",
                                 "tx_ref": reference,
                                 "meta": metadata or {},
                             })
        payload = response.get("json") or {}
        data = payload.get("data") or {}
        if ok(response) and str(data.get("status") or "").lower() == "successful":
            return {"ok": True, "reference": reference,
                    "amount": round(float(data.get("amount") or 0), 2)}
        return {"ok": False, "reference": reference,
                "error": str(data.get("processor_response") or "")
                         or self._fail(response, "The card was declined")}

    def ping(self, cfg):
        response = http_json(f"{cfg.base(DEFAULT_BASE)}/transactions?page=1", "GET",
                             self._headers(cfg))
        if ok(response):
            return {"ok": True, "detail": "Flutterwave accepted the key."}
        return {"ok": False, "error": self._fail(response, "Flutterwave refused the key")}


def _int(value):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


gateway = Flutterwave()
