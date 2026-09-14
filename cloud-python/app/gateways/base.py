"""What every payment gateway has to be able to do, and nothing else.

A school in Ghana does not have one payment provider; it has whichever one its
bank, its bursar or its proprietor already uses. So the gateway is a choice the
school makes, not a decision baked into this codebase — and that only works if
adding the next provider is one file rather than a change to the fee module,
the parent app, the subscription engine and three webhook routes.

Hence this: one contract, five methods, and a declared list of the fields the
provider needs. Everything else in the platform talks to `Gateway` and never to
a provider by name.

    checkout()       start a payment; hand back somewhere to send the payer
    verify()         ask the provider what actually happened. The only truth.
    verify_webhook() is this delivery genuine?
    read_webhook()   what does it say, in our words
    ping()           are these credentials real? — the Test button

── The rule that makes an unverified adapter safe ──────────────────────────
`ping()` is not a convenience. A gateway cannot be switched on until a test
against the live provider has passed, which means a wrong key, a wrong base URL
or an adapter written against a version of an API that has since moved is found
at setup, by the person doing the setup, in ten seconds — and never by a parent
whose money has gone somewhere nobody can find.

── The rule about money ────────────────────────────────────────────────────
`verify()` is the only thing in this platform allowed to say a payment
succeeded, and it asks the provider over the school's own authenticated
connection. A webhook body is a hint that something happened. It is never
evidence of an amount, and some providers here do not sign their callbacks at
all — see `SIGNED_CALLBACKS` on each adapter. Settlement re-asks regardless, so
the unsigned ones are no less safe; they are simply honest about it.
"""
import json
import urllib.error
import urllib.parse
import urllib.request


class Field:
    """One thing a provider needs from the school, described well enough to
    draw a form for it and to refuse a bad value before it is stored."""

    def __init__(self, key, label, kind="text", required=True, secret=False,
                 hint="", placeholder="", options=None, default=""):
        self.key = key
        self.label = label
        self.kind = kind            # text | password | url | select
        self.required = required
        # A secret is write-only for the whole of its life: it goes in, it is
        # used by the code that calls the provider, and no route ever reads it
        # back out. The console and the school's own screen see `••••1234`.
        self.secret = secret
        self.hint = hint
        self.placeholder = placeholder
        self.options = options or []
        self.default = default

    def spec(self):
        return {
            "key": self.key, "label": self.label, "kind": self.kind,
            "required": self.required, "secret": self.secret, "hint": self.hint,
            "placeholder": self.placeholder, "options": self.options,
            "default": self.default,
        }


class Config:
    """One school's (or the platform's) credentials for one gateway."""

    def __init__(self, gateway, credentials=None, currency="GHS", callback_url=""):
        self.gateway = gateway
        self.credentials = dict(credentials or {})
        self.currency = str(currency or "GHS").upper()
        self.callback_url = str(callback_url or "")

    def cred(self, key, fallback=""):
        value = self.credentials.get(key)
        return fallback if value in (None, "") else str(value)

    def base(self, fallback):
        """The provider's API root.

        Overridable per school, and that is deliberate rather than lazy: it is
        what lets a school move between a provider's sandbox and its live
        environment, and what lets an operator correct an endpoint that has
        moved without waiting for a release.
        """
        return self.cred("base_url", fallback).rstrip("/")


class Gateway:
    """The contract. Subclasses fill in the five methods."""

    id = ""
    name = ""
    tagline = ""
    country = ""
    docs_url = ""
    # What the payer can actually pay with, for the school's own screen.
    channels = ()
    # The card networks a payer may use where `card` is among the channels.
    # Named rather than implied because "card" means different networks in
    # different markets, and a school asking "can we pay with our Visa?"
    # deserves the answer on the page rather than a support email.
    card_brands = ()
    currencies = ("GHS",)
    fields = ()
    # Can the provider charge a payment method the payer authorised earlier?
    # Only a gateway that can is usable for a subscription that renews itself.
    supports_stored_charge = False
    # Does the provider SIGN its callbacks? Where it does not, the callback is
    # treated as a nudge to go and ask, and never as evidence.
    signed_callbacks = False
    # Adapters written against a provider's published contract but not yet
    # exercised against a live account from inside this repository. It changes
    # nothing about how they run — it is what the setup screen says out loud,
    # so nobody points a school at one without testing it first.
    verified = False

    # Which of this provider's channels leave behind something chargeable
    # later. On every provider here that is the card and only the card: a
    # mobile-money collection is a one-off, and no amount of storing its
    # reference makes it billable next month. A subscription that has to renew
    # itself therefore has to be set up on a card, which is why
    # `billing/provider.py` asks for these by name (§7).
    reusable_channels = ("card",)

    # ── the five ────────────────────────────────────────────────────────────
    def checkout(self, cfg, amount, reference, email="", metadata=None, callback_url="",
                 channels=()):
        """`channels` narrows what the payer is offered, where the provider
        allows it — empty means "whatever this merchant account has enabled".

        A provider that cannot be told is not a problem to work around here: it
        is told at the point where it matters instead (see `reusable_channels`
        and the renewal check in `billing/provider.py`).
        """
        raise NotImplementedError

    def verify(self, cfg, reference, token=""):
        """`token` is for the providers that identify a payment by something
        they minted rather than by the reference we gave them — ExpressPay does.
        Declared on the base so a caller never has to ask which kind it has."""
        raise NotImplementedError

    def verify_webhook(self, cfg, raw, headers):
        return False

    def read_webhook(self, cfg, raw, headers):
        return {"event": "", "reference": "", "event_id": "", "status": ""}

    def ping(self, cfg):
        raise NotImplementedError

    def charge_stored(self, cfg, authorization, amount, reference, email="", metadata=None):
        return {"ok": False, "error": f"{self.name} cannot charge a saved payment method."}

    # ── shared ──────────────────────────────────────────────────────────────
    def spec(self):
        """Everything a setup screen needs to draw this gateway."""
        return {
            "id": self.id, "name": self.name, "tagline": self.tagline,
            "country": self.country, "docs_url": self.docs_url,
            "channels": list(self.channels), "currencies": list(self.currencies),
            "card_brands": list(self.card_brands),
            "reusable_channels": list(self.reusable_channels),
            "fields": [f.spec() for f in self.fields],
            "supports_stored_charge": self.supports_stored_charge,
            "signed_callbacks": self.signed_callbacks,
            "verified": self.verified,
        }

    def missing(self, cfg):
        """Required fields this configuration has not been given."""
        return [f.label for f in self.fields if f.required and not cfg.cred(f.key)]

    def _fail(self, response, fallback):
        """A provider's own words where it gave any, ours where it did not.

        A school reading "init_failed_401" learns nothing; a school reading
        "Invalid key" goes and fixes its key.
        """
        body = response.get("json")
        for key in ("message", "error", "data", "result-text", "responseText", "Message"):
            if isinstance(body, dict) and isinstance(body.get(key), str) and body[key].strip():
                return body[key].strip()
        if response.get("error"):
            return str(response["error"])
        status = response.get("status")
        if status == 401:
            return "The provider refused those credentials."
        if status == 0:
            return "The provider could not be reached."
        return f"{fallback} ({status})"


# ── HTTP ────────────────────────────────────────────────────────────────────
# urllib rather than requests, for the same reason the rest of this service
# uses it: one fewer dependency in an image that a school's uptime depends on.
def http_json(url, method="GET", headers=None, body=None, timeout=25):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("Content-Type", "application/json")
    request.add_header("Accept", "application/json")
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    return _send(request, timeout)


def http_form(url, fields, method="POST", headers=None, timeout=25):
    """Form-encoded, for the providers whose APIs predate everybody agreeing
    on JSON. Their answers are still JSON, which is the awkward half."""
    data = urllib.parse.urlencode({k: ("" if v is None else str(v))
                                   for k, v in (fields or {}).items()}).encode()
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("Content-Type", "application/x-www-form-urlencoded")
    request.add_header("Accept", "application/json")
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    return _send(request, timeout)


def _send(request, timeout):
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return _read(response.status, response.read())
    except urllib.error.HTTPError as err:
        # The provider answered, and said no. Its reason is the useful part.
        try:
            return _read(err.code, err.read())
        except Exception:
            return {"status": err.code, "json": None}
    except Exception as err:
        return {"status": 0, "error": str(err)}


def _read(status, payload):
    text = (payload or b"").decode("utf-8", "replace")
    try:
        return {"status": status, "json": json.loads(text) if text else {}}
    except ValueError:
        # Some providers answer an error as HTML. Keep a little of it: it is
        # usually the only clue about what went wrong.
        return {"status": status, "json": None, "text": text[:400]}


def ok(response):
    return 200 <= int(response.get("status") or 0) < 300


def minor(amount):
    """Money in the smallest unit — pesewas, kobo. What most gateways want."""
    return int(round(float(amount or 0) * 100))


def major(amount):
    """…and back again."""
    try:
        return round(float(amount or 0) / 100.0, 2)
    except (TypeError, ValueError):
        return 0.0
