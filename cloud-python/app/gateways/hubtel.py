"""Hubtel.

Written against Hubtel's published Online Checkout contract. NOT exercised
against a live Hubtel account from inside this repository — `verified = False`,
and the Test button has to pass before a school can switch it on.

The thing that makes Hubtel different from the card gateways, and the reason
the design of this platform copes with it without a special case:

**Hubtel does not sign its callbacks.** It POSTs to the URL you gave it and
that is all. So `verify_webhook` returns False — always — and the callback is
treated as what it actually is: a nudge saying "go and look". The looking is
`verify()`, against the transaction-status API, over the school's own
authenticated connection. Since settlement in this platform has never believed
a webhook about an amount, nothing is weaker here than it is for Paystack. The
only difference is that a Hubtel callback cannot by itself settle anything, and
the code says so rather than pretending.

The credentials are the API ID and API key from Hubtel's dashboard, sent as
HTTP Basic auth, plus the merchant account number the money lands in.
"""
import base64

from .base import Field, Gateway, http_json, ok

CHECKOUT_BASE = "https://payproxyapi.hubtel.com"
STATUS_BASE = "https://api-txnstatus.hubtel.com"


class Hubtel(Gateway):
    id = "hubtel"
    name = "Hubtel"
    tagline = "Mobile money and cards. Widely used by Ghanaian businesses."
    country = "Ghana"
    docs_url = "https://developers.hubtel.com/"
    channels = ("mobile_money", "card")
    card_brands = ("visa", "mastercard")
    currencies = ("GHS",)
    supports_stored_charge = False
    signed_callbacks = False

    fields = (
        Field("client_id", "API ID", kind="password", secret=True,
              hint="Hubtel dashboard → API Keys. Sometimes shown as 'Client ID' "
                   "or 'Username'."),
        Field("client_secret", "API key", kind="password", secret=True,
              hint="The other half of the pair. Sometimes shown as 'Client Secret'."),
        Field("merchant_account", "Merchant account number",
              placeholder="2019204",
              hint="The Hubtel account the money is paid into. Digits only."),
        Field("base_url", "Checkout address", kind="url", required=False,
              default=CHECKOUT_BASE,
              hint="Leave blank unless Hubtel has told you otherwise."),
        Field("status_url", "Status address", kind="url", required=False,
              default=STATUS_BASE,
              hint="Leave blank unless Hubtel has told you otherwise."),
    )

    def _headers(self, cfg):
        pair = f'{cfg.cred("client_id")}:{cfg.cred("client_secret")}'
        token = base64.b64encode(pair.encode()).decode()
        return {"Authorization": f"Basic {token}"}

    def checkout(self, cfg, amount, reference, email="", metadata=None, callback_url="",
                 channels=()):
        # Hubtel's checkout has no channel restriction to pass; the payer picks
        # on Hubtel's own page. `channels` is accepted and ignored rather than
        # rejected, because the caller cannot be expected to know which
        # providers take the hint — and the thing that actually depends on it,
        # a subscription needing a chargeable card, is refused earlier by
        # `supports_stored_charge` being False.
        target = callback_url or cfg.callback_url or ""
        body = {
            "totalAmount": round(float(amount or 0), 2),
            "description": (metadata or {}).get("description") or "School fees",
            "callbackUrl": target,
            "returnUrl": target,
            "cancellationUrl": target,
            "merchantAccountNumber": cfg.cred("merchant_account"),
            "clientReference": reference,
        }
        response = http_json(f"{cfg.base(CHECKOUT_BASE)}/items/initiate", "POST",
                             self._headers(cfg), body)
        data = (response.get("json") or {}).get("data") or {}
        url = data.get("checkoutDirectUrl") or data.get("checkoutUrl")
        if ok(response) and url:
            return {"ok": True, "authorization_url": url,
                    "reference": data.get("clientReference") or reference,
                    "access_code": data.get("checkoutId")}
        return {"ok": False, "error": self._fail(response, "Hubtel would not start the payment")}

    def verify(self, cfg, reference, token=""):
        """Hubtel's transaction-status API, asked by OUR client reference.

        This is the whole of what settles a Hubtel payment — there is no signed
        message to trust instead, so there is nothing else it could be.
        """
        account = cfg.cred("merchant_account")
        status_base = cfg.cred("status_url", STATUS_BASE).rstrip("/")
        response = http_json(
            f"{status_base}/transactions/{account}/status?clientReference={reference}",
            "GET", self._headers(cfg))
        payload = response.get("json") or {}
        data = payload.get("data")
        if isinstance(data, list):
            data = data[0] if data else {}
        data = data or {}
        if not ok(response):
            return {"ok": False, "error": self._fail(response, "Hubtel could not be asked")}
        state = str(data.get("status") or "").lower()
        return {
            "ok": True,
            "paid": state in ("paid", "success", "successful"),
            "amount": round(float(data.get("amount") or 0), 2),
            "currency": "GHS",
            "gateway_status": str(data.get("status") or ""),
            "reason": str(data.get("message") or payload.get("message") or ""),
            "customer_id": str(data.get("customerMsisdn") or ""),
            "email": "",
            # Hubtel's checkout does not hand back anything chargeable later,
            # so there is no payment method to remember. Saying so plainly is
            # better than storing an empty one that fails at the first renewal.
            "method": {"reference": "", "kind": "mobile_money", "reusable": False},
            "metadata": {},
        }

    def verify_webhook(self, cfg, raw, headers):
        """False, always, and deliberately.

        Hubtel does not sign callbacks. Returning True for an unsigned POST
        would mean anybody who learns the callback URL can claim a payment
        succeeded. The callback is handled as a hint — see `read_webhook` and
        the settlement path, which re-asks Hubtel either way.
        """
        return False

    def read_webhook(self, cfg, raw, headers):
        import json
        try:
            body = json.loads(raw) if raw else {}
        except ValueError:
            return {"event": "", "reference": "", "event_id": "", "status": ""}
        data = body.get("Data") or body.get("data") or body
        reference = str(data.get("ClientReference") or data.get("clientReference") or "")
        state = str(data.get("Status") or data.get("status") or "").lower()
        return {
            "event": "hubtel.callback",
            "reference": reference,
            "event_id": f'{data.get("TransactionId") or data.get("transactionId") or ""}'
                        f":hubtel:{reference}",
            # Never "succeeded" from a callback body. The most it can say is
            # "go and check", which is what the settlement path does with it.
            "status": "check" if reference else "",
            "reason": str(data.get("Description") or ""),
            "metadata": {},
            "unsigned": True,
        }

    def ping(self, cfg):
        """Ask for the status of a reference that cannot exist.

        A wrong key answers 401; a right key answers "no such transaction",
        which is a 404 or an empty data set — and that is a pass. Checking
        credentials by attempting a real payment would be worse in every way.
        """
        account = cfg.cred("merchant_account")
        if not account.isdigit():
            return {"ok": False, "error": "The merchant account number should be digits only."}
        status_base = cfg.cred("status_url", STATUS_BASE).rstrip("/")
        response = http_json(
            f"{status_base}/transactions/{account}/status"
            f"?clientReference=edusoft-connection-test", "GET", self._headers(cfg))
        status = int(response.get("status") or 0)
        if status in (401, 403):
            return {"ok": False, "error": "Hubtel refused the API ID and key."}
        if status == 0:
            return {"ok": False, "error": "Hubtel could not be reached."}
        # 200 with nothing, or 404 — both mean the credentials were accepted and
        # the transaction simply is not there, which is the expected answer.
        if status in (200, 404):
            return {"ok": True, "detail": "Hubtel accepted the credentials."}
        return {"ok": False, "error": self._fail(response, "Hubtel refused the credentials")}


gateway = Hubtel()
