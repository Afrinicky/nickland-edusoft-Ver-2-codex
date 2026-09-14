"""ExpressPay.

Written against ExpressPay's published contract. NOT exercised against a live
ExpressPay account from inside this repository — `verified = False`, and the
Test button has to pass before a school can switch it on.

ExpressPay is the oldest-fashioned of the four and the code shows it, for
reasons that are the provider's and not ours:

  * Requests are **form-encoded**, not JSON, and the field names carry hyphens
    (`merchant-id`, `api-key`). The answers are JSON.
  * Checkout is **two steps**: `submit.php` returns a token, and the payer is
    then sent to `checkout.php?token=…`. So the "authorization URL" this
    adapter hands back is one we build, not one the provider returns.
  * There are **no signed callbacks**. ExpressPay posts the token back and the
    merchant queries `query.php`. `verify_webhook` therefore returns False,
    always, and settlement asks — exactly as it does for Hubtel, and for the
    same reason.
  * Its success flag is `result: 1` with `result-text: "Approved"`. A `result`
    of 2 is declined, 3 is pending, 4 is a bad request — and pending is not
    failure, which is why this adapter reports `paid: False` without an error.
"""
import re

from .base import Field, Gateway, http_form, ok

LIVE_BASE = "https://expresspaygh.com/api"
SANDBOX_BASE = "https://sandbox.expresspaygh.com/api"


class ExpressPay(Gateway):
    id = "expresspay"
    name = "ExpressPay"
    tagline = "Cards and mobile money. Common with Ghanaian schools."
    country = "Ghana"
    docs_url = "https://expresspaygh.com/developers"
    channels = ("card", "mobile_money")
    currencies = ("GHS",)
    supports_stored_charge = False
    signed_callbacks = False

    fields = (
        Field("merchant_id", "Merchant ID",
              hint="From your ExpressPay account manager."),
        Field("api_key", "API key", kind="password", secret=True,
              hint="Issued with the merchant ID. Keep it off email."),
        Field("base_url", "Environment", kind="select", required=False, default=LIVE_BASE,
              options=[{"value": LIVE_BASE, "label": "Live — real money"},
                       {"value": SANDBOX_BASE, "label": "Sandbox — for testing"}],
              hint="Start in the sandbox, move to live when a test payment has worked."),
    )

    def _credentials(self, cfg):
        return {"merchant-id": cfg.cred("merchant_id"), "api-key": cfg.cred("api_key")}

    def checkout(self, cfg, amount, reference, email="", metadata=None, callback_url=""):
        target = callback_url or cfg.callback_url or ""
        base = cfg.base(LIVE_BASE)
        response = http_form(f"{base}/submit.php", {
            **self._credentials(cfg),
            "currency": cfg.currency,
            "amount": f"{round(float(amount or 0), 2):.2f}",
            "order-id": reference,
            "order-desc": (metadata or {}).get("description") or "School fees",
            "redirect-url": target,
            "post-url": target,
            "email": email or "payments@nicklandedusoft.app",
        })
        payload = response.get("json") or {}
        token = payload.get("token")
        if ok(response) and str(payload.get("status")) == "1" and token:
            # The URL the payer goes to is assembled here: ExpressPay returns a
            # token and expects the merchant to build the address around it.
            return {"ok": True, "authorization_url": f"{base}/checkout.php?token={token}",
                    "reference": reference, "access_code": token}
        return {"ok": False,
                "error": str(payload.get("message") or "")
                         or self._fail(response, "ExpressPay would not start the payment")}

    def verify(self, cfg, reference, token=""):
        """ExpressPay queries by TOKEN, not by our order id.

        The token comes back from checkout and arrives again on the callback,
        so the caller keeps it beside the reference. Without one there is
        nothing to ask about, and saying that plainly beats a confusing 400
        from the provider.
        """
        if not token:
            return {"ok": False, "needs_token": True,
                    "error": "ExpressPay identifies a payment by its token, "
                             "which arrives with the payer's return."}
        response = http_form(f"{cfg.base(LIVE_BASE)}/query.php",
                             {**self._credentials(cfg), "token": token})
        payload = response.get("json") or {}
        if not ok(response):
            return {"ok": False, "error": self._fail(response, "ExpressPay could not be asked")}
        result = str(payload.get("result") or "")
        return {
            "ok": True,
            "paid": result == "1",
            # Pending is not failure. A mobile-money payer who has not yet
            # approved the prompt is in this state for a minute or two, and
            # treating it as a decline would tell a parent their money failed.
            "pending": result == "3",
            "amount": round(float(payload.get("amount") or 0), 2),
            "currency": payload.get("currency") or cfg.currency,
            "gateway_status": payload.get("result-text") or result,
            "reason": str(payload.get("result-text") or ""),
            "customer_id": str(payload.get("token") or token),
            "email": payload.get("email") or "",
            "method": {"reference": "", "kind": "card", "reusable": False},
            "metadata": {"order_id": payload.get("order-id") or ""},
        }

    def verify_webhook(self, cfg, raw, headers):
        """False, always. ExpressPay does not sign its callbacks — see the
        module docstring, and `read_webhook`, which treats one as a nudge."""
        return False

    def read_webhook(self, cfg, raw, headers):
        import json
        import urllib.parse
        body = {}
        text = raw if isinstance(raw, str) else (raw or b"").decode("utf-8", "replace")
        try:
            body = json.loads(text) if text.strip().startswith("{") else {}
        except ValueError:
            body = {}
        if not body and text:
            # ExpressPay posts form-encoded, which is not what the rest of this
            # platform's webhooks look like. Parsed here so the settlement path
            # never has to know which shape a given provider uses.
            body = {k: v[0] for k, v in urllib.parse.parse_qs(text).items()}
        token = str(body.get("token") or "")
        reference = str(body.get("order-id") or body.get("order_id") or "")
        return {
            "event": "expresspay.callback",
            "reference": reference,
            "event_id": f"{token}:expresspay:{reference}",
            "status": "check" if token else "",
            "token": token,
            "reason": str(body.get("result-text") or ""),
            "metadata": {},
            "unsigned": True,
        }

    def ping(self, cfg):
        """Query a token that cannot exist.

        Wrong credentials answer `result: 4` with an authentication message;
        right credentials answer `result: 4` with "not found"-shaped text, or a
        clean 200 with nothing. The distinction is in the words, which is not
        ideal — but it is the check ExpressPay makes possible without pushing a
        real payment through, and it still catches a wrong merchant id, a wrong
        key, a sandbox key against the live address, and an unreachable host.
        """
        response = http_form(f"{cfg.base(LIVE_BASE)}/query.php",
                             {**self._credentials(cfg), "token": "edusoft-connection-test"})
        if int(response.get("status") or 0) == 0:
            return {"ok": False, "error": "ExpressPay could not be reached."}
        payload = response.get("json") or {}
        # Punctuation normalised first. ExpressPay says "Invalid api-key" and
        # "Invalid merchant-id", and matching on "api key" with a space missed
        # both — which made a wrong key look like a passing test, the one
        # outcome this whole mechanism exists to prevent.
        words = re.sub(r"[-_]+", " ",
                       str(payload.get("result-text") or payload.get("message") or "").lower())
        if any(bad in words for bad in ("auth", "merchant", "api key", "invalid",
                                        "credential", "not authorised", "not authorized")):
            return {"ok": False, "error": payload.get("result-text")
                                          or "ExpressPay refused the merchant ID and key."}
        if ok(response):
            return {"ok": True, "detail": "ExpressPay accepted the merchant ID and key."}
        return {"ok": False, "error": self._fail(response, "ExpressPay refused the credentials")}


def token_from_url(url):
    """The token out of a checkout URL we built earlier.

    ExpressPay asks about a payment by its token, and the token is already in
    the address the payer was sent to — so a settlement that has the intent has
    the token, and nothing new had to be stored to keep it.
    """
    text = str(url or "")
    marker = "token="
    if marker not in text:
        return ""
    return text.split(marker, 1)[1].split("&")[0].strip()


gateway = ExpressPay()
